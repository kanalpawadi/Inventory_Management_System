"""
ml/stacking_ensemble.py

Step 3d: Combine XGBoost + Prophet + LSTM predictions via a linear meta-model
that learns the optimal blend weights, rather than simple averaging.

IMPORTANT (avoiding leakage): each base model's test predictions cover the
same 28 held-out days per product. To fairly evaluate the ensemble we can't
fit the meta-model's weights on the same days we score it on. So each
product's 28 test days are split into:
    - first 14 days -> meta-train (fit blend weights here)
    - last 14 days  -> meta-test  (report final metrics here, and ONLY here)

This gives an honest, non-leaky comparison: XGBoost / Prophet / LSTM /
Ensemble RMSE, MAE, MAPE, and WAPE are all recomputed on the exact same
meta-test window, so the comparison table is apples-to-apples.

Inputs:  backend/data/processed/xgboost_predictions.parquet
         backend/data/processed/prophet_predictions.parquet
         backend/data/processed/lstm_predictions.parquet
Outputs: backend/ml/models/ensemble_weights.json
         backend/ml/models/model_comparison.json     (the headline evaluation table)
         backend/data/processed/ensemble_predictions.parquet

Run:
    cd backend
    python -m ml.stacking_ensemble
"""

import json
import os
import sys

import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_squared_error, mean_absolute_error

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROCESSED_DIR = os.path.join(BACKEND_DIR, "data", "processed")
MODELS_DIR = os.path.join(BACKEND_DIR, "ml", "models")

XGB_PATH = os.path.join(PROCESSED_DIR, "xgboost_predictions.parquet")
PROPHET_PATH = os.path.join(PROCESSED_DIR, "prophet_predictions.parquet")
LSTM_PATH = os.path.join(PROCESSED_DIR, "lstm_predictions.parquet")
ENSEMBLE_OUT_PATH = os.path.join(PROCESSED_DIR, "ensemble_predictions.parquet")

META_TRAIN_DAYS = 14  # first half of each product's 28-day test window
BASE_MODELS = ["xgboost", "prophet", "lstm"]


def mean_absolute_percentage_error(y_true, y_pred):
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    denom = np.where(y_true == 0, 1e-3, y_true)
    return float(np.mean(np.abs((y_true - y_pred) / denom)) * 100)


def weighted_absolute_percentage_error(y_true, y_pred):
    """WAPE: sum(|error|) / sum(|actual|). More robust than MAPE on
    low-volume products since it isn't dominated by individual small-actual rows."""
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    total_actual = np.sum(np.abs(y_true))
    if total_actual == 0:
        return 0.0
    return float(np.sum(np.abs(y_true - y_pred)) / total_actual * 100)


def compute_metrics(actual, predicted) -> dict:
    return {
        "rmse": float(np.sqrt(mean_squared_error(actual, predicted))),
        "mae": float(mean_absolute_error(actual, predicted)),
        "mape": mean_absolute_percentage_error(actual, predicted),
        "wape": weighted_absolute_percentage_error(actual, predicted),
        "n_rows": int(len(actual)),
    }


def load_and_merge_predictions() -> pd.DataFrame:
    for path in (XGB_PATH, PROPHET_PATH, LSTM_PATH):
        if not os.path.exists(path):
            raise FileNotFoundError(
                f"Missing {path}. Run xgboost_model.py, prophet_model.py, and lstm_model.py first."
            )

    xgb = pd.read_parquet(XGB_PATH).rename(columns={
        "predicted": "pred_xgboost", "confidence_lower": "lower_xgboost", "confidence_upper": "upper_xgboost"
    })
    prophet = pd.read_parquet(PROPHET_PATH).rename(columns={
        "predicted": "pred_prophet", "confidence_lower": "lower_prophet", "confidence_upper": "upper_prophet"
    })
    lstm = pd.read_parquet(LSTM_PATH).rename(columns={
        "predicted": "pred_lstm", "confidence_lower": "lower_lstm", "confidence_upper": "upper_lstm"
    })

    merged = xgb[["product_id", "product_name", "date", "actual", "pred_xgboost", "lower_xgboost", "upper_xgboost"]]
    merged = merged.merge(
        prophet[["product_id", "date", "pred_prophet", "lower_prophet", "upper_prophet"]],
        on=["product_id", "date"], how="inner"
    )
    merged = merged.merge(
        lstm[["product_id", "date", "pred_lstm", "lower_lstm", "upper_lstm"]],
        on=["product_id", "date"], how="inner"
    )

    dropped = len(xgb) - len(merged)
    if dropped > 0:
        print(f"Note: {dropped} rows dropped where models' test dates didn't all align "
              f"(can happen if LSTM skipped a low-history product).")

    return merged


def split_meta_train_test(df: pd.DataFrame):
    df = df.sort_values(["product_id", "date"])
    rank_from_start = df.groupby("product_id").cumcount()
    meta_train = df[rank_from_start < META_TRAIN_DAYS].copy()
    meta_test = df[rank_from_start >= META_TRAIN_DAYS].copy()
    return meta_train, meta_test


def fit_meta_model(meta_train: pd.DataFrame) -> LinearRegression:
    X = meta_train[[f"pred_{m}" for m in BASE_MODELS]].values
    y = meta_train["actual"].values
    # positive=True keeps blend weights non-negative -> stays interpretable
    # as "how much each base model contributes", not an unconstrained fit
    # that could produce weird negative-weight overfitting on so little data.
    meta_model = LinearRegression(positive=True)
    meta_model.fit(X, y)
    return meta_model


def apply_ensemble(df: pd.DataFrame, meta_model: LinearRegression) -> pd.DataFrame:
    df = df.copy()
    X = df[[f"pred_{m}" for m in BASE_MODELS]].values
    df["pred_ensemble"] = np.clip(meta_model.predict(X), 0, None)

    # Blend confidence bounds using the same learned weights (renormalized to sum to 1
    # purely for the interval blend, so bounds stay on a sensible scale)
    weights = meta_model.coef_
    weight_sum = weights.sum() if weights.sum() > 0 else 1.0
    norm_weights = weights / weight_sum

    lower_cols = [f"lower_{m}" for m in BASE_MODELS]
    upper_cols = [f"upper_{m}" for m in BASE_MODELS]
    df["confidence_lower"] = np.clip((df[lower_cols].values * norm_weights).sum(axis=1), 0, None)
    df["confidence_upper"] = np.clip((df[upper_cols].values * norm_weights).sum(axis=1), 0, None)

    return df


def build_comparison_table(meta_test: pd.DataFrame) -> dict:
    """Recompute RMSE/MAE/MAPE/WAPE for every model -- including the base
    models -- on the exact same meta-test window used for the ensemble,
    so the final table is a fair, apples-to-apples comparison."""
    comparison = {}
    for model_key, pred_col in [
        ("xgboost", "pred_xgboost"),
        ("prophet", "pred_prophet"),
        ("lstm", "pred_lstm"),
        ("stacked_ensemble", "pred_ensemble"),
    ]:
        overall = compute_metrics(meta_test["actual"], meta_test[pred_col])
        per_product = {}
        for pid, group in meta_test.groupby("product_id"):
            per_product[str(pid)] = {
                "product_name": group["product_name"].iloc[0],
                **compute_metrics(group["actual"], group[pred_col]),
            }
        comparison[model_key] = {"overall": overall, "per_product": per_product}
    return comparison


def print_comparison_table(comparison: dict):
    print("\n" + "=" * 70)
    print(f"{'Model':<20}{'RMSE':>10}{'MAE':>10}{'MAPE':>10}{'WAPE':>10}")
    print("=" * 70)
    for model_key, data in comparison.items():
        o = data["overall"]
        print(f"{model_key:<20}{o['rmse']:>10.3f}{o['mae']:>10.3f}{o['mape']:>9.2f}%{o['wape']:>9.2f}%")
    print("=" * 70)

    print(f"\nPer-product breakdown ({'stacked_ensemble'}):")
    for pid, m in comparison["stacked_ensemble"]["per_product"].items():
        print(f"  {m['product_name']:10s} (id={pid}): "
              f"RMSE={m['rmse']:.3f}  MAE={m['mae']:.3f}  MAPE={m['mape']:.2f}%  WAPE={m['wape']:.2f}%")


def main():
    os.makedirs(MODELS_DIR, exist_ok=True)

    print("Loading and merging base model predictions ...")
    merged = load_and_merge_predictions()
    print(f"Merged prediction set: {len(merged)} rows across {merged['product_id'].nunique()} products.")

    meta_train, meta_test = split_meta_train_test(merged)
    print(f"Meta-train: {len(meta_train)} rows (first {META_TRAIN_DAYS} days/product)")
    print(f"Meta-test:  {len(meta_test)} rows (last days/product) -- final metrics reported on this set only")

    print("\nFitting stacking meta-model (non-negative linear blend) ...")
    meta_model = fit_meta_model(meta_train)
    weights = dict(zip(BASE_MODELS, meta_model.coef_.tolist()))
    print(f"Learned blend weights: {weights}")
    print(f"Intercept: {meta_model.intercept_:.4f}")

    meta_test_with_ensemble = apply_ensemble(meta_test, meta_model)

    comparison = build_comparison_table(meta_test_with_ensemble)
    print_comparison_table(comparison)

    with open(os.path.join(MODELS_DIR, "ensemble_weights.json"), "w") as f:
        json.dump({"weights": weights, "intercept": float(meta_model.intercept_)}, f, indent=2)

    with open(os.path.join(MODELS_DIR, "model_comparison.json"), "w") as f:
        json.dump(comparison, f, indent=2)

    meta_test_with_ensemble.to_parquet(ENSEMBLE_OUT_PATH, index=False)

    print(f"\nSaved blend weights to {os.path.join(MODELS_DIR, 'ensemble_weights.json')}")
    print(f"Saved full model comparison table to {os.path.join(MODELS_DIR, 'model_comparison.json')}")
    print(f"Saved ensemble predictions to {ENSEMBLE_OUT_PATH}")


if __name__ == "__main__":
    main()