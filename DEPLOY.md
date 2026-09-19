# Deploying Demand IQ on Render (free tier)

The deployed API **serves precomputed results** (predictions, SHAP values, anomalies in
`backend/data/processed/*.parquet`, and inventory in the SQLite DB `backend/demand_forecast.db`).
It never trains or loads TensorFlow, Prophet, XGBoost or SHAP at request time, so it only needs
the slim `backend/requirements.txt`. All features keep working.

| | Before | After |
|---|---|---|
| Python deps installed | ~2.4 GB (TensorFlow, Prophet, SHAP…) | ~250 MB |
| Backend deploy payload | + 5 MB model weights + 311 MB raw CSVs (local) | ~1.4 MB |
| RAM at runtime | TensorFlow alone overshoots 512 MB | fits the 512 MB free instance |

## One-click deploy (Blueprint)

1. Push this repo to GitHub, **including** `backend/demand_forecast.db` (no longer git-ignored).
2. Render dashboard → **New → Blueprint** → select the repo. `render.yaml` creates:
   - `demand-iq-api`: FastAPI web service (free)
   - `demand-iq-dashboard`: static React site, with `VITE_API_URL` wired to the API automatically
3. When prompted, paste your `GROQ_API_KEY` (only needed for the AI assistant).
4. Open the dashboard URL. On the free tier the API sleeps after 15 min idle, so the first visit
   shows a "Waking up the server…" banner for up to ~1 minute and then loads normally.

## Retraining models (local only)

```bash
cd backend
pip install -r requirements-train.txt
```

Then run the ML scripts in `backend/ml/` as before. They regenerate `data/processed/*.parquet`
and `ml/models/*.json`, which the API picks up automatically.

## Environment variables (API)

| Name | Default | Purpose |
|---|---|---|
| `GROQ_API_KEY` | none | Enables the AI assistant |
| `GROQ_MODEL` | `openai/gpt-oss-20b` | Groq model id |
| `CHAT_RATE_LIMIT` | `10` | AI questions per minute per IP |
| `CORS_ORIGINS` | `*` | Comma-separated allowed origins |
| `DATABASE_URL` | `backend/demand_forecast.db` | Any SQLAlchemy URL (e.g. Supabase Postgres) |
