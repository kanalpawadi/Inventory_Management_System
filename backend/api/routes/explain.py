"""
api/routes/explain.py

Endpoints:
    GET /explain                  — SHAP values for a product/date (waterfall chart data)
    GET /explain/global-importance — mean |SHAP| per feature across the whole test set
    GET /explain/dates            — available (product_id, date) pairs for the explain UI
"""

import json
import os
import sys
from datetime import date
from typing import List, Optional

import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

router = APIRouter()

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXPLANATIONS_PATH = os.path.join(BACKEND_DIR, "data", "processed", "shap_explanations.parquet")
GLOBAL_IMPORTANCE_PATH = os.path.join(BACKEND_DIR, "ml", "models", "shap_global_importance.json")


# ── Schemas ───────────────────────────────────────────────────────────────────

class ShapEntry(BaseModel):
    feature: str
    feature_value: float
    shap_value: float
    base_value: float
    predicted_value: float


class ExplainOut(BaseModel):
    product_id: int
    product_name: str
    date: date
    base_value: float
    predicted_value: float
    shap_values: List[ShapEntry]    # sorted by |shap_value| descending


class GlobalImportanceItem(BaseModel):
    feature: str
    mean_abs_shap: float


class AvailableDateItem(BaseModel):
    product_id: int
    product_name: str
    date: date


# ── Helper ────────────────────────────────────────────────────────────────────

def _load_shap() -> pd.DataFrame:
    if not os.path.exists(EXPLANATIONS_PATH):
        raise HTTPException(
            status_code=503,
            detail="shap_explanations.parquet not found. Run `python -m ml.explainability` first."
        )
    df = pd.read_parquet(EXPLANATIONS_PATH)
    df["date"] = pd.to_datetime(df["date"]).dt.date
    return df


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("", response_model=ExplainOut)
def get_explanation(
    product_id: int = Query(..., description="Product ID"),
    date_str: str = Query(..., alias="date", description="Date in YYYY-MM-DD format"),
):
    """
    Return SHAP feature contributions for a specific product on a specific date.
    Use this to power a waterfall / bar chart of 'why did the model predict X?'
    """
    try:
        query_date = date.fromisoformat(date_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")

    df = _load_shap()
    subset = df[(df["product_id"] == product_id) & (df["date"] == query_date)]

    if subset.empty:
        raise HTTPException(
            status_code=404,
            detail=f"No SHAP explanation found for product_id={product_id} on {date_str}. "
                   "Check /explain/dates for available (product, date) pairs."
        )

    # Sort features by |SHAP value| descending (most impactful first)
    subset = subset.copy()
    subset["_abs_shap"] = subset["shap_value"].abs()
    subset = subset.sort_values("_abs_shap", ascending=False)

    first_row = subset.iloc[0]
    shap_entries = [
        ShapEntry(
            feature=str(row["feature"]),
            feature_value=round(float(row["feature_value"]), 4),
            shap_value=round(float(row["shap_value"]), 4),
            base_value=round(float(row["base_value"]), 4),
            predicted_value=round(float(row["predicted_value"]), 4),
        )
        for _, row in subset.iterrows()
    ]

    return ExplainOut(
        product_id=int(first_row["product_id"]),
        product_name=str(first_row["product_name"]),
        date=query_date,
        base_value=round(float(first_row["base_value"]), 4),
        predicted_value=round(float(first_row["predicted_value"]), 4),
        shap_values=shap_entries,
    )


@router.get("/global-importance", response_model=List[GlobalImportanceItem])
def global_importance():
    """
    Return global feature importance: mean |SHAP value| per feature across
    the entire XGBoost test set, sorted descending.
    """
    if not os.path.exists(GLOBAL_IMPORTANCE_PATH):
        raise HTTPException(
            status_code=503,
            detail="shap_global_importance.json not found. Run `python -m ml.explainability` first."
        )
    with open(GLOBAL_IMPORTANCE_PATH) as f:
        data = json.load(f)

    return [
        GlobalImportanceItem(feature=k, mean_abs_shap=round(v, 6))
        for k, v in data.items()
    ]


@router.get("/dates", response_model=List[AvailableDateItem])
def available_dates(
    product_id: Optional[int] = Query(None, description="Filter by product ID"),
):
    """
    List all (product_id, date) pairs for which SHAP explanations exist.
    Use this to populate a date picker in the UI.
    """
    df = _load_shap()
    available = df[["product_id", "product_name", "date"]].drop_duplicates().sort_values(["product_id", "date"])

    if product_id is not None:
        available = available[available["product_id"] == product_id]

    return [
        AvailableDateItem(
            product_id=int(r["product_id"]),
            product_name=str(r["product_name"]),
            date=r["date"],
        )
        for _, r in available.iterrows()
    ]
