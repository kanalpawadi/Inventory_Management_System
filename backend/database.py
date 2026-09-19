"""
database.py
Central SQLAlchemy engine/session setup.
"""

import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

load_dotenv()

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DB = "sqlite:///" + os.path.join(BACKEND_DIR, "demand_forecast.db").replace("\\", "/")

DATABASE_URL = os.getenv("DATABASE_URL", DEFAULT_DB)
# A relative SQLite path ("./x.db") depends on the launch directory — pin it to backend/
if DATABASE_URL.startswith("sqlite:///./"):
    DATABASE_URL = "sqlite:///" + os.path.join(BACKEND_DIR, DATABASE_URL[len("sqlite:///./"):]).replace("\\", "/")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args, future=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()