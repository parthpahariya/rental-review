"""record who added each location and flat, so they can edit it"""

import sqlalchemy as sa
from alembic import op

revision = "b5d8e3f1a6c2"
down_revision = "9e2f6a1b3c58"
branch_labels = None
depends_on = None


def upgrade():
    for table in ("locations", "flats"):
        op.add_column(table, sa.Column("created_by", sa.Uuid(), nullable=True))
        op.create_foreign_key(
            f"{table}_created_by_fkey", table, "users", ["created_by"], ["id"]
        )
        op.create_index(op.f(f"ix_{table}_created_by"), table, ["created_by"], unique=False)


def downgrade():
    for table in ("flats", "locations"):
        op.drop_index(op.f(f"ix_{table}_created_by"), table_name=table)
        op.drop_constraint(f"{table}_created_by_fkey", table, type_="foreignkey")
        op.drop_column(table, "created_by")
