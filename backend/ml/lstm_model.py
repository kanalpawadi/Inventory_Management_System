"""
ml/lstm_model.py

Step 3c: Train an LSTM sequence model per product on windowed sales history.

Uses a 28-day lookback window of [scaled quantity_sold, promo_flag, is_holiday,
day_of_week_sin, day_of_week_cos, price_vs_rolling_median] to predict the next
day's demand.

Confidence intervals come from MC Dropout: dropout stays active at inference
time, and the model is run ~30 times per test point; the spread across those
stochastic passes gives an empirical uncertainty band (no separate quantile
models needed, unlike XGBoost).

Same time-based 28-day holdout per product as xgboost_model.py / prophet_model.py,
so results are directly comparable across all three models.

Inputs:  backend/data/processed/features.parquet
Outputs: backend/ml/models/lstm_<product_id>.keras     (one model per product)
         backend/ml/models/lstm_scaler_<product_id>.json  (per-product min/max used to scale y)
         backend/ml/models/lstm_metrics.json
         backend/data/processed/lstm_predictions.parquet

Run:
    cd backend
    python -m ml.lstm_model

Note: this is a CPU-friendly configuration (small network, early stopping).
Training all 5 products should take a few minutes on a laptop CPU.
"""

import json
import os
import sys

import numpy as np
import pandas as pd
from sklearn.metrics import mean_squared_error, mean_absolute_error

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")  # quiet TF's noisy startup logs

import tensorflow as tf
from tensorflow.keras import layers, models, callbacks

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FEATURES_PATH = os.path.join(BACKEND_DIR, "data", "processed", "features.parquet")
MODELS_DIR = os.path.join(BACKEND_DIR, "ml", "models")
PREDICTIONS_PATH = os.path.join(BACKEND_DIR, "data", "processed", "lstm_predictions.parquet")

WINDOW = 28
TEST_DAYS = 28
MC_PASSES = 30
EPOCHS = 60
BATCH_SIZE = 16

EXOG_COLUMNS = ["promo_flag", "is_holiday", "day_of_week_sin", "day_of_week_cos", "price_vs_rolling_median"]


def mean_absolute_percentage_error(y_true, y_pred):
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    denom = np.where(y_true == 0, 1e-3, y_true)
    return float(np.mean(np.abs((y_true - y_pred) / denom)) * 100)


def add_cyclical_day_of_week(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    dow = pd.to_datetime(df["date"]).dt.dayofweek
    df["day_of_week_sin"] = np.sin(2 * np.pi * dow / 7)
    df["day_of_week_cos"] = np.cos(2 * np.pi * dow / 7)
    return df


def build_sequences(product_df: pd.DataFrame, y_min: float, y_max: float):
    """Turn a product's daily rows into (X, y) sliding-window samples.
    X shape: (n_samples, WINDOW, 1 + len(EXOG_COLUMNS))
    y shape: (n_samples,) -- scaled next-day quantity_sold
    Also returns the dates each y corresponds to, for later train/test splitting."""
    df = product_df.sort_values("date").reset_index(drop=True)

    y_scaled = (df["quantity_sold"].values - y_min) / max(y_max - y_min, 1e-6)
    exog = df[EXOG_COLUMNS].fillna(0).values

    X_list, y_list, date_list = [], [], []
    for i in range(WINDOW, len(df)):
        past_y = y_scaled[i - WINDOW:i].reshape(-1, 1)
        past_exog = exog[i - WINDOW:i]
        window = np.hstack([past_y, past_exog])
        X_list.append(window)
        y_list.append(y_scaled[i])
        date_list.append(df["date"].iloc[i])

    return np.array(X_list), np.array(y_list), pd.Series(date_list)


def build_model(n_features: int) -> tf.keras.Model:
    model = models.Sequential([
        layers.Input(shape=(WINDOW, n_features)),
        layers.LSTM(32, dropout=0.2, recurrent_dropout=0.2),
        layers.Dense(16, activation="relu"),
        layers.Dropout(0.2),
        layers.Dense(1),
    ])
    model.compile(optimizer="adam", loss="mse")
    return model


def mc_dropout_predict(model, X, n_passes=MC_PASSES):
    """Run the model n_passes times with dropout active (training=True) to get
    an empirical distribution of predictions per sample."""
    preds = np.stack([
        model(X, training=True).numpy().flatten() for _ in range(n_passes)
    ], axis=0)  # shape (n_passes, n_samples)
    mean_pred = preds.mean(axis=0)
    lower = np.percentile(preds, 10, axis=0)
    upper = np.percentile(preds, 90, axis=0)
    return mean_pred, lower, upper


def train_and_predict_one_product(product_df: pd.DataFrame):
    product_df = add_cyclical_day_of_week(product_df)

    y_min = product_df["quantity_sold"].min()
    y_max = product_df["quantity_sold"].max()

    X, y, dates = build_sequences(product_df, y_min, y_max)

    test_mask = dates.rank(method="first", ascending=False) <= TEST_DAYS
    test_mask = test_mask.values

    X_train, y_train = X[~test_mask], y[~test_mask]
    X_test, y_test = X[test_mask], y[test_mask]
    dates_test = dates[test_mask].reset_index(drop=True)

    n_features = X.shape[2]
    model = build_model(n_features)

    early_stop = callbacks.EarlyStopping(monitor="val_loss", patience=6, restore_best_weights=True)
    model.fit(
        X_train, y_train,
        validation_split=0.1,
        epochs=EPOCHS,
        batch_size=BATCH_SIZE,
        callbacks=[early_stop],
        verbose=0,
    )

    mean_pred, lower, upper = mc_dropout_predict(model, X_test)

    # Unscale back to real demand units
    def unscale(v):
        return v * (y_max - y_min) + y_min

    result = pd.DataFrame({
        "product_id": product_df["product_id"].iloc[0],
        "product_name": product_df["product_name"].iloc[0],
        "date": dates_test,
        "actual": unscale(y_test),
        "predicted": unscale(mean_pred),
        "confidence_lower": unscale(lower),
        "confidence_upper": unscale(upper),
    })
    for col in ["predicted", "confidence_lower", "confidence_upper"]:
        result[col] = result[col].clip(lower=0)

    return model, result, (y_min, y_max)


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
    tf.random.set_seed(42)
    np.random.seed(42)

    if not os.path.exists(FEATURES_PATH):
        raise FileNotFoundError(
            f"Missing {FEATURES_PATH}. Run `python -m data_prep.feature_engineering` first."
        )

    print("Loading engineered features ...")
    df = pd.read_parquet(FEATURES_PATH)

    all_predictions = []

    for pid, product_df in df.groupby("product_id"):
        name = product_df["product_name"].iloc[0]
        n_days = len(product_df)
        if n_days < WINDOW + TEST_DAYS + 30:
            print(f"Skipping {name}: only {n_days} days of history, need at least {WINDOW + TEST_DAYS + 30}.")
            continue

        print(f"\nTraining LSTM for {name} (product_id={pid}, {n_days} days history) ...")
        model, result, (y_min, y_max) = train_and_predict_one_product(product_df)
        all_predictions.append(result)

        model_path = os.path.join(MODELS_DIR, f"lstm_{pid}.keras")
        model.save(model_path)
        with open(os.path.join(MODELS_DIR, f"lstm_scaler_{pid}.json"), "w") as f:
            json.dump({"y_min": float(y_min), "y_max": float(y_max)}, f)
        print(f"  Saved model to {model_path}")

    all_predictions = pd.concat(all_predictions, ignore_index=True)

    metrics = evaluate(all_predictions)
    print("\n=== LSTM evaluation ===")
    print(f"Overall RMSE: {metrics['overall']['rmse']:.3f} | "
          f"MAE: {metrics['overall']['mae']:.3f} | "
          f"MAPE: {metrics['overall']['mape']:.2f}%")
    for pid, m in metrics["per_product"].items():
        print(f"  {m['product_name']:10s} (id={pid}): "
              f"RMSE={m['rmse']:.3f}  MAE={m['mae']:.3f}  MAPE={m['mape']:.2f}%")

    with open(os.path.join(MODELS_DIR, "lstm_metrics.json"), "w") as f:
        json.dump(metrics, f, indent=2)

    all_predictions.to_parquet(PREDICTIONS_PATH, index=False)
    print(f"\nSaved test predictions (with intervals) to {PREDICTIONS_PATH}")


if __name__ == "__main__":
    main()