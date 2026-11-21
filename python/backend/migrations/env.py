import os

from alembic import context
from sqlalchemy import create_engine, pool

from app import models  # noqa: F401
from app.config import get_settings
from app.database import Base

config = context.config
target_metadata = Base.metadata
# Migrations run as the schema owner when the shared database provides one; the API
# itself connects as the writer (DATABASE_URL), which cannot change tables.
url = os.environ.get("MIGRATION_DATABASE_URL") or get_settings().database_url

if context.is_offline_mode():
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()
else:
    engine = create_engine(url, poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()
