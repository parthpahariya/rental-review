import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

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
    monkeypatch.setattr(settings, "otp_cooldown_seconds", 0)
    monkeypatch.setattr(settings, "otp_request_phone_limit", 100)
    monkeypatch.setattr(settings, "otp_request_ip_limit", 1000)
    monkeypatch.setattr(settings, "otp_verify_phone_limit", 100)
    monkeypatch.setattr(settings, "otp_verify_ip_limit", 1000)
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


def sign_in(client, phone="+919876543210"):
    challenge = client.post("/api/v1/auth/otp/challenges", json={"mobile_number": phone})
    assert challenge.status_code == 201, challenge.text
    challenge = challenge.json()["data"]
    verification = client.post(
        "/api/v1/auth/otp/verifications",
        json={
            "challenge_id": challenge["challenge_id"],
            "code": challenge["development_code"],
        },
    )
    assert verification.status_code == 200, verification.text
    result = verification.json()["data"]
    if result["outcome"] == "registration_required":
        registration = client.post(
            "/api/v1/auth/registrations", json={"completion_token": result["completion_token"]}
        )
        assert registration.status_code == 201, registration.text
        result = registration.json()["data"]
    return {"Authorization": f"Bearer {result['session']['token']}"}, result["account"]


@pytest.fixture
def auth(client):
    return sign_in(client)[0]
