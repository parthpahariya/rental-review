import time
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from sqlalchemy import text

from app import google
from app.config import get_settings
from app.database import Base, SessionLocal, engine
from app.main import app
from app.models import Flat, Location, ProofPolicy


@pytest.fixture(autouse=True)
def clean_database(tmp_path, monkeypatch):
    settings = get_settings()
    if settings.app_env != "test" or not engine.url.database.endswith("_test"):
        pytest.fail("Integration tests require APP_ENV=test and a database ending in _test")
    monkeypatch.setattr(settings, "upload_dir", tmp_path)
    with engine.begin() as connection:
        tables = ", ".join(f'"{table.name}"' for table in Base.metadata.sorted_tables)
        connection.execute(text(f"TRUNCATE {tables} CASCADE"))
    with SessionLocal.begin() as db:
        db.add(ProofPolicy(proof_required=False))
    yield


@pytest.fixture
def client():
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client


@pytest.fixture
def flat_id():
    with SessionLocal.begin() as db:
        location = Location(
            address="Test address", building_name="Test House", latitude=12.97, longitude=77.64
        )
        db.add(location)
        db.flush()
        flat = Flat(location_id=location.id, label="101")
        db.add(flat)
        db.flush()
        return str(flat.id)


GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com"
GOOGLE_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(autouse=True)
def google_enabled(monkeypatch):
    monkeypatch.setattr(get_settings(), "google_client_ids", GOOGLE_CLIENT_ID)
    # Stands in for Google's published keys; token decoding and claim checks stay real.
    keys = SimpleNamespace(
        get_signing_key_from_jwt=lambda token: SimpleNamespace(key=GOOGLE_KEY.public_key())
    )
    monkeypatch.setattr(google, "_keys", keys)


def google_token(key=GOOGLE_KEY, **changes):
    claims = {
        "iss": "https://accounts.google.com",
        "aud": GOOGLE_CLIENT_ID,
        "sub": "1234567890",
        "email": "tenant@example.com",
        "email_verified": True,
        "iat": int(time.time()),
        "exp": int(time.time()) + 600,
        **changes,
    }
    return jwt.encode({k: v for k, v in claims.items() if v is not None}, key, algorithm="RS256")


def sign_in(client, who="tenant"):
    """Signs in as the Google account `who`, creating it the first time."""
    response = client.post(
        "/api/v1/auth/google",
        json={"credential": google_token(sub=f"sub-{who}", email=f"{who}@example.com")},
    )
    assert response.status_code in (200, 201), response.text
    result = response.json()["data"]
    return {"Authorization": f"Bearer {result['session']['token']}"}, result["account"]


@pytest.fixture
def auth(client):
    return sign_in(client)[0]
