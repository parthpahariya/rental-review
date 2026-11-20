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
        "id email role status deactivated_at created_at updated_at",
    ) | {"google_linked": user.google_subject is not None}


def own_review_data(db, review):
    from .models import DeletionRequest

    result = review_data(db, review)
    result.update(
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
        "id flat_id owner_name tenancy_start_date tenancy_end_date rating feedback submitted_at updated_at",
    )
    result.update(
        location_id=db.get(Flat, review.flat_id).location_id,
        editing_deadline=review.submitted_at + timedelta(days=30),
    )
    return result


def interaction_data(db, row):
    from .models import Flat

    return dict(
        fields(row, "id flat_id owner_name description interaction_date submitted_at"),
        location_id=db.get(Flat, row.flat_id).location_id,
    )


def file_data(row):
    return fields(
        row, "id purpose original_filename media_type size_bytes status created_at updated_at"
    )


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


def page(db, query, model, serializer, scope, limit=20, cursor=None, chronological=False):
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

                query = query.where(
                    tuple_(model.submitted_at, model.id)
                    < tuple_(datetime.fromisoformat(data["at"]), after_id)
                )
            else:
                query = query.where(model.id > after_id)
        except (ValueError, KeyError, TypeError):
            fail(400, "INVALID_CURSOR", "This page token is invalid for these filters.")
    order = (model.submitted_at.desc(), model.id.desc()) if chronological else (model.id.asc(),)
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
