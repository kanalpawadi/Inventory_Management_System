"""
models/tables.py
SQLAlchemy ORM models for the inventory demand forecasting system.
"""

from sqlalchemy import (
    Column, Integer, Float, String, Date, DateTime, Boolean, ForeignKey, func
)
from sqlalchemy.orm import relationship

import sys, os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from database import Base


class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    item_id = Column(String, nullable=True, index=True)
    store_id = Column(String, nullable=True)
    category = Column(String, nullable=False)
    price = Column(Float, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    sales_history = relationship("SalesHistory", back_populates="product", cascade="all, delete-orphan")
    forecasts = relationship("Forecast", back_populates="product", cascade="all, delete-orphan")
    inventory = relationship("Inventory", back_populates="product", uselist=False, cascade="all, delete-orphan")
    anomalies = relationship("Anomaly", back_populates="product", cascade="all, delete-orphan")


class SalesHistory(Base):
    __tablename__ = "sales_history"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)
    quantity_sold = Column(Float, nullable=False)
    price = Column(Float, nullable=True)
    promo_flag = Column(Boolean, default=False)
    is_holiday = Column(Boolean, default=False)

    product = relationship("Product", back_populates="sales_history")


class Forecast(Base):
    __tablename__ = "forecasts"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)
    model_name = Column(String, nullable=False)
    predicted_demand = Column(Float, nullable=False)
    confidence_lower = Column(Float, nullable=True)
    confidence_upper = Column(Float, nullable=True)

    product = relationship("Product", back_populates="forecasts")


class Inventory(Base):
    __tablename__ = "inventory"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, unique=True, index=True)
    current_stock = Column(Float, default=0)
    safety_stock = Column(Float, default=0)
    reorder_point = Column(Float, default=0)
    reorder_quantity = Column(Float, default=0)
    last_updated = Column(DateTime, server_default=func.now(), onupdate=func.now())

    product = relationship("Product", back_populates="inventory")


class Anomaly(Base):
    __tablename__ = "anomalies"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)
    actual_value = Column(Float, nullable=False)
    expected_value = Column(Float, nullable=False)
    severity = Column(String, nullable=True)
    reason = Column(String, nullable=True)

    product = relationship("Product", back_populates="anomalies")