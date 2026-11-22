"""Sign in with Google: verifies the ID token Google Identity Services gives the browser."""

import jwt
from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from .auth import new_session, rate_limit
from .common import fail, lock
from .config import get_settings
from .database import get_db
from .models import User
from .schemas import GoogleBody

router = APIRouter()

GOOGLE_KEYS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"]
_keys = None


def verify_credential(credential):
    """Returns the token's claims, or fails if it isn't a valid token for this app."""
    global _keys
    audiences = get_settings().google_audiences
    if not audiences:
        fail(404, "GOOGLE_SIGN_IN_DISABLED", "Google sign-in is not available.")
    if _keys is None:
        # Google rotates its signing keys; they are cached and refetched as needed.
        _keys = jwt.PyJWKClient(GOOGLE_KEYS_URL, cache_keys=True, lifespan=3600, timeout=5)
    try:
        key = _keys.get_signing_key_from_jwt(credential).key
        claims = jwt.decode(
            credential,
            key,
            algorithms=["RS256"],
            audience=audiences,
            issuer=GOOGLE_ISSUERS,
            leeway=30,
            options={"require": ["exp", "iat", "iss", "aud", "sub"]},
        )
    except jwt.PyJWKClientConnectionError:
        fail(503, "GOOGLE_UNAVAILABLE", "Google sign-in is unavailable. Please try again.")
    except jwt.PyJWTError:
        fail(401, "GOOGLE_TOKEN_INVALID", "Google sign-in failed. Please try again.")
    if not claims.get("email") or claims.get("email_verified") is not True:
        fail(401, "GOOGLE_EMAIL_UNVERIFIED", "Use a Google account with a verified email.")
    return claims


def google_name(claims):
    """The account's display name, trimmed to fit; None when Google sends none."""
    name = " ".join(str(claims.get("name") or "").split())
    return name[:200] or None


@router.get("/auth/providers")
def providers():
    audiences = get_settings().google_audiences
    return {"data": {"google_client_id": audiences[0] if audiences else None}}


@router.post("/auth/google")
def google_sign_in(
    body: GoogleBody, request: Request, response: Response, db: DbSession = Depends(get_db)
):
    rate_limit(
        db,
        "google",
        request.client.host if request.client else "unknown",
        get_settings().google_sign_in_ip_limit,
        code="GOOGLE_SIGN_IN_LIMITED",
    )
    db.commit()  # Count the attempt even when the token turns out to be invalid.
    claims = verify_credential(body.credential)
    subject = str(claims["sub"])
    # Serialises a double-click so it cannot create two accounts.
    lock(db, f"google:{subject}")
    user = db.scalar(select(User).where(User.google_subject == subject).with_for_update())
    if user is None:
        user = User(
            google_subject=subject,
            email=claims["email"],
            name=google_name(claims),
        )
        db.add(user)
        db.flush()
        response.status_code = 201
        response.headers["Location"] = "/api/v1/me"
        return {"data": {"outcome": "registered", **new_session(db, user)}}
    user.email = claims["email"]
    if not user.name_is_custom:
        user.name = google_name(claims)
    if user.status == "inactive":
        if not body.reactivate:
            # Reactivating is an explicit choice, confirmed by the user.
            return {"data": {"outcome": "reactivation_required"}}
        user.status, user.deactivated_at = "active", None
        db.flush()
        return {"data": {"outcome": "reactivated", **new_session(db, user)}}
    return {"data": {"outcome": "signed_in", **new_session(db, user)}}
