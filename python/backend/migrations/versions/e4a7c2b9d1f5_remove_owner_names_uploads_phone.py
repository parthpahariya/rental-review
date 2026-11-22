"""remove owner names, file uploads and legacy phone numbers

Reviews no longer name a person, and the site no longer stores documents or
phone numbers: less personal data to hold, protect and answer for. This
deletes that data; a downgrade restores the columns and tables but not the
deleted values. Files already on disk are not touched here: remove the
uploads volume after migrating (see README).
"""

import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "e4a7c2b9d1f5"
down_revision = "d3f8b1c6e9a2"
branch_labels = None
depends_on = None


def upgrade():
    # Uploads: the link tables first, then the files they point to.
    op.drop_table("tenancy_proofs")
    op.drop_table("interaction_attachments")
    op.drop_table("files")

    # The proof policy only governed proof uploads.
    op.drop_column("tenant_reviews", "proof_policy_id")
    op.drop_table("tenancy_proof_policies")

    # Owner names. Dropping the column also drops the checks that used it, so
    # the non-empty text rules are added back on their own.
    op.drop_column("tenant_reviews", "owner_name")
    op.create_check_constraint(
        "ck_tenant_reviews_feedback", "tenant_reviews", "length(trim(feedback)) > 0"
    )
    op.drop_column("interaction_reviews", "owner_name")
    op.create_check_constraint(
        "ck_interaction_reviews_description",
        "interaction_reviews",
        "length(trim(description)) > 0",
    )

    # Legacy phone sign-in data.
    op.drop_constraint("ck_users_mobile_verified", "users", type_="check")
    op.drop_constraint("ck_users_sign_in_method", "users", type_="check")
    op.drop_column("users", "mobile_verified_at")
    op.drop_column("users", "mobile_number")


def downgrade():
    op.add_column("users", sa.Column("mobile_number", sa.String(20), nullable=True))
    op.add_column(
        "users", sa.Column("mobile_verified_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_unique_constraint("users_mobile_number_key", "users", ["mobile_number"])
    op.create_check_constraint(
        "ck_users_sign_in_method",
        "users",
        "mobile_number IS NOT NULL OR google_subject IS NOT NULL",
        postgresql_not_valid=True,
    )
    op.create_check_constraint(
        "ck_users_mobile_verified",
        "users",
        "(mobile_number IS NULL) = (mobile_verified_at IS NULL)",
    )

    # Owner names come back empty-but-present; the old checks required text.
    op.drop_constraint("ck_interaction_reviews_description", "interaction_reviews", type_="check")
    op.add_column(
        "interaction_reviews",
        sa.Column("owner_name", sa.String(200), nullable=False, server_default="Unknown"),
    )
    op.alter_column("interaction_reviews", "owner_name", server_default=None)
    op.create_check_constraint(
        "interaction_reviews_check",
        "interaction_reviews",
        "length(trim(owner_name)) > 0 AND length(trim(description)) > 0",
    )
    op.drop_constraint("ck_tenant_reviews_feedback", "tenant_reviews", type_="check")
    op.add_column(
        "tenant_reviews",
        sa.Column("owner_name", sa.String(200), nullable=False, server_default="Unknown"),
    )
    op.alter_column("tenant_reviews", "owner_name", server_default=None)
    op.create_check_constraint(
        "tenant_reviews_check",
        "tenant_reviews",
        "length(trim(owner_name)) > 0 AND length(trim(feedback)) > 0",
    )

    op.create_table(
        "tenancy_proof_policies",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("proof_required", sa.Boolean(), nullable=False),
        sa.Column("effective_from", sa.DateTime(timezone=True), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    policy_id = uuid.uuid4()
    op.execute(
        sa.text(
            "INSERT INTO tenancy_proof_policies (id, proof_required, effective_from, created_at)"
            " VALUES (:id, false, now(), now())"
        ).bindparams(id=policy_id)
    )
    op.add_column(
        "tenant_reviews",
        sa.Column(
            "proof_policy_id",
            sa.Uuid(),
            sa.ForeignKey("tenancy_proof_policies.id"),
            nullable=False,
            server_default=str(policy_id),
        ),
    )
    op.alter_column("tenant_reviews", "proof_policy_id", server_default=None)

    op.create_table(
        "files",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("uploader_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("purpose", sa.String(30), nullable=False),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("media_type", sa.String(100), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("storage_key", sa.String(64), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("purpose IN ('tenancy_proof', 'interaction_support')"),
        sa.CheckConstraint("size_bytes >= 0"),
    )
    op.create_table(
        "interaction_attachments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "interaction_review_id",
            sa.Uuid(),
            sa.ForeignKey("interaction_reviews.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("file_id", sa.Uuid(), sa.ForeignKey("files.id"), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("removed_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
    )
    op.create_table(
        "tenancy_proofs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "tenant_review_id",
            sa.Uuid(),
            sa.ForeignKey("tenant_reviews.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("file_id", sa.Uuid(), sa.ForeignKey("files.id"), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
