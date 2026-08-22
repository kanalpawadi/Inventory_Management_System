"""
ml/xgboost_model.py

Step 3a: Train an XGBoost regressor on the engineered feature table
(lags, rolling stats, calendar/promo features) to forecast daily demand.

Also trains two auxiliary quantile-regression models (10th / 90th percentile)
on the same features to produce confidence intervals for the uncertainty
quantification requirement -- this is what feeds `confidence_lower` /
`confidence_upper` in the `forecasts` table later.

Uses a time-based train/test split (last N days per product held out) rather
than a random split, since shuffling would leak future information into
training for a time series problem.

Inputs:  backend/data/processed/features.parquet   (from feature_engineering.py)
Outputs: backend/ml/models/xgboost_model.json               (point forecast model)
         backend/ml/models/xgboost_lower.json                (10th percentile model)
         backend/ml/models/xgboost_upper.json                (90th percentile model)
         backend/ml/models/xgboost_metrics.json               (RMSE/MAE/MAPE per product + overall)
         backend/data/processed/xgboost_predictions.parquet  (test-set predictions w/ intervals)

Run:
    cd backend
    python -m ml.xgboost_model
"""

import json
import os
import sys

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import mean_squared_error, mean_absolute_error

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FEATURES_PATH = os.path.join(BACKEND_DIR, "data", "processed", "features.parquet")
MODELS_DIR = os.path.join(BACKEND_DIR, "ml", "models")
PREDICTIONS_PATH = os.path.join(BACKEND_DIR, "data", "processed", "xgboost_predictions.parquet")

TEST_DAYS = 28  # hold out the last 28 days per product as the test set

FEATURE_COLUMNS = [
    "lag_1", "lag_7", "lag_28",
    "rolling_mean_7", "rolling_std_7",
    "rolling_mean_28", "rolling_std_28",
    "day_of_week", "is_weekend", "month", "day_of_month", "week_of_year",
    "promo_flag", "is_holiday", "price_vs_rolling_median",
]
TARGET_COLUMN = "quantity_sold"


def mean_absolute_percentage_error(y_true, y_pred):
    """MAPE with a small epsilon guard against zero-demand days."""
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    denom = np.where(y_true == 0, 1e-3, y_true)
    return float(np.mean(np.abs((y_true - y_pred) / denom)) * 100)


def time_based_split(df: pd.DataFrame, test_days: int):
    """Per product, hold out the last `test_days` rows as test, rest as train."""
    df = df.sort_values(["product_id", "date"])
    test_mask = (
        df.groupby("product_id")["date"]
        .rank(method="first", ascending=False) <= test_days
    )
    train_df = df[~test_mask].copy()
    test_df = df[test_mask].copy()
    return train_df, test_df


def train_point_model(train_df: pd.DataFrame) -> xgb.XGBRegressor:
    model = xgb.XGBRegressor(
        objective="reg:squarederror",
        n_estimators=300,
        max_depth=5,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
    )
    model.fit(train_df[FEATURE_COLUMNS], train_df[TARGET_COLUMN])
    return model


def train_quantile_model(train_df: pd.DataFrame, quantile: float) -> xgb.XGBRegressor:
    model = xgb.XGBRegressor(
        objective="reg:quantileerror",
        quantile_alpha=quantile,
        n_estimators=300,
        max_depth=5,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
    )
    model.fit(train_df[FEATURE_COLUMNS], train_df[TARGET_COLUMN])
    return model


def evaluate(test_df: pd.DataFrame, preds: np.ndarray) -> dict:
    overall = {
        "rmse": float(np.sqrt(mean_squared_error(test_df[TARGET_COLUMN], preds))),
        "mae": float(mean_absolute_error(test_df[TARGET_COLUMN], preds)),
        "mape": mean_absolute_percentage_error(test_df[TARGET_COLUMN], preds),
        "n_test_rows": int(len(test_df)),
    }

    per_product = {}
    test_df = test_df.copy()
    test_df["_pred"] = preds
    for pid, group in test_df.groupby("product_id"):
        per_product[str(pid)] = {
            "product_name": group["product_name"].iloc[0],
            "rmse": float(np.sqrt(mean_squared_error(group[TARGET_COLUMN], group["_pred"]))),
            "mae": float(mean_absolute_error(group[TARGET_COLUMN], group["_pred"])),
            "mape": mean_absolute_percentage_error(group[TARGET_COLUMN], group["_pred"]),
            "n_test_rows": int(len(group)),
        }

    return {"overall": overall, "per_product": per_product}


def main():
    os.makedirs(MODELS_DIR, exist_ok=True)

    if not os.path.exists(FEATURES_PATH):
        raise FileNotFoundError(
            f"Missing {FEATURES_PATH}. Run `python -m data_prep.feature_engineering` first."
        )

    print("Loading engineered features ...")
    df = pd.read_parquet(FEATURES_PATH)
    df = df.dropna(subset=FEATURE_COLUMNS + [TARGET_COLUMN])
    print(f"Loaded {len(df)} rows after dropping any remaining NaNs.")

    train_df, test_df = time_based_split(df, TEST_DAYS)
    print(f"Train rows: {len(train_df)} | Test rows: {len(test_df)} (last {TEST_DAYS} days/product)")

    print("Training point-forecast model (reg:squarederror) ...")
    point_model = train_point_model(train_df)

    print("Training lower-bound quantile model (10th percentile) ...")
    lower_model = train_quantile_model(train_df, 0.10)

    print("Training upper-bound quantile model (90th percentile) ...")
    upper_model = train_quantile_model(train_df, 0.90)

    point_preds = point_model.predict(test_df[FEATURE_COLUMNS])
    lower_preds = lower_model.predict(test_df[FEATURE_COLUMNS])
    upper_preds = upper_model.predict(test_df[FEATURE_COLUMNS])

    # Guard against quantile crossing (lower > upper on rare noisy rows)
    lower_preds, upper_preds = np.minimum(lower_preds, upper_preds), np.maximum(lower_preds, upper_preds)

    metrics = evaluate(test_df, point_preds)
    print("\n=== XGBoost evaluation ===")
    print(f"Overall RMSE: {metrics['overall']['rmse']:.3f} | "
          f"MAE: {metrics['overall']['mae']:.3f} | "
          f"MAPE: {metrics['overall']['mape']:.2f}%")
    for pid, m in metrics["per_product"].items():
        print(f"  {m['product_name']:10s} (id={pid}): "
              f"RMSE={m['rmse']:.3f}  MAE={m['mae']:.3f}  MAPE={m['mape']:.2f}%")

    point_model.save_model(os.path.join(MODELS_DIR, "xgboost_model.json"))
    lower_model.save_model(os.path.join(MODELS_DIR, "xgboost_lower.json"))
    upper_model.save_model(os.path.join(MODELS_DIR, "xgboost_upper.json"))

    with open(os.path.join(MODELS_DIR, "xgboost_metrics.json"), "w") as f:
        json.dump(metrics, f, indent=2)

    predictions_out = test_df[["product_id", "product_name", "date", TARGET_COLUMN]].copy()
    predictions_out = predictions_out.rename(columns={TARGET_COLUMN: "actual"})
    predictions_out["predicted"] = point_preds
    predictions_out["confidence_lower"] = lower_preds
    predictions_out["confidence_upper"] = upper_preds
    predictions_out.to_parquet(PREDICTIONS_PATH, index=False)

    print(f"\nSaved model artifacts to {MODELS_DIR}")
    print(f"Saved test predictions (with intervals) to {PREDICTIONS_PATH}")


if __name__ == "__main__":
    main()