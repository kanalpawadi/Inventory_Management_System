"""
api/routes/anomalies.py

Endpoints:
    GET /anomalies           — list anomalies (all products or filtered)
    GET /anomalies/summary   — count per product/severity
"""

import os
import sys
from datetime import date
from typing import Optional, List

import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

router = APIRouter()

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ANOMALIES_PATH = os.path.join(BACKEND_DIR, "data", "processed", "anomalies.parquet")


# ── Schemas ───────────────────────────────────────────────────────────────────

class AnomalyOut(BaseModel):
    product_id: int
    product_name: str
    date: date
    actual_value: float
    expected_value: float
    deviation_pct: float       # how many % above/below expected
    severity: str              # low | medium | high
    reason: str                # demand_spike | demand_drop


class AnomalySummaryItem(BaseModel):
    product_id: int
    product_name: str
    total: int
    high: int
    medium: int
    low: int
    spikes: int
    drops: int


# ── Helper ────────────────────────────────────────────────────────────────────

def _load_anomalies() -> pd.DataFrame:
    if not os.path.exists(ANOMALIES_PATH):
        raise HTTPException(
            status_code=503,
            detail="anomalies.parquet not found. Run `python -m ml.anomaly_detection` first."
        )
    df = pd.read_parquet(ANOMALIES_PATH)
    df["date"] = pd.to_datetime(df["date"]).dt.date
    return df


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("", response_model=List[AnomalyOut])
def list_anomalies(
    product_id: Optional[int] = Query(None, description="Filter by product ID"),
    severity: Optional[str] = Query(None, description="Filter: low | medium | high"),
    reason: Optional[str] = Query(None, description="Filter: demand_spike | demand_drop"),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
):
    """
    Return detected demand anomalies (spikes/drops) flagged by Isolation Forest.
    """
    df = _load_anomalies()

    if product_id is not None:
        df = df[df["product_id"] == product_id]
    if severity:
        df = df[df["severity"] == severity.lower()]
    if reason:
        df = df[df["reason"] == reason.lower()]
    if start_date:
        df = df[df["date"] >= start_date]
    if end_date:
        df = df[df["date"] <= end_date]

    df = df.sort_values(["product_id", "date"], ascending=[True, False]).head(limit)

    results = []
    for _, row in df.iterrows():
        expected = float(row["expected_value"]) if float(row["expected_value"]) != 0 else 1e-3
        deviation_pct = round((float(row["actual_value"]) - expected) / abs(expected) * 100, 1)
        results.append(AnomalyOut(
            product_id=int(row["product_id"]),
            product_name=str(row["product_name"]),
            date=row["date"],
            actual_value=round(float(row["actual_value"]), 2),
            expected_value=round(float(row["expected_value"]), 2),
            deviation_pct=deviation_pct,
            severity=str(row["severity"]),
            reason=str(row["reason"]),
        ))
    return results


@router.get("/summary", response_model=List[AnomalySummaryItem])
def anomaly_summary():
    """
    Return per-product anomaly counts broken down by severity and reason.
    Useful for the dashboard alert panel.
    """
    df = _load_anomalies()

    summary = []
    for pid, group in df.groupby("product_id"):
        summary.append(AnomalySummaryItem(
            product_id=int(pid),
            product_name=str(group["product_name"].iloc[0]),
            total=len(group),
            high=int((group["severity"] == "high").sum()),
            medium=int((group["severity"] == "medium").sum()),
            low=int((group["severity"] == "low").sum()),
            spikes=int((group["reason"] == "demand_spike").sum()),
            drops=int((group["reason"] == "demand_drop").sum()),
        ))

    return sorted(summary, key=lambda x: x.product_id)
