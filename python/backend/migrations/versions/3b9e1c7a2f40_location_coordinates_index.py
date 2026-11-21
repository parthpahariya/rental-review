"""location coordinates index for map viewport queries"""

from alembic import op

revision = "3b9e1c7a2f40"
down_revision = "d8efcead55cd"
branch_labels = None
depends_on = None


def upgrade():
    op.create_index("ix_location_coordinates", "locations", ["latitude", "longitude"])


def downgrade():
    op.drop_index("ix_location_coordinates", table_name="locations")
