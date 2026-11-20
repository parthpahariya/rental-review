import uuid
from datetime import date, datetime, timezone

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


def now():
    return datetime.now(timezone.utc)


class Identity:
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)


class Timestamps:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class User(Identity, Timestamps, Base):
    __tablename__ = "users"
    mobile_number: Mapped[str] = mapped_column(String(20), unique=True)
    mobile_verified_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    role: Mapped[str] = mapped_column(String(10), default="user")
    status: Mapped[str] = mapped_column(String(10), default="active")
    deactivated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        CheckConstraint("role IN ('user', 'admin')"),
        CheckConstraint("status IN ('active', 'inactive')"),
        CheckConstraint("(status = 'inactive') = (deactivated_at IS NOT NULL)"),
    )


class Session(Identity, Base):
    __tablename__ = "sessions"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    token_digest: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class OtpChallenge(Identity, Base):
    __tablename__ = "otp_challenges"
    mobile_number: Mapped[str] = mapped_column(String(20), index=True)
    code_digest: Mapped[str] = mapped_column(String(64))
    delivery_status: Mapped[str] = mapped_column(String(10), default="sent")
    attempt_count: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    resend_available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    invalidated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completion_token_digest: Mapped[str | None] = mapped_column(String(64), unique=True)
    completion_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completion_action: Mapped[str | None] = mapped_column(String(20))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RateLimit(Base):
    __tablename__ = "auth_rate_limits"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    window_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(default=0)


class Location(Identity, Timestamps, Base):
    """A building pin, stored independently of any map or geocoding provider.

    Only plain WGS84 (EPSG:4326) degrees and user-entered text are kept, which
    Leaflet/OpenStreetMap, Google Maps and Mapbox all use as-is. Do not add
    provider-specific data here (OSM ids, Google place_ids, tile x/y, zoom
    levels, projected Web Mercator metres); if a provider id is ever needed,
    store it in a separate table keyed by (location_id, provider).
    """

    __tablename__ = "locations"
    address: Mapped[str] = mapped_column(Text)
    building_name: Mapped[str | None] = mapped_column(String(200))
    latitude: Mapped[float]
    longitude: Mapped[float]
    __table_args__ = (
        CheckConstraint("latitude BETWEEN -90 AND 90"),
        CheckConstraint("longitude BETWEEN -180 AND 180"),
        CheckConstraint("length(trim(address)) > 0"),
        # Map viewport (bbox) queries must stay fast with crores of buildings.
        Index("ix_location_coordinates", "latitude", "longitude"),
    )


class Flat(Identity, Timestamps, Base):
    __tablename__ = "flats"
    location_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("locations.id"), index=True)
    label: Mapped[str] = mapped_column(String(100))
    __table_args__ = (CheckConstraint("length(trim(label)) > 0"),)


class ProofPolicy(Identity, Base):
    __tablename__ = "tenancy_proof_policies"
    proof_required: Mapped[bool] = mapped_column(Boolean, default=False)
    effective_from: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), unique=True, default=now
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class TenantReview(Identity, Base):
    __tablename__ = "tenant_reviews"
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    flat_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("flats.id"), index=True)
    owner_name: Mapped[str] = mapped_column(String(200))
    tenancy_start_date: Mapped[date]
    tenancy_end_date: Mapped[date]
    rating: Mapped[int]
    feedback: Mapped[str] = mapped_column(Text)
    proof_policy_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenancy_proof_policies.id"))
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        CheckConstraint("rating BETWEEN 1 AND 5"),
        CheckConstraint("tenancy_end_date > tenancy_start_date"),
        CheckConstraint("length(trim(owner_name)) > 0 AND length(trim(feedback)) > 0"),
        Index(
            "ix_review_period",
            "flat_id",
            "tenancy_start_date",
            "tenancy_end_date",
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index("ix_review_order", "flat_id", "submitted_at", "id"),
    )


class Interaction(Identity, Base):
    __tablename__ = "interaction_reviews"
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    flat_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("flats.id"), index=True)
    owner_name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    interaction_date: Mapped[date]
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    __table_args__ = (
        UniqueConstraint("author_id", "flat_id", name="uq_interaction_author_flat"),
        CheckConstraint("length(trim(owner_name)) > 0 AND length(trim(description)) > 0"),
        Index("ix_interaction_order", "flat_id", "submitted_at", "id"),
    )


class File(Identity, Timestamps, Base):
    __tablename__ = "files"
    uploader_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    purpose: Mapped[str] = mapped_column(String(30))
    original_filename: Mapped[str] = mapped_column(String(255))
    media_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int]
    status: Mapped[str] = mapped_column(String(20), default="ready")
    storage_key: Mapped[str] = mapped_column(String(64), unique=True)
    __table_args__ = (
        CheckConstraint("purpose IN ('tenancy_proof', 'interaction_support')"),
        CheckConstraint("size_bytes >= 0"),
    )


class Proof(Identity, Base):
    __tablename__ = "tenancy_proofs"
    tenant_review_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant_reviews.id"), index=True)
    file_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("files.id"), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Attachment(Identity, Base):
    __tablename__ = "interaction_attachments"
    interaction_review_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("interaction_reviews.id"), index=True
    )
    file_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("files.id"), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DeletionRequest(Identity, Base):
    __tablename__ = "review_deletion_requests"
    tenant_review_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant_reviews.id"), index=True)
    requested_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(10), default="pending", index=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decided_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    decision_note: Mapped[str | None] = mapped_column(Text)
    __table_args__ = (
        CheckConstraint("status IN ('pending', 'approved', 'rejected')"),
        CheckConstraint("length(trim(reason)) > 0"),
        Index(
            "uq_pending_deletion",
            "tenant_review_id",
            unique=True,
            postgresql_where=text("status = 'pending'"),
        ),
    )
