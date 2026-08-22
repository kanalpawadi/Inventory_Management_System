"""
api/routes/inventory.py

Endpoints:
    GET  /inventory          — list all products' inventory metrics from DB
    GET  /inventory/{id}     — single product's inventory record
    POST /inventory/recompute — rerun inventory_logic to refresh DB values
"""

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

    class Config:
        from_attributes = True


class RecomputeResult(BaseModel):
    status: str
    products_updated: int


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("", response_model=List[InventoryOut])
def list_inventory(db: Session = Depends(get_db)):
    """
    Return inventory metrics (current stock, safety stock, reorder point, EOQ)
    for all products.
    """
    rows = (
        db.query(Inventory, Product.name.label("product_name"))
        .join(Product, Product.id == Inventory.product_id)
        .all()
    )
    if not rows:
        raise HTTPException(
            status_code=503,
            detail="No inventory data found. Run `python -m services.inventory_logic` first."
        )

    result = []
    for inv, product_name in rows:
        result.append(InventoryOut(
            product_id=inv.product_id,
            product_name=product_name,
            current_stock=round(inv.current_stock, 2),
            safety_stock=round(inv.safety_stock, 2),
            reorder_point=round(inv.reorder_point, 2),
            reorder_quantity=round(inv.reorder_quantity, 2),
            last_updated=inv.last_updated,
            needs_reorder=inv.current_stock <= inv.reorder_point,
        ))
    return result


@router.get("/{product_id}", response_model=InventoryOut)
def get_inventory(product_id: int, db: Session = Depends(get_db)):
    """Return inventory metrics for a single product."""
    row = (
        db.query(Inventory, Product.name.label("product_name"))
        .join(Product, Product.id == Inventory.product_id)
        .filter(Inventory.product_id == product_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail=f"No inventory record for product_id={product_id}")

    inv, product_name = row
    return InventoryOut(
        product_id=inv.product_id,
        product_name=product_name,
        current_stock=round(inv.current_stock, 2),
        safety_stock=round(inv.safety_stock, 2),
        reorder_point=round(inv.reorder_point, 2),
        reorder_quantity=round(inv.reorder_quantity, 2),
        last_updated=inv.last_updated,
        needs_reorder=inv.current_stock <= inv.reorder_point,
    )


@router.post("/recompute", response_model=RecomputeResult)
def recompute_inventory():
    """
    Trigger a full recompute of Safety Stock, Reorder Point, and EOQ
    from the latest sales_history data and write results to the DB.
    """
    try:
        from services.inventory_logic import main as inventory_main
        inventory_main()
        # Count how many products were updated
        from database import SessionLocal
        db = SessionLocal()
        count = db.query(Inventory).count()
        db.close()
        return RecomputeResult(status="success", products_updated=count)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Recompute failed: {str(exc)}")
