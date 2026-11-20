"""let users set their own display name instead of Google's"""

import sqlalchemy as sa
from alembic import op

revision = "d3f8b1c6e9a2"
down_revision = "c7e2a9d4f1b8"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "users",
        sa.Column("name_is_custom", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade():
    op.drop_column("users", "name_is_custom")
