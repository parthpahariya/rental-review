"""Sessions and account management. Accounts sign in with Google (see google.py)."""

import math
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import update
from sqlalchemy.orm import Session as DbSession

from .common import account_data, current_user, digest, fail, lock
from .config import get_settings
from .database import get_db
from .models import RateLimit, Session, User, now
from .schemas import ConfirmationBody

router = APIRouter()


def rate_limit(db, action, subject, maximum, window=3600, code="RATE_LIMITED"):
    key = digest(f"rate:{action}:{subject}")
    lock(db, key)
    bucket = db.get(RateLimit, key)
    instant = now()
    if bucket is None:
        bucket = RateLimit(key=key, window_started_at=instant, attempts=0)
        db.add(bucket)
    elif bucket.window_started_at + timedelta(seconds=window) <= instant:
        bucket.window_started_at, bucket.attempts = instant, 0
    if bucket.attempts >= maximum:
        retry = max(
            1,
            math.ceil(
                (bucket.window_started_at + timedelta(seconds=window) - instant).total_seconds()
            ),
        )
        db.commit()
        fail(
            429,
            code,
            "Too many attempts. Please try again later.",
            retry,
        )
    bucket.attempts += 1
    db.flush()


def new_session(db, user):
    token = secrets.token_urlsafe(48)
    session = Session(
        user_id=user.id,
        token_digest=digest(token),
        expires_at=now() + timedelta(days=get_settings().session_days),
    )
    db.add(session)
    db.flush()
    return {
        "account": account_data(user),
        "session": {"token": token, "token_type": "Bearer", "expires_at": session.expires_at},
    }


@router.get("/me")
def me(user: User = Depends(current_user)):
    return {"data": account_data(user)}


@router.delete("/auth/session", status_code=204)
def logout(request: Request, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    request.state.session.revoked_at = now()
    return Response(status_code=204)


@router.get("/me/deactivation-preview")
def deactivation_preview(user: User = Depends(current_user)):
    return {
        "data": {
            "confirmation_required": True,
            "sessions_will_end": True,
            "tenant_reviews_remain_visible": True,
            "interaction_reviews_remain_visible": True,
            "message": "Deactivating ends your sessions. Your existing tenant reviews and interaction reviews remain visible.",
        }
    }


@router.post("/me/deactivation")
def deactivate(
    body: ConfirmationBody, user: User = Depends(current_user), db: DbSession = Depends(get_db)
):
    user.status, user.deactivated_at = "inactive", now()
    db.execute(
        update(Session)
        .where(Session.user_id == user.id, Session.revoked_at.is_(None))
        .values(revoked_at=now())
    )
    return {"data": {"status": "inactive", "deactivated_at": user.deactivated_at}}
