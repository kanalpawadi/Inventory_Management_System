"""
data_prep/load_m5_data.py

Load raw M5 CSVs, filter to FOODS category, pick a handful of steady/non-sparse
SKUs, relabel them for a clean demo story, engineer basic promo/holiday flags,
and populate the `products` + `sales_history` tables.

Expected input files (download from Kaggle, place in backend/data/raw/):
    backend/data/raw/calendar.csv
    backend/data/raw/sales_train_evaluation.csv
    backend/data/raw/sell_prices.csv

Run:
    cd backend
    python -m data_prep.load_m5_data
    # or with flags:
    python -m data_prep.load_m5_data --n-skus 5 --store CA_1
"""

import argparse
import os
import sys

import numpy as np
import pandas as pd

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from database import Base, engine, SessionLocal
from models.tables import Product, SalesHistory

RAW_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "raw")

DEMO_LABELS = ["Milk", "Yogurt", "Cheese", "Eggs", "Bread"]


def load_raw(raw_dir: str):
    cal_path = os.path.join(raw_dir, "calendar.csv")
    sales_path = os.path.join(raw_dir, "sales_train_evaluation.csv")
    prices_path = os.path.join(raw_dir, "sell_prices.csv")

    for p in (cal_path, sales_path, prices_path):
        if not os.path.exists(p):
            raise FileNotFoundError(
                f"Missing {p}. Download the M5 dataset from Kaggle and place the 3 CSVs in {raw_dir}"
            )

    print("Loading calendar.csv ...")
    calendar = pd.read_csv(cal_path, parse_dates=["date"])

    print("Loading sales_train_evaluation.csv (this one is big, may take a bit) ...")
    sales = pd.read_csv(sales_path)

    print("Loading sell_prices.csv ...")
    prices = pd.read_csv(prices_path)

    return calendar, sales, prices


def filter_foods(sales: pd.DataFrame, store_id: str) -> pd.DataFrame:
    foods = sales[(sales["cat_id"] == "FOODS") & (sales["store_id"] == store_id)].copy()
    print(f"FOODS rows for store {store_id}: {len(foods)}")
    return foods


def select_steady_skus(foods: pd.DataFrame, n_skus: int) -> list:
    day_cols = [c for c in foods.columns if c.startswith("d_")]
    values = foods[day_cols].values

    zero_frac = (values == 0).mean(axis=1)
    mean_sales = values.mean(axis=1)
    std_sales = values.std(axis=1)
    cv = np.divide(std_sales, mean_sales, out=np.full_like(std_sales, np.inf), where=mean_sales > 0)

    stats = pd.DataFrame({
        "item_id": foods["item_id"].values,
        "zero_frac": zero_frac,
        "mean_sales": mean_sales,
        "cv": cv,
    })

    candidates = stats[(stats["zero_frac"] < 0.15) & (stats["mean_sales"] >= 2)]
    candidates = candidates.sort_values("cv")

    if len(candidates) < n_skus:
        print(f"Warning: only {len(candidates)} SKUs passed the steadiness filter; loosening thresholds.")
        candidates = stats.sort_values("cv")

    chosen = candidates.head(n_skus)["item_id"].tolist()
    print(f"Selected SKUs: {chosen}")
    return chosen


def compute_is_holiday(calendar: pd.DataFrame) -> pd.DataFrame:
    cal = calendar.copy()
    cal["is_holiday"] = cal["event_type_1"].notna() | cal["event_type_2"].notna()
    return cal[["d", "date", "is_holiday", "snap_CA", "snap_TX", "snap_WI"]]


def build_long_format(foods_subset: pd.DataFrame, calendar_slim: pd.DataFrame,
                       prices: pd.DataFrame, store_id: str) -> pd.DataFrame:
    day_cols = [c for c in foods_subset.columns if c.startswith("d_")]
    id_cols = ["item_id", "store_id"]

    long_df = foods_subset.melt(id_vars=id_cols, value_vars=day_cols,
                                 var_name="d", value_name="quantity_sold")
    long_df = long_df.merge(calendar_slim, on="d", how="left")

    wk_map = pd.read_csv(os.path.join(RAW_DIR, "calendar.csv"), usecols=["d", "wm_yr_wk"])
    long_df = long_df.merge(wk_map, on="d", how="left")

    price_slim = prices[prices["store_id"] == store_id][["item_id", "wm_yr_wk", "sell_price"]]
    long_df = long_df.merge(price_slim, on=["item_id", "wm_yr_wk"], how="left")
    long_df = long_df.rename(columns={"sell_price": "price"})

    long_df = long_df.sort_values(["item_id", "date"])
    long_df["rolling_median_price"] = (
        long_df.groupby("item_id")["price"].transform(lambda s: s.rolling(28, min_periods=7).median())
    )
    long_df["promo_flag"] = (
        long_df["price"] < long_df["rolling_median_price"] * 0.93
    ).fillna(False)

    return long_df


def populate_db(long_df: pd.DataFrame, item_ids: list, store_id: str):
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        db.query(SalesHistory).delete()
        db.query(Product).delete()
        db.commit()

        for label, item_id in zip(DEMO_LABELS, item_ids):
            item_rows = long_df[long_df["item_id"] == item_id].sort_values("date")
            latest_price = item_rows["price"].dropna().iloc[-1] if item_rows["price"].notna().any() else None

            product = Product(
                name=label,
                item_id=item_id,
                store_id=store_id,
                category="FOODS",
                price=float(latest_price) if latest_price is not None else None,
            )
            db.add(product)
            db.flush()

            records = [
                SalesHistory(
                    product_id=product.id,
                    date=row["date"].date(),
                    quantity_sold=float(row["quantity_sold"]),
                    price=float(row["price"]) if pd.notna(row["price"]) else None,
                    promo_flag=bool(row["promo_flag"]),
                    is_holiday=bool(row["is_holiday"]),
                )
                for _, row in item_rows.iterrows()
            ]
            db.bulk_save_objects(records)
            db.commit()
            print(f"Inserted {label} ({item_id}): {len(records)} sales_history rows")

    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-dir", default=RAW_DIR)
    parser.add_argument("--store", default="CA_1", help="M5 store_id to source single clean series from")
    parser.add_argument("--n-skus", type=int, default=5)
    args = parser.parse_args()

    calendar, sales, prices = load_raw(args.raw_dir)
    foods = filter_foods(sales, args.store)
    item_ids = select_steady_skus(foods, args.n_skus)
    foods_subset = foods[foods["item_id"].isin(item_ids)]

    calendar_slim = compute_is_holiday(calendar)
    long_df = build_long_format(foods_subset, calendar_slim, prices, args.store)

    populate_db(long_df, item_ids, args.store)
    print("Done. products + sales_history populated.")


if __name__ == "__main__":
    main()