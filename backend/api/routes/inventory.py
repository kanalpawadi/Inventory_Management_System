"""
api/routes/inventory.py

Endpoints:
    GET  /inventory          — list all products' inventory metrics from DB
    GET  /inventory/{id}     — single product's inventory record
    POST /inventory/recompute — rerun inventory_logic to refresh DB values
"""

import math
import os
import sys
from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from database import get_db
from models.tables import Inventory, Product
from services.inventory_logic import LEAD_TIME_DAYS, Z_SCORE

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class InventoryOut(BaseModel):
    product_id: int
    product_name: Optional[str] = None
    current_stock: float
    safety_stock: float
    reorder_point: float
    reorder_quantity: float
    last_updated: Optional[datetime] = None
    needs_reorder: bool
    # Derived — lets the UI show urgency and drive the What-If simulator with real inputs
    status: str                        # reorder_now | reorder_soon | healthy
    days_until_reorder: Optional[float] = None
    avg_daily_demand: float
    demand_std: float
    unit_price: Optional[float] = None

    class Config:
        from_attributes = True


class RecomputeResult(BaseModel):
    status: str
    products_updated: int


def _to_out(inv: Inventory, product_name: str, price: Optional[float]) -> InventoryOut:
    # Invert the stored formulas: ROP = mu*LT + SS,  SS = Z*sigma*sqrt(LT)
    avg_daily = max((inv.reorder_point - inv.safety_stock) / LEAD_TIME_DAYS, 0.0)
    sigma = inv.safety_stock / (Z_SCORE * math.sqrt(LEAD_TIME_DAYS)) if Z_SCORE else 0.0

    needs_reorder = inv.current_stock <= inv.reorder_point
    days_left = (inv.current_stock - inv.reorder_point) / avg_daily if avg_daily > 0 else None
    if needs_reorder:
        status = "reorder_now"
    elif days_left is not None and days_left <= LEAD_TIME_DAYS:
        status = "reorder_soon"
    else:
        status = "healthy"

    return InventoryOut(
        product_id=inv.product_id,
        product_name=product_name,
        current_stock=round(inv.current_stock, 2),
        safety_stock=round(inv.safety_stock, 2),
        reorder_point=round(inv.reorder_point, 2),
        reorder_quantity=round(inv.reorder_quantity, 2),
        last_updated=inv.last_updated,
        needs_reorder=needs_reorder,
        status=status,
        days_until_reorder=round(max(days_left, 0.0), 1) if days_left is not None else None,
        avg_daily_demand=round(avg_daily, 3),
        demand_std=round(sigma, 3),
        unit_price=price,
    )


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("", response_model=List[InventoryOut])
def list_inventory(db: Session = Depends(get_db)):
    """
    Return inventory metrics (current stock, safety stock, reorder point, EOQ)
    for all products.
    """
    rows = (
        db.query(Inventory, Product.name.label("product_name"), Product.price)
        .join(Product, Product.id == Inventory.product_id)
        .all()
    )
    if not rows:
        raise HTTPException(
            status_code=503,
            detail="No inventory data found. Run `python -m services.inventory_logic` first."
        )

    return [_to_out(inv, name, price) for inv, name, price in rows]


@router.get("/{product_id}", response_model=InventoryOut)
def get_inventory(product_id: int, db: Session = Depends(get_db)):
    """Return inventory metrics for a single product."""
    row = (
        db.query(Inventory, Product.name.label("product_name"), Product.price)
        .join(Product, Product.id == Inventory.product_id)
        .filter(Inventory.product_id == product_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail=f"No inventory record for product_id={product_id}")

    return _to_out(*row)


@router.post("/recompute", response_model=RecomputeResult)
def recompute_inventory():
    """
    Trigger a full recompute of Safety Stock, Reorder Point, and EOQ
    from the latest sales_history data and write results to the DB.
    """
    try:
        from services.inventory_logic import main as inventory_main
        from database import SessionLocal
        inventory_main()
        with SessionLocal() as db:
            count = db.query(Inventory).count()
        return RecomputeResult(status="success", products_updated=count)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Recompute failed: {str(exc)}")
