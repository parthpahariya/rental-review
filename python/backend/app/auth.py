import hmac
import math
import secrets
import uuid
from datetime import timedelta

import httpx
from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select, update
from sqlalchemy.orm import Session as DbSession

from .common import account_data, current_user, digest, fail, get_or_404, lock
from .config import get_settings
from .database import get_db
from .models import OtpChallenge, RateLimit, Session, User, now
from .schemas import CompletionBody, ConfirmationBody, PhoneBody, ReactivationBody, VerifyBody

router = APIRouter()


def rate_limit(db, action, subject, maximum, window=3600):
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
            "OTP_REQUEST_LIMITED" if action != "verify" else "OTP_VERIFICATION_LIMITED",
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


def challenge_data(row):
    return {
        "challenge_id": row.id,
        "delivery_status": row.delivery_status,
        "expires_at": row.expires_at,
        "resend_available_at": row.resend_available_at,
        "failure_code": "SMS_DELIVERY_FAILED" if row.delivery_status == "failed" else None,
    }


@router.post("/auth/otp/challenges", status_code=201)
def issue_otp(
    body: PhoneBody, request: Request, response: Response, db: DbSession = Depends(get_db)
):
    settings = get_settings()
    # Use the actual peer IP; never trust arbitrary forwarded headers.
    ip = request.client.host if request.client else "unknown"
    rate_limit(db, "request", f"ip:{ip}", settings.otp_request_ip_limit)
    rate_limit(db, "request", body.mobile_number, settings.otp_request_phone_limit)
    lock(db, f"phone:{body.mobile_number}")
    latest = db.scalar(
        select(OtpChallenge)
        .where(OtpChallenge.mobile_number == body.mobile_number)
        .order_by(OtpChallenge.created_at.desc())
        .limit(1)
    )
    instant = now()
    if latest and latest.resend_available_at > instant:
        retry = math.ceil((latest.resend_available_at - instant).total_seconds())
        db.commit()
        fail(429, "OTP_RESEND_COOLDOWN", "Please wait before requesting another code.", retry)
    db.execute(
        update(OtpChallenge)
        .where(
            OtpChallenge.mobile_number == body.mobile_number,
            OtpChallenge.consumed_at.is_(None),
            OtpChallenge.invalidated_at.is_(None),
        )
        .values(invalidated_at=instant)
    )
    code = f"{secrets.randbelow(1000000):06}"
    challenge_id = uuid.uuid4()
    row = OtpChallenge(
        id=challenge_id,
        mobile_number=body.mobile_number,
        code_digest=digest(f"{challenge_id}:{code}"),
        expires_at=instant + timedelta(seconds=settings.otp_ttl_seconds),
        resend_available_at=instant + timedelta(seconds=settings.otp_cooldown_seconds),
    )
    db.add(row)
    db.commit()
    if settings.sms_backend == "twilio":
        try:
            result = httpx.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{settings.twilio_account_sid}/Messages.json",
                auth=(settings.twilio_account_sid, settings.twilio_auth_token),
                timeout=10,
                data={
                    "To": body.mobile_number,
                    "From": settings.twilio_from_number,
                    "Body": f"Your Rental Review sign-in code is {code}.",
                },
            )
            result.raise_for_status()
        except httpx.HTTPError:
            row.delivery_status = "failed"
            db.commit()
            fail(
                503,
                "SMS_DELIVERY_FAILED",
                "SMS delivery failed. Please request a new code after the cooldown.",
                settings.otp_cooldown_seconds,
            )
    data = challenge_data(row)
    if settings.sms_backend == "development":
        # Explicit local-only delivery channel; never stored or logged in plaintext.
        data["development_code"] = code
    response.headers["Location"] = f"/api/v1/auth/otp/challenges/{row.id}"
    return {"data": data}


@router.get("/auth/otp/challenges/{challenge_id}")
def otp_status(challenge_id: uuid.UUID, request: Request, db: DbSession = Depends(get_db)):
    rate_limit(db, "poll", request.client.host if request.client else "unknown", 120, 60)
    return {"data": challenge_data(get_or_404(db, OtpChallenge, challenge_id))}


@router.post("/auth/otp/verifications")
def verify_otp(body: VerifyBody, request: Request, db: DbSession = Depends(get_db)):
    settings = get_settings()
    rate_limit(
        db,
        "verify",
        f"ip:{request.client.host if request.client else 'unknown'}",
        settings.otp_verify_ip_limit,
    )
    candidate = db.get(OtpChallenge, body.challenge_id)
    if candidate is None:
        db.commit()
        fail(401, "OTP_INVALID", "This sign-in code is invalid.")
    rate_limit(db, "verify", candidate.mobile_number, settings.otp_verify_phone_limit)
    lock(db, f"phone:{candidate.mobile_number}")
    row = db.scalar(
        select(OtpChallenge)
        .where(OtpChallenge.id == body.challenge_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if row.invalidated_at:
        db.commit()
        fail(409, "OTP_REPLACED", "Use the most recently requested code.")
    if row.consumed_at:
        db.commit()
        fail(409, "OTP_ALREADY_USED", "This code has already been used.")
    if row.expires_at <= now():
        db.commit()
        fail(410, "OTP_EXPIRED", "This code has expired. Request a new one.")
    if row.attempt_count >= settings.otp_max_attempts:
        db.commit()
        fail(
            429,
            "OTP_VERIFICATION_LIMITED",
            "Too many incorrect codes. Request a new code.",
            settings.otp_cooldown_seconds,
        )
    if row.delivery_status != "sent" or not hmac.compare_digest(
        row.code_digest, digest(f"{row.id}:{body.code}")
    ):
        row.attempt_count += 1
        db.commit()
        fail(401, "OTP_INVALID", "The code is incorrect. Please try again.")
    row.consumed_at = now()
    user = db.scalar(select(User).where(User.mobile_number == row.mobile_number).with_for_update())
    if user and user.status == "active":
        row.completed_at = now()
        return {"data": {"outcome": "signed_in", **new_session(db, user)}}
    token = secrets.token_urlsafe(48)
    row.completion_token_digest = digest(token)
    row.completion_expires_at = now() + timedelta(minutes=10)
    row.completion_action = "registration" if user is None else "reactivation"
    return {
        "data": {
            "outcome": f"{row.completion_action}_required",
            "completion_token": token,
            "completion_expires_at": row.completion_expires_at,
        }
    }


def continuation(db, token, action):
    row = db.scalar(
        select(OtpChallenge).where(OtpChallenge.completion_token_digest == digest(token))
    )
    if row is None or row.completion_action != action:
        fail(401, "COMPLETION_TOKEN_INVALID", "Please verify your number again.")
    lock(db, f"phone:{row.mobile_number}")
    row = db.scalar(
        select(OtpChallenge)
        .where(OtpChallenge.id == row.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if row.completed_at:
        fail(409, "COMPLETION_TOKEN_USED", "This verification has already been completed.")
    if row.completion_expires_at <= now():
        fail(401, "COMPLETION_TOKEN_EXPIRED", "Verification expired. Please request a new code.")
    row.completed_at = now()
    return row


@router.post("/auth/registrations", status_code=201)
def register(body: CompletionBody, response: Response, db: DbSession = Depends(get_db)):
    challenge = continuation(db, body.completion_token, "registration")
    if db.scalar(select(User.id).where(User.mobile_number == challenge.mobile_number)):
        fail(409, "ACCOUNT_ALREADY_EXISTS", "Account already exists. Sign in with a fresh code.")
    user = User(mobile_number=challenge.mobile_number, mobile_verified_at=challenge.consumed_at)
    db.add(user)
    db.flush()
    response.headers["Location"] = "/api/v1/me"
    return {"data": new_session(db, user)}


@router.post("/auth/reactivations")
def reactivate(body: ReactivationBody, db: DbSession = Depends(get_db)):
    challenge = continuation(db, body.completion_token, "reactivation")
    user = db.scalar(
        select(User).where(User.mobile_number == challenge.mobile_number).with_for_update()
    )
    if user is None or user.status != "inactive":
        fail(409, "AUTH_FLOW_CHANGED", "Account status changed. Sign in with a fresh code.")
    user.status, user.deactivated_at = "active", None
    db.flush()
    return {"data": new_session(db, user)}


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
