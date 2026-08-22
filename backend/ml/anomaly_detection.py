"""
ml/anomaly_detection.py

Step 4a: Detect demand anomalies (spikes/drops) across each product's full
sales history using Isolation Forest, then write flagged rows into the
`anomalies` table in Supabase for the dashboard's alert panel.

Approach:
    - Per product, run Isolation Forest over [quantity_sold, rolling_mean_7,
      rolling_std_7, day_of_week, promo_flag, is_holiday] -- this lets the
      model flag points that are unusual GIVEN their recent context, not just
      unusually high/low in absolute terms (e.g. a holiday spike that's
      expected won't get flagged as aggressively as an unexplained one).
    - For each flagged point, `expected_value` = rolling 7-day mean, severity
      is derived from how many rolling-std's away the actual value is, and
      `reason` distinguishes spikes (actual > expected) from drops.

Inputs:  backend/data/processed/features.parquet
Outputs: backend/data/processed/anomalies.parquet   (local copy for inspection)
         Rows written into the Supabase `anomalies` table

Run:
    cd backend
    python -m ml.anomaly_detection
"""

import os
import sys

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from database import SessionLocal
from models.tables import Anomaly

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FEATURES_PATH = os.path.join(BACKEND_DIR, "data", "processed", "features.parquet")
ANOMALIES_LOCAL_PATH = os.path.join(BACKEND_DIR, "data", "processed", "anomalies.parquet")

IF_FEATURES = ["quantity_sold", "rolling_mean_7", "rolling_std_7", "day_of_week", "promo_flag", "is_holiday"]
CONTAMINATION = 0.03  # expect ~3% of days to be flagged as anomalous, tune as needed


def severity_from_zscore(z: float) -> str:
    z = abs(z)
    if z >= 3:
        return "high"
    if z >= 2:
        return "medium"
    return "low"


def detect_for_product(product_df: pd.DataFrame) -> pd.DataFrame:
    df = product_df.sort_values("date").reset_index(drop=True)
    model_df = df.dropna(subset=IF_FEATURES).copy()

    if len(model_df) < 30:
        return pd.DataFrame()  # not enough history to bother

    iso = IsolationForest(contamination=CONTAMINATION, random_state=42, n_estimators=200)
    model_df["_flag"] = iso.fit_predict(model_df[IF_FEATURES])  # -1 = anomaly, 1 = normal

    anomalies = model_df[model_df["_flag"] == -1].copy()
    if anomalies.empty:
        return pd.DataFrame()

    # rolling_std_7 can be 0/NaN on very flat stretches -- guard against div-by-zero
    safe_std = anomalies["rolling_std_7"].replace(0, np.nan)
    z = (anomalies["quantity_sold"] - anomalies["rolling_mean_7"]) / safe_std
    z = z.fillna(0)

    anomalies["expected_value"] = anomalies["rolling_mean_7"]
    anomalies["actual_value"] = anomalies["quantity_sold"]
    anomalies["severity"] = z.apply(severity_from_zscore)
    anomalies["reason"] = np.where(anomalies["quantity_sold"] > anomalies["rolling_mean_7"],
                                    "demand_spike", "demand_drop")

    return anomalies[["product_id", "product_name", "date", "actual_value", "expected_value", "severity", "reason"]]


def write_to_db(anomalies_df: pd.DataFrame):
    db = SessionLocal()
    try:
        product_ids = anomalies_df["product_id"].unique().tolist()
        db.query(Anomaly).filter(Anomaly.product_id.in_(product_ids)).delete(synchronize_session=False)
        db.commit()

        records = [
            Anomaly(
                product_id=int(row["product_id"]),
                date=row["date"].date() if hasattr(row["date"], "date") else row["date"],
                actual_value=float(row["actual_value"]),
                expected_value=float(row["expected_value"]),
                severity=row["severity"],
                reason=row["reason"],
            )
            for _, row in anomalies_df.iterrows()
        ]
        db.bulk_save_objects(records)
        db.commit()
        print(f"Wrote {len(records)} anomaly rows to Supabase `anomalies` table.")
    finally:
        db.close()


def main():
    if not os.path.exists(FEATURES_PATH):
        raise FileNotFoundError(
            f"Missing {FEATURES_PATH}. Run `python -m data_prep.feature_engineering` first."
        )

    print("Loading engineered features ...")
    df = pd.read_parquet(FEATURES_PATH)

    all_anomalies = []
    for pid, product_df in df.groupby("product_id"):
        name = product_df["product_name"].iloc[0]
        result = detect_for_product(product_df)
        print(f"{name} (product_id={pid}): {len(result)} anomalies flagged "
              f"out of {len(product_df)} days ({len(result)/len(product_df)*100:.1f}%)")
        if not result.empty:
            all_anomalies.append(result)

    if not all_anomalies:
        print("No anomalies detected across any product.")
        return

    all_anomalies = pd.concat(all_anomalies, ignore_index=True)
    all_anomalies = all_anomalies.sort_values(["product_id", "date"])

    print(f"\nTotal anomalies flagged: {len(all_anomalies)}")
    print(all_anomalies["severity"].value_counts().to_string())
    print()
    print(all_anomalies["reason"].value_counts().to_string())

    all_anomalies.to_parquet(ANOMALIES_LOCAL_PATH, index=False)
    print(f"\nSaved local copy to {ANOMALIES_LOCAL_PATH}")

    write_to_db(all_anomalies)


if __name__ == "__main__":
    main()