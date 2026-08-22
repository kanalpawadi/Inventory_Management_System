"""
services/inventory_logic.py

Step 5 (prep): Compute Reorder Point, Safety Stock, and EOQ per product from
historical demand, and write the results into the `inventory` table.

Formulas used (standard inventory theory):
    Safety Stock   = Z * sigma_demand * sqrt(lead_time_days)
    Reorder Point  = (avg_daily_demand * lead_time_days) + Safety Stock
    EOQ            = sqrt((2 * annual_demand * ordering_cost) / holding_cost_per_unit)

Where:
    - avg_daily_demand, sigma_demand: computed from the last DEMAND_WINDOW_DAYS
      of actual sales_history (recent, representative demand behavior)
    - Z: service-level factor (1.645 for ~95% service level)
    - lead_time_days, ordering_cost, holding_cost_rate: business assumptions,
      documented below and easy to tune per product in a real deployment

ASSUMPTIONS (clearly flagged for the report -- M5 has no real inventory/cost
data, so these are reasonable stand-in defaults):
    - lead_time_days = 7          (time between placing and receiving an order)
    - service_level  = 0.95       (95% chance of not stocking out during lead time)
    - ordering_cost  = $50/order  (fixed cost per purchase order)
    - holding_cost_rate = 0.20    (20% of unit price per year, a common retail rule of thumb)
    - current_stock is SIMULATED as reorder_point (i.e. each product starts
      exactly at its trigger point) since M5 has no real stock-on-hand data.
      In a production system this would come from a live inventory feed.

Run:
    cd backend
    python -m services.inventory_logic
"""

import os
import sys

import numpy as np
import pandas as pd
from scipy.stats import norm

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from database import SessionLocal
from models.tables import Product, SalesHistory, Inventory

DEMAND_WINDOW_DAYS = 90
LEAD_TIME_DAYS = 7
SERVICE_LEVEL = 0.95
ORDERING_COST = 50.0
HOLDING_COST_RATE = 0.20  # 20% of unit price per year

Z_SCORE = norm.ppf(SERVICE_LEVEL)


def load_recent_sales() -> pd.DataFrame:
    db = SessionLocal()
    try:
        rows = (
            db.query(
                SalesHistory.product_id,
                Product.name.label("product_name"),
                Product.price,
                SalesHistory.date,
                SalesHistory.quantity_sold,
            )
            .join(Product, Product.id == SalesHistory.product_id)
            .all()
        )
        df = pd.DataFrame(rows, columns=["product_id", "product_name", "price", "date", "quantity_sold"])
        return df
    finally:
        db.close()


def compute_inventory_metrics(product_df: pd.DataFrame, price: float) -> dict:
    recent = product_df.sort_values("date").tail(DEMAND_WINDOW_DAYS)

    avg_daily_demand = recent["quantity_sold"].mean()
    sigma_demand = recent["quantity_sold"].std()
    if pd.isna(sigma_demand):
        sigma_demand = 0.0

    safety_stock = Z_SCORE * sigma_demand * np.sqrt(LEAD_TIME_DAYS)
    reorder_point = (avg_daily_demand * LEAD_TIME_DAYS) + safety_stock

    annual_demand = avg_daily_demand * 365
    holding_cost_per_unit = max(price, 0.01) * HOLDING_COST_RATE
    eoq = np.sqrt((2 * annual_demand * ORDERING_COST) / holding_cost_per_unit) if annual_demand > 0 else 0.0

    # current_stock is simulated -- see module docstring for why
    current_stock = reorder_point

    return {
        "current_stock": float(current_stock),
        "safety_stock": float(safety_stock),
        "reorder_point": float(reorder_point),
        "reorder_quantity": float(eoq),
    }


def write_to_db(product_id: int, metrics: dict):
    db = SessionLocal()
    try:
        existing = db.query(Inventory).filter(Inventory.product_id == product_id).first()
        if existing:
            existing.current_stock = metrics["current_stock"]
            existing.safety_stock = metrics["safety_stock"]
            existing.reorder_point = metrics["reorder_point"]
            existing.reorder_quantity = metrics["reorder_quantity"]
        else:
            db.add(Inventory(product_id=product_id, **metrics))
        db.commit()
    finally:
        db.close()


def main():
    print("Loading recent sales history from Supabase ...")
    df = load_recent_sales()

    print(f"\n{'Product':<10}{'AvgDaily':>10}{'SafetyStk':>12}{'ReorderPt':>12}{'EOQ':>10}")
    print("-" * 54)

    for pid, product_df in df.groupby("product_id"):
        name = product_df["product_name"].iloc[0]
        price = product_df["price"].iloc[0]
        metrics = compute_inventory_metrics(product_df, price)
        write_to_db(int(pid), metrics)

        avg_daily = product_df.sort_values("date").tail(DEMAND_WINDOW_DAYS)["quantity_sold"].mean()
        print(f"{name:<10}{avg_daily:>10.2f}{metrics['safety_stock']:>12.2f}"
              f"{metrics['reorder_point']:>12.2f}{metrics['reorder_quantity']:>10.2f}")

    print(f"\nAssumptions used: lead_time={LEAD_TIME_DAYS}d, service_level={SERVICE_LEVEL}, "
          f"ordering_cost=${ORDERING_COST}, holding_cost_rate={HOLDING_COST_RATE}")
    print("Wrote inventory recommendations to Supabase `inventory` table.")


if __name__ == "__main__":
    main()