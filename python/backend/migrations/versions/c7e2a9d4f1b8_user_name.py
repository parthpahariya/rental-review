"""store the Google account's display name on users"""

import sqlalchemy as sa
from alembic import op

revision = "c7e2a9d4f1b8"
down_revision = "b5d8e3f1a6c2"
branch_labels = None
depends_on = None


def upgrade():
    # Existing accounts get their name on their next Google sign-in.
    op.add_column("users", sa.Column("name", sa.String(length=200), nullable=True))


def downgrade():
    op.drop_column("users", "name")
