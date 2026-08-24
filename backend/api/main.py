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

from fastapi import FastAPI
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

# ── CORS — allow the React dev server and the production frontend ──────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",           # Vite dev server
        "http://localhost:3000",           # Alt dev server
        "https://inventory-demand-api-571038545354.us-central1.run.app",  # Cloud Run backend (self)
        "*",                               # Allow all (permissive; restrict in production if needed)
    ],
    allow_credentials=True,
    allow_methods=["*"],
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
