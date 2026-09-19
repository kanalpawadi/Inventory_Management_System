"""
api/routes/forecast.py

Endpoints:
    GET  /forecast/products              — list all products
    GET  /forecast                       — forecast rows (filter by product/model/date range)
    GET  /forecast/comparison            — model comparison metrics table
    GET  /forecast/ensemble-weights      — learned stacking blend weights
"""

import os
from datetime import date
from typing import Optional, List

import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from api.cache import read_parquet

router = APIRouter()

# ── Paths ─────────────────────────────────────────────────────────────────────
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PROCESSED_DIR = os.path.join(BACKEND_DIR, "data", "processed")
MODELS_DIR = os.path.join(BACKEND_DIR, "ml", "models")

_PREDICTION_FILES = {
    "xgboost":   os.path.join(PROCESSED_DIR, "xgboost_predictions.parquet"),
    "prophet":   os.path.join(PROCESSED_DIR, "prophet_predictions.parquet"),
    "lstm":      os.path.join(PROCESSED_DIR, "lstm_predictions.parquet"),
    "ensemble":  os.path.join(PROCESSED_DIR, "ensemble_predictions.parquet"),
}

_MODEL_COMPARISON_PATH = os.path.join(MODELS_DIR, "model_comparison.json")
_ENSEMBLE_WEIGHTS_PATH = os.path.join(MODELS_DIR, "ensemble_weights.json")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _load_predictions(model: str) -> pd.DataFrame:
    path = _PREDICTION_FILES.get(model)
    if path is None:
        raise HTTPException(status_code=400, detail=f"Unknown model '{model}'. Choose from: {list(_PREDICTION_FILES)}")
    if not os.path.exists(path):
        raise HTTPException(status_code=503, detail=f"Predictions for '{model}' not found. Run the ML pipeline first.")
    df = read_parquet(path)
    # Ensemble parquet uses pred_ensemble column instead of predicted
    if "pred_ensemble" in df.columns and "predicted" not in df.columns:
        df = df.rename(columns={"pred_ensemble": "predicted"})
    df["date"] = pd.to_datetime(df["date"]).dt.date
    return df


def _get_all_products() -> List[dict]:
    """Derive product list from any available predictions file."""
    for model_key in ("xgboost", "ensemble", "lstm", "prophet"):
        path = _PREDICTION_FILES[model_key]
        if os.path.exists(path):
            df = read_parquet(path)[["product_id", "product_name"]].drop_duplicates()
            return df.sort_values("product_id").to_dict(orient="records")
    return []


# ── Schemas ───────────────────────────────────────────────────────────────────

class ProductOut(BaseModel):
    product_id: int
    product_name: str


class ForecastPoint(BaseModel):
    product_id: int
    product_name: str
    date: date
    predicted: float
    confidence_lower: float
    confidence_upper: float
    actual: Optional[float] = None


class MetricSet(BaseModel):
    rmse: float
    mae: float
    mape: float
    wape: float
    n_rows: int


class PerProductMetrics(BaseModel):
    product_name: str
    rmse: float
    mae: float
    mape: float
    wape: float
    n_rows: int


class ModelMetrics(BaseModel):
    overall: MetricSet
    per_product: dict  # product_id -> PerProductMetrics


class ComparisonOut(BaseModel):
    xgboost: ModelMetrics
    prophet: ModelMetrics
    lstm: ModelMetrics
    stacked_ensemble: ModelMetrics


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/products", response_model=List[ProductOut])
def list_products():
    """Return all products available in the forecast dataset."""
    products = _get_all_products()
    if not products:
        raise HTTPException(status_code=503, detail="No prediction data found. Run the ML pipeline first.")
    return products


@router.get("", response_model=List[ForecastPoint])
def get_forecast(
    model: str = Query("ensemble", description="Model: xgboost | prophet | lstm | ensemble"),
    product_id: Optional[int] = Query(None, description="Filter by product ID"),
    start_date: Optional[date] = Query(None, description="Start date (inclusive) YYYY-MM-DD"),
    end_date: Optional[date] = Query(None, description="End date (inclusive) YYYY-MM-DD"),
):
    """
    Return forecast predictions for all products (or a specific product),
    optionally filtered by date range.
    """
    df = _load_predictions(model)

    if product_id is not None:
        df = df[df["product_id"] == product_id]
        if df.empty:
            raise HTTPException(status_code=404, detail=f"No forecasts found for product_id={product_id}")

    if start_date:
        df = df[df["date"] >= start_date]
    if end_date:
        df = df[df["date"] <= end_date]

    df = df.sort_values(["product_id", "date"])

    results = []
    for _, row in df.iterrows():
        results.append(ForecastPoint(
            product_id=int(row["product_id"]),
            product_name=str(row["product_name"]),
            date=row["date"],
            predicted=round(float(row["predicted"]), 4),
            confidence_lower=round(float(row.get("confidence_lower", row["predicted"])), 4),
            confidence_upper=round(float(row.get("confidence_upper", row["predicted"])), 4),
            actual=round(float(row["actual"]), 4) if "actual" in row and pd.notna(row["actual"]) else None,
        ))
    return results


@router.get("/comparison")
def get_model_comparison():
    """
    Return the head-to-head model comparison table (RMSE, MAE, MAPE, WAPE)
    for XGBoost, Prophet, LSTM, and the Stacked Ensemble.
    """
    if not os.path.exists(_MODEL_COMPARISON_PATH):
        raise HTTPException(status_code=503, detail="model_comparison.json not found. Run stacking_ensemble.py first.")
    import json
    with open(_MODEL_COMPARISON_PATH) as f:
        return json.load(f)


@router.get("/ensemble-weights")
def get_ensemble_weights():
    """Return the learned stacking blend weights per base model."""
    if not os.path.exists(_ENSEMBLE_WEIGHTS_PATH):
        raise HTTPException(status_code=503, detail="ensemble_weights.json not found.")
    import json
    with open(_ENSEMBLE_WEIGHTS_PATH) as f:
        return json.load(f)
