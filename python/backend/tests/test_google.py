import time

import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.config import get_settings
from tests.conftest import GOOGLE_CLIENT_ID, google_token

OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
CLIENT_ID = GOOGLE_CLIENT_ID
token = google_token


def google_sign_in(client, credential, **body):
    return client.post("/api/v1/auth/google", json={"credential": credential, **body})


def test_providers_reports_client_id(client, monkeypatch):
    assert client.get("/api/v1/auth/providers").json()["data"]["google_client_id"] == CLIENT_ID
    monkeypatch.setattr(get_settings(), "google_client_ids", "")
    assert client.get("/api/v1/auth/providers").json()["data"]["google_client_id"] is None
    response = google_sign_in(client, token())
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "GOOGLE_SIGN_IN_DISABLED"


def test_first_sign_in_creates_account(client):
    response = google_sign_in(client, token())
    assert response.status_code == 201, response.text
    data = response.json()["data"]
    assert data["outcome"] == "registered"
    assert "mobile_number" not in data["account"]
    assert data["account"]["email"] == "tenant@example.com"
    assert data["account"]["google_linked"] is True
    auth = {"Authorization": f"Bearer {data['session']['token']}"}
    assert client.get("/api/v1/me", headers=auth).json()["data"]["id"] == data["account"]["id"]

    assert data["account"]["name"] is None  # the test token carries no name
    again = google_sign_in(client, token(email="renamed@example.com"))
    assert again.status_code == 200
    assert again.json()["data"]["outcome"] == "signed_in"
    assert again.json()["data"]["account"]["id"] == data["account"]["id"]
    assert again.json()["data"]["account"]["email"] == "renamed@example.com"


def test_phone_sign_in_is_gone(client):
    for path in ["otp/challenges", "otp/verifications", "registrations", "reactivations"]:
        assert client.post(f"/api/v1/auth/{path}", json={}).status_code == 404


@pytest.mark.parametrize(
    "credential, code",
    [
        (lambda: token(aud="someone-else.apps.googleusercontent.com"), "GOOGLE_TOKEN_INVALID"),
        (lambda: token(iss="https://evil.example.com"), "GOOGLE_TOKEN_INVALID"),
        (lambda: token(exp=int(time.time()) - 120), "GOOGLE_TOKEN_INVALID"),
        (lambda: token(key=OTHER_KEY), "GOOGLE_TOKEN_INVALID"),
        (lambda: token(sub=None), "GOOGLE_TOKEN_INVALID"),
        (lambda: "not-a-jwt-but-long-enough", "GOOGLE_TOKEN_INVALID"),
        (lambda: token(email_verified=False), "GOOGLE_EMAIL_UNVERIFIED"),
    ],
)
def test_rejects_untrustworthy_tokens(client, credential, code):
    response = google_sign_in(client, credential())
    assert response.status_code == 401, response.text
    assert response.json()["error"]["code"] == code


def test_inactive_account_needs_confirmation_to_reactivate(client):
    data = google_sign_in(client, token()).json()["data"]
    auth = {"Authorization": f"Bearer {data['session']['token']}"}
    assert client.post("/api/v1/me/deactivation", headers=auth, json={"confirm": True}).status_code == 200

    pending = google_sign_in(client, token())
    assert pending.status_code == 200
    assert pending.json()["data"] == {"outcome": "reactivation_required"}

    restored = google_sign_in(client, token(), reactivate=True).json()["data"]
    assert restored["outcome"] == "reactivated"
    assert restored["account"]["status"] == "active"
    assert restored["account"]["id"] == data["account"]["id"]


def test_reviews_never_expose_email(client, flat_id):
    session = google_sign_in(client, token()).json()["data"]["session"]["token"]
    response = client.post(
        f"/api/v1/flats/{flat_id}/tenant-reviews",
        headers={"Authorization": f"Bearer {session}"},
        json={
            "owner_name": "Owner One",
            "rating": 4,
            "feedback": "Helpful and responsive.",
            "tenancy_start_date": "2024-01-01",
            "tenancy_end_date": "2025-01-01",
        },
    )
    assert response.status_code == 201, response.text
    # Public review data never exposes the author's email.
    assert "tenant@example.com" not in client.get(
        f"/api/v1/flats/{flat_id}/tenant-reviews").text


def test_name_is_stored_and_refreshed_but_never_public(client, flat_id):
    first = google_sign_in(client, token(name="  Asha   Rao ")).json()["data"]
    assert first["account"]["name"] == "Asha Rao"
    renamed = google_sign_in(client, token(name="Asha R.")).json()["data"]
    assert renamed["account"]["name"] == "Asha R."
    auth = {"Authorization": f"Bearer {renamed['session']['token']}"}
    assert client.get("/api/v1/me", headers=auth).json()["data"]["name"] == "Asha R."
    # Overlong names are cut to fit rather than failing sign-in.
    long = google_sign_in(client, token(name="x" * 300)).json()["data"]
    assert len(long["account"]["name"]) == 200
    client.post(
        f"/api/v1/flats/{flat_id}/tenant-reviews",
        headers=auth,
        json={
            "owner_name": "Owner One",
            "rating": 4,
            "feedback": "Helpful.",
            "tenancy_start_date": "2024-01-01",
            "tenancy_end_date": "2025-01-01",
        },
    )
    public = client.get(f"/api/v1/flats/{flat_id}/tenant-reviews").text
    assert "Asha" not in public and "xxxxxxxxxx" not in public
