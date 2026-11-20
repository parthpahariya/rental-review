"""google sign-in: accounts may have a Google identity instead of a mobile number"""

import sqlalchemy as sa
from alembic import op

revision = "7c41d2e9a8b3"
down_revision = "3b9e1c7a2f40"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("google_subject", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("email", sa.String(length=320), nullable=True))
    op.create_unique_constraint("users_google_subject_key", "users", ["google_subject"])
    op.alter_column("users", "mobile_number", existing_type=sa.String(length=20), nullable=True)
    op.alter_column(
        "users", "mobile_verified_at", existing_type=sa.DateTime(timezone=True), nullable=True
    )
    op.create_check_constraint(
        "ck_users_sign_in_method", "users", "mobile_number IS NOT NULL OR google_subject IS NOT NULL"
    )
    op.create_check_constraint(
        "ck_users_mobile_verified", "users", "(mobile_number IS NULL) = (mobile_verified_at IS NULL)"
    )


def downgrade():
    # Google-only accounts have no phone number to fall back to; their reviews would be
    # orphaned, so refuse rather than delete anyone's data.
    google_only = op.get_bind().scalar(
        sa.text("SELECT count(*) FROM users WHERE mobile_number IS NULL")
    )
    if google_only:
        raise RuntimeError(f"{google_only} Google-only accounts exist; cannot downgrade.")
    op.drop_constraint("ck_users_mobile_verified", "users", type_="check")
    op.drop_constraint("ck_users_sign_in_method", "users", type_="check")
    op.alter_column(
        "users", "mobile_verified_at", existing_type=sa.DateTime(timezone=True), nullable=False
    )
    op.alter_column("users", "mobile_number", existing_type=sa.String(length=20), nullable=False)
    op.drop_constraint("users_google_subject_key", "users", type_="unique")
    op.drop_column("users", "email")
    op.drop_column("users", "google_subject")
