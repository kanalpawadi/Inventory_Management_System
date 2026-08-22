"""
data_prep/feature_engineering.py

Step 2 of the pipeline: pull sales_history back out of Supabase, engineer
model-ready features (lags, rolling stats, calendar/promo signals), and
save the result to a local parquet file for fast iteration during model
training. Supabase stays the source of truth for raw sales; this feature
table is a derived, disposable artifact you can regenerate any time.

Output: backend/data/processed/features.parquet

Run:
    cd backend
    python -m data_prep.feature_engineering
"""

import os
import sys

import numpy as np
import pandas as pd

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from database import SessionLocal
from models.tables import Product, SalesHistory

PROCESSED_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "processed"
)
OUTPUT_PATH = os.path.join(PROCESSED_DIR, "features.parquet")

LAG_DAYS = [1, 7, 28]
ROLLING_WINDOWS = [7, 28]


def load_sales_from_db() -> pd.DataFrame:
    """Pull products + sales_history from Supabase into a single DataFrame."""
    db = SessionLocal()
    try:
        print("Querying products + sales_history from Supabase ...")
        rows = (
            db.query(
                SalesHistory.product_id,
                Product.name.label("product_name"),
                SalesHistory.date,
                SalesHistory.quantity_sold,
                SalesHistory.price,
                SalesHistory.promo_flag,
                SalesHistory.is_holiday,
            )
            .join(Product, Product.id == SalesHistory.product_id)
            .all()
        )
        df = pd.DataFrame(rows, columns=[
            "product_id", "product_name", "date", "quantity_sold",
            "price", "promo_flag", "is_holiday",
        ])
        print(f"Pulled {len(df)} rows across {df['product_id'].nunique()} products.")
        return df
    finally:
        db.close()


def add_calendar_features(df: pd.DataFrame) -> pd.DataFrame:
    df["date"] = pd.to_datetime(df["date"])
    df["day_of_week"] = df["date"].dt.dayofweek
    df["is_weekend"] = df["day_of_week"].isin([5, 6]).astype(int)
    df["month"] = df["date"].dt.month
    df["day_of_month"] = df["date"].dt.day
    df["week_of_year"] = df["date"].dt.isocalendar().week.astype(int)
    return df


def add_lag_and_rolling_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_values(["product_id", "date"]).reset_index(drop=True)
    grouped = df.groupby("product_id")["quantity_sold"]

    for lag in LAG_DAYS:
        df[f"lag_{lag}"] = grouped.shift(lag)

    for window in ROLLING_WINDOWS:
        df[f"rolling_mean_{window}"] = (
            df.groupby("product_id")["quantity_sold"]
            .transform(lambda s: s.shift(1).rolling(window, min_periods=max(3, window // 4)).mean())
        )
        df[f"rolling_std_{window}"] = (
            df.groupby("product_id")["quantity_sold"]
            .transform(lambda s: s.shift(1).rolling(window, min_periods=max(3, window // 4)).std())
        )

    return df


def add_price_promo_features(df: pd.DataFrame) -> pd.DataFrame:
    df["rolling_median_price_28"] = (
        df.groupby("product_id")["price"]
        .transform(lambda s: s.rolling(28, min_periods=7).median())
    )
    df["price_vs_rolling_median"] = np.where(
        df["rolling_median_price_28"].notna() & (df["rolling_median_price_28"] > 0),
        df["price"] / df["rolling_median_price_28"],
        np.nan,
    )
    df["promo_flag"] = df["promo_flag"].astype(int)
    df["is_holiday"] = df["is_holiday"].astype(int)
    return df


def build_features() -> pd.DataFrame:
    df = load_sales_from_db()
    df = add_calendar_features(df)
    df = add_lag_and_rolling_features(df)
    df = add_price_promo_features(df)

    before = len(df)
    df = df.dropna(subset=[f"lag_{max(LAG_DAYS)}", f"rolling_mean_{max(ROLLING_WINDOWS)}"])
    print(f"Dropped {before - len(df)} warm-up rows lacking full lag/rolling history.")

    return df.sort_values(["product_id", "date"]).reset_index(drop=True)


def main():
    os.makedirs(PROCESSED_DIR, exist_ok=True)
    features_df = build_features()

    print(f"Final feature table: {features_df.shape[0]} rows, {features_df.shape[1]} columns.")
    print("Columns:", list(features_df.columns))

    features_df.to_parquet(OUTPUT_PATH, index=False)
    print(f"Saved features to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()