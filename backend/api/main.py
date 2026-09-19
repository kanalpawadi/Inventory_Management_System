"""
api/main.py
FastAPI application entry point.

Run:
    cd backend
    uvicorn api.main:app --reload --port 8000
"""

import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware

from database import Base, engine
from api.routes import forecast, inventory, anomalies, explain, chat

# ── Create tables on startup (idempotent) ──────────────────────────────────────
Base.metadata.create_all(bind=engine)

# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Inventory Demand Forecasting API",
    description=(
        "REST API for the Inventory Demand Forecasting system. "
        "Serves XGBoost / Prophet / LSTM / Ensemble predictions, "
        "inventory metrics, anomaly alerts, and SHAP explanations."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── CORS — comma-separated CORS_ORIGINS env var, default "*" (public read-only demo) ─
_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=False,   # the frontend never sends cookies; "*" + credentials is invalid per spec
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ── Routers ────────────────────────────────────────────────────────────────────
app.include_router(forecast.router,   prefix="/forecast",   tags=["Forecast"])
app.include_router(inventory.router,  prefix="/inventory",  tags=["Inventory"])
app.include_router(anomalies.router,  prefix="/anomalies",  tags=["Anomalies"])
app.include_router(explain.router,    prefix="/explain",    tags=["Explainability"])
app.include_router(chat.router,       prefix="/chat",       tags=["AI Assistant"])


# ── Health check ───────────────────────────────────────────────────────────────
@app.get("/", tags=["Health"])
def root():
    return {"status": "ok", "message": "Inventory Demand Forecasting API is running."}


@app.get("/health", tags=["Health"])
def health():
    return {"status": "healthy"}


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return Response(status_code=204)

