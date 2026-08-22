"""
test_supabase_connection.py
Run this after setting DATABASE_URL in .env to confirm Supabase is reachable.
"""

from database import Base, engine
from models import tables  # noqa: F401

def main():
    print("Connecting to:", engine.url.render_as_string(hide_password=True))
    with engine.connect() as conn:
        print("Connection OK.")

    print("Creating tables ...")
    Base.metadata.create_all(bind=engine)
    print("Tables created/verified successfully in Supabase.")


if __name__ == "__main__":
    main()