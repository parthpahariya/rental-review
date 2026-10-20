"""Wait for PostgreSQL service readiness in CI (up to 60 seconds)."""
import os
import time

from sqlalchemy import create_engine, text

engine = create_engine(os.environ["DATABASE_URL"], connect_args={"connect_timeout": 2})
for attempt in range(30):
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        break
    except Exception:
        if attempt == 29:
            raise
        time.sleep(2)
