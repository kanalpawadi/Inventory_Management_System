"""
ml/prophet_model.py

Step 3b: Train a Prophet model per product using calendar/promo/price as
extra regressors. Prophet natively outputs a forecast interval (yhat_lower /
yhat_upper), so no separate quantile models are needed here (unlike XGBoost).

Uses the same time-based train/test split as xgboost_model.py (last 28 days
per product held out) so results are directly comparable in the model
comparison step later.

Inputs:  backend/data/processed/features.parquet   (from feature_engineering.py)
Outputs: backend/ml/models/prophet_<product_id>.json   (one serialized model per product)
         backend/ml/models/prophet_metrics.json         (RMSE/MAE/MAPE per product + overall)
         backend/data/processed/prophet_predictions.parquet

Run:
    cd backend
    python -m ml.prophet_model
"""

import json
import os
import sys

import numpy as np
import pandas as pd
# pyrefly: ignore [missing-import]
from prophet import Prophet
# pyrefly: ignore [missing-import]
from prophet.serialize import model_to_json
from sklearn.metrics import mean_squared_error, mean_absolute_error

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FEATURES_PATH = os.path.join(BACKEND_DIR, "data", "processed", "features.parquet")
MODELS_DIR = os.path.join(BACKEND_DIR, "ml", "models")
PREDICTIONS_PATH = os.path.join(BACKEND_DIR, "data", "processed", "prophet_predictions.parquet")

TEST_DAYS = 28
REGRESSORS = ["promo_flag", "is_holiday", "price_vs_rolling_median"]


def mean_absolute_percentage_error(y_true, y_pred):
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    denom = np.where(y_true == 0, 1e-3, y_true)
    return float(np.mean(np.abs((y_true - y_pred) / denom)) * 100)


def time_based_split(df: pd.DataFrame, test_days: int):
    df = df.sort_values("date")
    cutoff = df["date"].rank(method="first", ascending=False) <= test_days
    return df[~cutoff].copy(), df[cutoff].copy()


def prep_prophet_df(product_df: pd.DataFrame) -> pd.DataFrame:
    """Prophet requires columns 'ds' and 'y', plus any regressor columns by name."""
    out = product_df[["date", "quantity_sold"] + REGRESSORS].rename(
        columns={"date": "ds", "quantity_sold": "y"}
    ).copy()
    # Prophet regressors can't contain NaNs -- forward/back-fill any gaps
    for col in REGRESSORS:
        out[col] = out[col].ffill().bfill().fillna(0)
    return out


def train_and_predict_one_product(product_df: pd.DataFrame):
    train_df, test_df = time_based_split(product_df, TEST_DAYS)

    prophet_train = prep_prophet_df(train_df)
    prophet_test = prep_prophet_df(test_df)

    model = Prophet(
        yearly_seasonality=True,
        weekly_seasonality=True,
        daily_seasonality=False,
        interval_width=0.80,  # matches the 10th/90th percentile bounds used for XGBoost
    )
    for col in REGRESSORS:
        model.add_regressor(col)

    model.fit(prophet_train)

    forecast = model.predict(prophet_test[["ds"] + REGRESSORS])

    result = test_df[["product_id", "product_name", "date"]].reset_index(drop=True)
    result["actual"] = test_df["quantity_sold"].values
    result["predicted"] = forecast["yhat"].values
    result["confidence_lower"] = forecast["yhat_lower"].values
    result["confidence_upper"] = forecast["yhat_upper"].values
    # Demand can't be negative -- clip predictions/bounds at 0
    for col in ["predicted", "confidence_lower", "confidence_upper"]:
        result[col] = result[col].clip(lower=0)

    return model, result


def evaluate(all_predictions: pd.DataFrame) -> dict:
    overall = {
        "rmse": float(np.sqrt(mean_squared_error(all_predictions["actual"], all_predictions["predicted"]))),
        "mae": float(mean_absolute_error(all_predictions["actual"], all_predictions["predicted"])),
        "mape": mean_absolute_percentage_error(all_predictions["actual"], all_predictions["predicted"]),
        "n_test_rows": int(len(all_predictions)),
    }

    per_product = {}
    for pid, group in all_predictions.groupby("product_id"):
        per_product[str(pid)] = {
            "product_name": group["product_name"].iloc[0],
            "rmse": float(np.sqrt(mean_squared_error(group["actual"], group["predicted"]))),
            "mae": float(mean_absolute_error(group["actual"], group["predicted"])),
            "mape": mean_absolute_percentage_error(group["actual"], group["predicted"]),
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

    all_predictions = []

    for pid, product_df in df.groupby("product_id"):
        name = product_df["product_name"].iloc[0]
        print(f"\nTraining Prophet for {name} (product_id={pid}) ...")
        model, result = train_and_predict_one_product(product_df)
        all_predictions.append(result)

        model_path = os.path.join(MODELS_DIR, f"prophet_{pid}.json")
        with open(model_path, "w") as f:
            f.write(model_to_json(model))
        print(f"  Saved model to {model_path}")

    all_predictions = pd.concat(all_predictions, ignore_index=True)

    metrics = evaluate(all_predictions)
    print("\n=== Prophet evaluation ===")
    print(f"Overall RMSE: {metrics['overall']['rmse']:.3f} | "
          f"MAE: {metrics['overall']['mae']:.3f} | "
          f"MAPE: {metrics['overall']['mape']:.2f}%")
    for pid, m in metrics["per_product"].items():
        print(f"  {m['product_name']:10s} (id={pid}): "
              f"RMSE={m['rmse']:.3f}  MAE={m['mae']:.3f}  MAPE={m['mape']:.2f}%")

    with open(os.path.join(MODELS_DIR, "prophet_metrics.json"), "w") as f:
        json.dump(metrics, f, indent=2)

    all_predictions.to_parquet(PREDICTIONS_PATH, index=False)
    print(f"\nSaved test predictions (with intervals) to {PREDICTIONS_PATH}")


if __name__ == "__main__":
    main()