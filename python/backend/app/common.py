import base64
import hashlib
import hmac
import json
from datetime import timedelta
from uuid import UUID

from fastapi import Depends, Request
from sqlalchemy import select, text
from sqlalchemy.orm import Session as DbSession

from .config import get_settings
from .database import get_db
from .models import Session, User, now


class ApiError(Exception):
    def __init__(self, status, code, message, retry_after=None):
        self.status, self.code, self.message, self.retry_after = status, code, message, retry_after


def fail(status, code, message, retry_after=None):
    raise ApiError(status, code, message, retry_after)


def digest(value):
    return hmac.new(get_settings().secret_key.encode(), value.encode(), hashlib.sha256).hexdigest()


def lock(db, value):
    # Transaction-scoped PostgreSQL locks also cover rows that don't exist yet.
    key = int.from_bytes(hashlib.sha256(value.encode()).digest()[:8], "big", signed=True)
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})


def current_user(request: Request, db: DbSession = Depends(get_db)):
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        fail(401, "UNAUTHENTICATED", "Please sign in to continue.")
    session = db.scalar(
        select(Session).where(
            Session.token_digest == digest(auth[7:]),
            Session.revoked_at.is_(None),
            Session.expires_at > now(),
        )
    )
    if not session:
        fail(401, "UNAUTHENTICATED", "Your session has ended. Please sign in again.")
    # All account writes, including deactivation, take this lock first.
    user = db.scalar(select(User).where(User.id == session.user_id).with_for_update())
    db.refresh(session)
    if session.revoked_at is not None:
        fail(401, "UNAUTHENTICATED", "Your session has ended.")
    if user.status != "active":
        fail(403, "ACCOUNT_INACTIVE", "Reactivate your account to continue.")
    request.state.session = session
    return user


def optional_user(request: Request, db: DbSession = Depends(get_db)):
    """The signed-in viewer for public reads, or None. Never fails: a missing or
    expired token just means the viewer sees what everyone sees."""
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        return None
    return db.scalar(
        select(User)
        .join(Session, Session.user_id == User.id)
        .where(
            Session.token_digest == digest(auth[7:]),
            Session.revoked_at.is_(None),
            Session.expires_at > now(),
            User.status == "active",
        )
    )


def admin_user(user: User = Depends(current_user)):
    if user.role != "admin":
        fail(403, "FORBIDDEN", "Administrator access is required.")
    return user


def get_or_404(db, model, resource_id, lock_row=False):
    query = select(model).where(model.id == resource_id)
    if lock_row:
        query = query.with_for_update()
    row = db.scalar(query)
    if row is None:
        fail(404, "NOT_FOUND", "This record could not be found.")
    return row


def fields(row, names):
    return {name: getattr(row, name) for name in names.split()}


def account_data(user):
    return fields(
        user,
        "id name name_is_custom email role status deactivated_at created_at updated_at",
    ) | {"google_linked": user.google_subject is not None}


def place_of(db, flat_id):
    """Where a review is, for its author's own lists (public shapes only carry ids)."""
    from .models import Flat, Location

    flat = db.get(Flat, flat_id)
    location = db.get(Location, flat.location_id)
    return {
        "building_name": location.building_name,
        "address": location.address,
        "flat_label": flat.label,
        "latitude": location.latitude,
        "longitude": location.longitude,
    }


def own_review_data(db, review):
    from .models import DeletionRequest

    result = review_data(db, review)
    result.update(
        place=place_of(db, review.flat_id),
        deleted_at=review.deleted_at,
        can_edit=review.deleted_at is None and now() < review.submitted_at + timedelta(days=30),
        can_request_deletion=review.deleted_at is None
        and not db.scalar(
            select(DeletionRequest.id).where(
                DeletionRequest.tenant_review_id == review.id, DeletionRequest.status == "pending"
            )
        ),
    )
    return result


def review_data(db, review):
    from .models import Flat

    result = fields(
        review,
        "id flat_id tenancy_start_date tenancy_end_date rating feedback submitted_at updated_at",
    )
    result.update(
        location_id=db.get(Flat, review.flat_id).location_id,
        editing_deadline=review.submitted_at + timedelta(days=30),
        comment_count=comment_count(db, tenant_review_id=review.id),
    )
    return result


def interaction_data(db, row):
    from .models import Flat

    return dict(
        fields(row, "id flat_id description interaction_date submitted_at"),
        location_id=db.get(Flat, row.flat_id).location_id,
        comment_count=comment_count(db, interaction_id=row.id),
    )


COMMENT_EDIT_DAYS = 30


def visible_comments(**subject):
    """Comments in one discussion that are still shown (not deleted or removed)."""
    from .models import Comment

    query = select(Comment).where(Comment.deleted_at.is_(None), Comment.removed_at.is_(None))
    for key, value in subject.items():
        query = query.where(getattr(Comment, key) == value)
    return query


def comment_count(db, **subject):
    from sqlalchemy import func

    return db.scalar(select(func.count()).select_from(visible_comments(**subject).subquery()))


def comment_data(db, row, viewer=None):
    """A comment's public shape. It names no one; `by_subject_author` only says
    whether the commenter also wrote the review or interaction being discussed."""
    from .models import Interaction, TenantReview

    subject = (
        db.get(TenantReview, row.tenant_review_id)
        if row.tenant_review_id
        else db.get(Interaction, row.interaction_id)
    )
    result = fields(row, "id tenant_review_id interaction_id body submitted_at updated_at")
    result.update(
        subject_type="tenant_review" if row.tenant_review_id else "interaction",
        by_subject_author=subject.author_id == row.author_id,
        edited=row.updated_at > row.submitted_at + timedelta(seconds=1),
        editing_deadline=row.submitted_at + timedelta(days=COMMENT_EDIT_DAYS),
    )
    if viewer is not None:
        mine = row.author_id == viewer.id
        result.update(
            mine=mine,
            can_edit=mine and now() < row.submitted_at + timedelta(days=COMMENT_EDIT_DAYS),
        )
    return result


def deletion_data(db, row, admin=False):
    result = fields(
        row, "id tenant_review_id requested_by reason status submitted_at decided_at decision_note"
    )
    if admin:
        from .models import TenantReview

        review = db.get(TenantReview, row.tenant_review_id)
        result.update(
            decided_by=row.decided_by,
            review=review_data(db, review),
            review_deleted_at=review.deleted_at,
        )
    return result


def page(
    db, query, model, serializer, scope, limit=20, cursor=None, chronological=False,
    oldest_first=False,
):
    """One page of `query`. Chronological pages run newest first, or oldest first
    (discussions) with `oldest_first`; others run in id order."""
    offset = 0
    if cursor:
        try:
            raw = base64.urlsafe_b64decode(cursor.encode()).decode()
            payload, signature = raw.rsplit(".", 1)
            if not hmac.compare_digest(signature, digest(payload)):
                raise ValueError()
            data = json.loads(payload)
            if data["scope"] != scope:
                raise ValueError()
            # Keyset cursors are stable when rows earlier in the list disappear.
            after_id = UUID(data["id"])
            if chronological:
                from datetime import datetime

                from sqlalchemy import tuple_

                key = tuple_(model.submitted_at, model.id)
                after = tuple_(datetime.fromisoformat(data["at"]), after_id)
                query = query.where(key > after if oldest_first else key < after)
            else:
                query = query.where(model.id > after_id)
        except (ValueError, KeyError, TypeError):
            fail(400, "INVALID_CURSOR", "This page token is invalid for these filters.")
    if not chronological:
        order = (model.id.asc(),)
    elif oldest_first:
        order = (model.submitted_at.asc(), model.id.asc())
    else:
        order = (model.submitted_at.desc(), model.id.desc())
    rows = db.scalars(query.order_by(*order).offset(offset).limit(limit + 1)).all()
    next_cursor = None
    if len(rows) > limit:
        last = rows[limit - 1]
        payload = json.dumps(
            {
                "scope": scope,
                "id": str(last.id),
                "at": last.submitted_at.isoformat() if chronological else None,
            }
        )
        next_cursor = base64.urlsafe_b64encode(f"{payload}.{digest(payload)}".encode()).decode()
    return {"data": [serializer(row) for row in rows[:limit]], "page": {"next_cursor": next_cursor}}
