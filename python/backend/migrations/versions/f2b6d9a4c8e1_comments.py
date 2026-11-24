"""discussions: comments on tenant reviews and interactions, with reports

Adds `comments` (one public discussion per review or interaction, oldest first)
and `comment_reports` (the admin queue for reported comments).
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "f2b6d9a4c8e1"
down_revision = "e4a7c2b9d1f5"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "comments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("author_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "tenant_review_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenant_reviews.id"),
            nullable=True,
        ),
        sa.Column(
            "interaction_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("interaction_reviews.id"),
            nullable=True,
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "(tenant_review_id IS NULL) <> (interaction_id IS NULL)",
            name="ck_comments_one_subject",
        ),
        sa.CheckConstraint("length(trim(body)) > 0", name="ck_comments_body"),
    )
    op.create_index("ix_comments_author_id", "comments", ["author_id"])
    op.create_index(
        "ix_comment_review_order",
        "comments",
        ["tenant_review_id", "submitted_at", "id"],
        postgresql_where=sa.text("tenant_review_id IS NOT NULL"),
    )
    op.create_index(
        "ix_comment_interaction_order",
        "comments",
        ["interaction_id", "submitted_at", "id"],
        postgresql_where=sa.text("interaction_id IS NOT NULL"),
    )

    op.create_table(
        "comment_reports",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("comment_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("comments.id"), nullable=False),
        sa.Column("reported_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("decision_note", sa.Text(), nullable=True),
        sa.CheckConstraint("status IN ('pending', 'removed', 'dismissed')"),
        sa.CheckConstraint("length(trim(reason)) > 0", name="ck_comment_reports_reason"),
        sa.UniqueConstraint("comment_id", "reported_by", name="uq_comment_report_reporter"),
    )
    op.create_index("ix_comment_reports_comment_id", "comment_reports", ["comment_id"])
    op.create_index("ix_comment_reports_reported_by", "comment_reports", ["reported_by"])
    op.create_index("ix_comment_reports_status", "comment_reports", ["status"])


def downgrade():
    op.drop_table("comment_reports")
    op.drop_table("comments")
