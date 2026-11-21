"""remove phone sign-in: drop OTP challenges and end phone-only sessions

Phone accounts and their reviews are kept. Their mobile columns stay as a record,
but nothing can sign in with them any more.
"""

import sqlalchemy as sa
from alembic import op

revision = "9e2f6a1b3c58"
down_revision = "7c41d2e9a8b3"
branch_labels = None
depends_on = None


def upgrade():
    # Accounts without Google can never sign in again; end their open sessions now.
    op.execute(
        "UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL AND user_id IN "
        "(SELECT id FROM users WHERE google_subject IS NULL)"
    )
    op.drop_index(op.f("ix_otp_challenges_mobile_number"), table_name="otp_challenges")
    op.drop_index(op.f("ix_otp_challenges_expires_at"), table_name="otp_challenges")
    op.drop_table("otp_challenges")


def downgrade():
    # Recreates the (empty) table; revoked sessions stay revoked.
    op.create_table(
        "otp_challenges",
        sa.Column("mobile_number", sa.String(length=20), nullable=False),
        sa.Column("code_digest", sa.String(length=64), nullable=False),
        sa.Column("delivery_status", sa.String(length=10), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resend_available_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("invalidated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completion_token_digest", sa.String(length=64), nullable=True),
        sa.Column("completion_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completion_action", sa.String(length=20), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("completion_token_digest"),
    )
    op.create_index(
        op.f("ix_otp_challenges_expires_at"), "otp_challenges", ["expires_at"], unique=False
    )
    op.create_index(
        op.f("ix_otp_challenges_mobile_number"), "otp_challenges", ["mobile_number"], unique=False
    )
