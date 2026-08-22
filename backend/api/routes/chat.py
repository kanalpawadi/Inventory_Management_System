"""
api/routes/chat.py

Groq LLM endpoint — explains inventory, forecasts, anomalies and SHAP
in plain English using openai/gpt-oss-20b (Groq free tier).

Note: llama-3.1-8b-instant was retired from the Groq free tier and replaced
here with openai/gpt-oss-20b. If Groq deprecates this one too, override it
via the GROQ_MODEL env var in .env — no code change needed.

Rate limiting via slowapi: 10 requests / minute per IP (well inside Groq limits).

Endpoint:
    POST /chat/explain
    Body: { "context": "inventory" | "anomaly" | "forecast" | "shap" | "general",
            "data": { ...any relevant JSON snapshot... },
            "question": "optional user question" }
    Returns: { "reply": "...", "model": "...", "tokens_used": N }
"""

import os
import sys
import json
from typing import Optional, Any, Dict

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

router = APIRouter()

# ── Groq client (lazy init so import errors stay informative) ──────────────────
_groq_client = None

def _get_groq():
    global _groq_client
    if _groq_client is None:
        api_key = os.getenv("GROQ_API_KEY", "")
        if not api_key or api_key.startswith("gsk_your"):
            raise HTTPException(
                status_code=503,
                detail=(
                    "GROQ_API_KEY not set. "
                    "Get a free key at https://console.groq.com/keys "
                    "and add it to backend/.env as GROQ_API_KEY=gsk_..."
                )
            )
        try:
            from groq import Groq
            _groq_client = Groq(api_key=api_key)
        except ImportError:
            raise HTTPException(
                status_code=503,
                detail="groq package not installed. Run: pip install groq"
            )
    return _groq_client


# ── Model config ───────────────────────────────────────────────────────────────
GROQ_MODEL  = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")  # override in .env if Groq changes lineup again
MAX_TOKENS  = 400                                            # keeps replies short by construction
TEMPERATURE = 0.4                                             # balanced: factual but readable


# ── System prompt (static) ─────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are an AI assistant embedded in an inventory demand forecasting dashboard.
Explain things to a busy store manager — someone smart but not a data scientist, reading on a
small dashboard panel, not a report.

Rules:
- Write like you're talking, not writing a memo. Short, plain sentences.
- Max 3-4 sentences total. No more.
- No markdown formatting: no bold, no headers, no bullet points, no asterisks.
- Avoid jargon. If a technical term is unavoidable, define it in a few plain words, not a formal parenthetical.
- Ground the explanation in the actual numbers given.
- End with one short, concrete next step — one sentence, not a labeled section.
- Never make up data. If data is missing, say so in a half-sentence and move on — don't dwell on it."""


# ── Context-specific prompt builders ──────────────────────────────────────────

def _build_inventory_prompt(data: dict, question: str) -> str:
    return f"""Here is the inventory status for a product:

Product: {data.get('product_name', 'Unknown')}
Current Stock: {data.get('current_stock', 'N/A')} units
Safety Stock: {data.get('safety_stock', 'N/A')} units
Reorder Point: {data.get('reorder_point', 'N/A')} units
Economic Order Quantity (EOQ): {data.get('reorder_quantity', 'N/A')} units
Needs Reorder: {data.get('needs_reorder', 'N/A')}

Assumptions used: Lead time = 7 days, Service level = 95%, Ordering cost = $50, Holding cost = 20%/yr.

User question: {question or "Explain this inventory status in simple English. What does it mean and what should I do?"}"""


def _build_forecast_prompt(data: dict, question: str) -> str:
    points = data.get('forecast_points', [])
    summary = ""
    if points:
        preds = [p['predicted'] for p in points if isinstance(p.get('predicted'), (int, float))]
        actuals = [p['actual'] for p in points if isinstance(p.get('actual'), (int, float))]
        if preds:
            summary = (
                f"Avg predicted demand: {sum(preds)/len(preds):.1f} units/day, "
                f"Range: {min(preds):.1f}–{max(preds):.1f}. "
            )
        if actuals:
            summary += f"Avg actual demand: {sum(actuals)/len(actuals):.1f} units/day."

    return f"""Here is forecast data for a product:

Product: {data.get('product_name', 'Unknown')}
Model used: {data.get('model', 'ensemble')}
Forecast period: {len(points)} days
{summary}
Sample forecast points (date → predicted → actual):
{chr(10).join(f"  {p.get('date')}: predicted={p.get('predicted',0):.1f}, actual={p.get('actual','N/A')}" for p in points[:5]) if points else "No points provided."}

User question: {question or "Explain what this forecast means in simple English. How accurate is it? What are the key takeaways?"}"""


def _build_anomaly_prompt(data: dict, question: str) -> str:
    anomalies = data.get('anomalies', [])
    high = [a for a in anomalies if a.get('severity') == 'high']
    spikes = [a for a in anomalies if a.get('reason') == 'demand_spike']
    drops = [a for a in anomalies if a.get('reason') == 'demand_drop']

    recent = anomalies[:3]
    recent_txt = "\n".join(
        f"  {a.get('date')}: {a.get('reason','?').replace('_',' ')} — actual={a.get('actual_value',0):.1f}, "
        f"expected={a.get('expected_value',0):.1f}, deviation={a.get('deviation_pct',0):+.1f}%, severity={a.get('severity','?')}"
        for a in recent
    ) or "  No recent anomalies."

    return f"""Here is anomaly detection data:

Product: {data.get('product_name', 'All products') if len(anomalies) > 0 else 'Unknown'}
Total anomalies flagged: {len(anomalies)}
  - High severity: {len(high)}
  - Demand spikes: {len(spikes)}
  - Demand drops: {len(drops)}

Most recent anomalies:
{recent_txt}

Detection method: Isolation Forest on [quantity_sold, rolling_mean_7, rolling_std_7, day_of_week, promo_flag, is_holiday]

User question: {question or "Explain these anomalies in simple English. Why might these spikes/drops happen? Should I be concerned?"}"""


def _build_shap_prompt(data: dict, question: str) -> str:
    shap_vals = data.get('shap_values', [])
    top = shap_vals[:6] if shap_vals else []
    base = data.get('base_value', 'N/A')
    pred = data.get('predicted_value', 'N/A')

    top_txt = "\n".join(
        f"  {s.get('feature','?').replace('_',' ')}: SHAP={s.get('shap_value',0):+.4f} "
        f"(feature value={s.get('feature_value',0):.3f})"
        for s in top
    ) or "  No SHAP values provided."

    return f"""Here is SHAP (model explanation) data for an XGBoost demand forecast:

Product: {data.get('product_name', 'Unknown')}
Date: {data.get('date', 'Unknown')}
Base prediction (average): {base}
Final predicted demand: {pred} units

Top feature contributions (positive = pushed demand UP, negative = pushed DOWN):
{top_txt}

User question: {question or "Explain in simple English why the model predicted this demand level. What features drove the prediction the most?"}"""


def _build_general_prompt(data: dict, question: str) -> str:
    context_str = json.dumps(data, indent=2, default=str)[:1500] if data else "(no data)"
    return f"""Context data from the inventory dashboard:
{context_str}

User question: {question or "Explain the above in simple English."}"""


PROMPT_BUILDERS = {
    "inventory": _build_inventory_prompt,
    "forecast":  _build_forecast_prompt,
    "anomaly":   _build_anomaly_prompt,
    "shap":      _build_shap_prompt,
    "general":   _build_general_prompt,
}


# ── Schema ─────────────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    context: str = "general"       # inventory | forecast | anomaly | shap | general
    data: Optional[Dict[str, Any]] = {}
    question: Optional[str] = ""


class ChatResponse(BaseModel):
    reply: str
    model: str
    tokens_used: int
    context: str


# ── Route ──────────────────────────────────────────────────────────────────────

@router.post("/explain", response_model=ChatResponse)
async def explain(req: ChatRequest):
    """
    Call Groq LLM to explain inventory/forecast/anomaly/SHAP data in plain English.

    - context: what type of data is being explained
    - data:    the relevant JSON snapshot from the dashboard
    - question: optional follow-up question from the user

    Uses openai/gpt-oss-20b on Groq free tier.
    """
    client = _get_groq()

    ctx = req.context.lower().strip()
    builder = PROMPT_BUILDERS.get(ctx, _build_general_prompt)
    user_message = builder(req.data or {}, req.question or "")

    try:
         response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user",   "content": user_message},
            ],
            max_tokens=MAX_TOKENS,
            temperature=TEMPERATURE,
            reasoning_effort="low",
        )
    except Exception as exc:
        # Catch Groq rate limit, auth, and model errors gracefully
        err_msg = str(exc)
        if "rate_limit" in err_msg.lower() or "429" in err_msg:
            raise HTTPException(
                status_code=429,
                detail="Groq rate limit reached. The free tier allows 30 requests/minute. Please wait a moment."
            )
        if "401" in err_msg or "invalid_api_key" in err_msg.lower():
            raise HTTPException(
                status_code=401,
                detail="Invalid GROQ_API_KEY. Get your free key at https://console.groq.com/keys"
            )
        if "model_not_found" in err_msg.lower() or "404" in err_msg:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"Model '{GROQ_MODEL}' is no longer available on Groq. "
                    "Run client.models.list() to see current options, then set GROQ_MODEL in your .env."
                )
            )
        raise HTTPException(status_code=502, detail=f"Groq API error: {err_msg[:300]}")

    choice = response.choices[0]
    reply = choice.message.content.strip()
    tokens = response.usage.total_tokens if response.usage else 0

    return ChatResponse(
        reply=reply,
        model=GROQ_MODEL,
        tokens_used=tokens,
        context=ctx,
    )


@router.get("/status")
def chat_status():
    """Check if Groq API key is configured."""
    key = os.getenv("GROQ_API_KEY", "")
    configured = bool(key) and not key.startswith("gsk_your")
    return {
        "groq_configured": configured,
        "model": GROQ_MODEL,
        "free_tier_limits": {
            "requests_per_minute": 30,
            "requests_per_day": 14400,
            "max_tokens_per_request": MAX_TOKENS,
        },
        "message": "Ready" if configured else "Set GROQ_API_KEY in backend/.env to enable AI explanations.",
    }