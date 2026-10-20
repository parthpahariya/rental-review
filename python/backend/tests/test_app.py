import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import get_settings
from app.database import SessionLocal
from app.main import app
from app.models import File, OtpChallenge, ProofPolicy, TenantReview, User, now
from tests.conftest import sign_in


def review_payload(**changes):
    return {
        "owner_name": "Owner One",
        "rating": 4,
        "feedback": "Helpful and responsive.",
        "tenancy_start_date": "2024-01-01",
        "tenancy_end_date": "2025-01-01",
        **changes,
    }


def interaction_payload(**changes):
    return {
        "owner_name": "Owner Two",
        "description": "A helpful viewing.",
        "interaction_date": "2025-02-01",
        **changes,
    }


def create_review(client, flat_id, auth, **changes):
    response = client.post(
        f"/api/v1/flats/{flat_id}/tenant-reviews", headers=auth, json=review_payload(**changes)
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


def test_health_and_anonymous_auth(client):
    assert client.get("/api/health/ready").json()["database"] == "ok"
    response = client.get("/api/v1/me")
    assert response.status_code == 401
    assert response.headers["x-request-id"] == response.json()["error"]["request_id"]
    assert response.headers["cache-control"] == "no-store"


def test_otp_single_use_and_existing_account(client):
    first, account = sign_in(client)
    second, account2 = sign_in(client)
    assert account["id"] == account2["id"]
    assert first != second
    with SessionLocal() as db:
        row = db.scalar(select(OtpChallenge).order_by(OtpChallenge.created_at.desc()).limit(1))
        challenge_id = str(row.id)
    response = client.post(
        "/api/v1/auth/otp/verifications", json={"challenge_id": challenge_id, "code": "000000"}
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "OTP_ALREADY_USED"


def test_otp_replacement_wrong_attempts_and_expiry(client):
    phone = {"mobile_number": "+919876543210"}
    first = client.post("/api/v1/auth/otp/challenges", json=phone).json()["data"]
    second = client.post("/api/v1/auth/otp/challenges", json=phone).json()["data"]
    replaced = client.post(
        "/api/v1/auth/otp/verifications",
        json={"challenge_id": first["challenge_id"], "code": first["development_code"]},
    )
    assert replaced.json()["error"]["code"] == "OTP_REPLACED"
    wrong = "000000" if second["development_code"] != "000000" else "111111"
    invalid = client.post(
        "/api/v1/auth/otp/verifications",
        json={"challenge_id": second["challenge_id"], "code": wrong},
    )
    assert invalid.status_code == 401
    with SessionLocal.begin() as db:
        row = db.get(OtpChallenge, uuid.UUID(second["challenge_id"]))
        assert row.attempt_count == 1
        assert row.code_digest != second["development_code"]
        row.expires_at = now() - timedelta(seconds=1)
    expired = client.post(
        "/api/v1/auth/otp/verifications",
        json={"challenge_id": second["challenge_id"], "code": second["development_code"]},
    )
    assert expired.status_code == 410


def test_otp_rate_limit_persists_across_challenges(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "otp_request_phone_limit", 2)
    for _ in range(2):
        assert (
            client.post(
                "/api/v1/auth/otp/challenges", json={"mobile_number": "+919876543210"}
            ).status_code
            == 201
        )
    response = client.post("/api/v1/auth/otp/challenges", json={"mobile_number": "+919876543210"})
    assert response.status_code == 429
    assert int(response.headers["retry-after"]) > 0


@pytest.mark.parametrize(
    "changes",
    [
        {"owner_name": " "},
        {"owner_name": None},
        {"rating": 0},
        {"rating": 6},
        {"rating": True},
        {"rating": 3.5},
        {"feedback": " "},
        {"tenancy_start_date": "2025-01-01"},
        {"tenancy_end_date": "2023-01-01"},
        {"tenancy_start_date": "invalid"},
        {"author_id": str(uuid.uuid4())},
    ],
)
def test_review_validation(client, auth, flat_id, changes):
    response = client.post(
        f"/api/v1/flats/{flat_id}/tenant-reviews", headers=auth, json=review_payload(**changes)
    )
    assert response.status_code == 422, response.text


def test_period_conflicts_same_author_and_adjacent_periods(client, auth, flat_id):
    create_review(client, flat_id, auth)
    create_review(client, flat_id, auth, owner_name="Another owner")
    other, _ = sign_in(client, "+919876543211")
    conflict = client.post(
        f"/api/v1/flats/{flat_id}/tenant-reviews",
        headers=other,
        json=review_payload(owner_name="Different owner"),
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "TENANCY_PERIOD_CONFLICT"
    create_review(
        client, flat_id, other, tenancy_start_date="2025-01-01", tenancy_end_date="2026-01-01"
    )


def test_concurrent_period_conflict(client, auth, flat_id):
    other, _ = sign_in(client, "+919876543211")
    barrier = Barrier(2)

    def submit(headers):
        with TestClient(app) as worker:
            barrier.wait()
            return worker.post(
                f"/api/v1/flats/{flat_id}/tenant-reviews", headers=headers, json=review_payload()
            ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        codes = list(pool.map(submit, [auth, other]))
    assert sorted(codes) == [201, 409]


def test_edit_deadline_auth_and_immutable_fields(client, auth, flat_id):
    review = create_review(client, flat_id, auth)
    path = f"/api/v1/tenant-reviews/{review['id']}"
    edited = client.patch(path, headers=auth, json={"rating": 5, "feedback": "Updated feedback."})
    assert edited.status_code == 200
    assert edited.json()["data"]["editing_deadline"] == review["editing_deadline"]
    other, _ = sign_in(client, "+919876543211")
    assert client.patch(path, headers=other, json={"rating": 2}).status_code == 403
    assert (
        client.patch(path, headers=auth, json={"tenancy_start_date": "2025-01-01"}).status_code
        == 422
    )
    assert client.patch(path, headers=auth, json={"rating": None}).status_code == 422
    assert client.delete(path, headers=auth).status_code == 405
    with SessionLocal.begin() as db:
        db.get(TenantReview, uuid.UUID(review["id"])).submitted_at = now() - timedelta(days=30)
    assert (
        client.patch(path, headers=auth, json={"rating": 4}).json()["error"]["code"]
        == "EDIT_WINDOW_CLOSED"
    )


def test_interaction_uniqueness_and_public_privacy(client, auth, flat_id):
    path = f"/api/v1/flats/{flat_id}/interactions"
    created = client.post(path, headers=auth, json=interaction_payload())
    assert created.status_code == 201
    assert created.json()["data"]["owner_name"] == "Owner Two"
    assert not {"mobile_number", "author_id", "files"}.intersection(created.json()["data"])
    assert (
        client.post(
            path, headers=auth, json=interaction_payload(owner_name="Different")
        ).status_code
        == 409
    )
    location = client.get("/api/v1/locations").json()["data"][0]
    assert location["summary"]["average_rating"] is None
    assert location["summary"]["interaction_review_count"] == 1
    assert client.get(path).json()["data"][0]["id"] == created.json()["data"]["id"]
    assert (
        client.delete(
            f"/api/v1/interactions/{created.json()['data']['id']}", headers=auth
        ).status_code
        == 405
    )


def test_concurrent_duplicate_interaction(client, auth, flat_id):
    barrier = Barrier(2)

    def submit(_):
        with TestClient(app) as worker:
            barrier.wait()
            return worker.post(
                f"/api/v1/flats/{flat_id}/interactions", headers=auth, json=interaction_payload()
            ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        codes = list(pool.map(submit, range(2)))
    assert sorted(codes) == [201, 409]


def test_deactivation_keeps_public_reviews_and_reactivation_reuses_account(client, auth, flat_id):
    account = client.get("/api/v1/me", headers=auth).json()["data"]
    review = create_review(client, flat_id, auth)
    client.post(f"/api/v1/flats/{flat_id}/interactions", headers=auth, json=interaction_payload())
    second, _ = sign_in(client)
    assert (
        client.post("/api/v1/me/deactivation", headers=auth, json={"confirm": False}).status_code
        == 422
    )
    assert (
        client.post("/api/v1/me/deactivation", headers=auth, json={"confirm": True}).status_code
        == 200
    )
    for headers in [auth, second]:
        assert client.get("/api/v1/me", headers=headers).status_code == 401
    assert client.get(f"/api/v1/tenant-reviews/{review['id']}").status_code == 200
    assert len(client.get(f"/api/v1/flats/{flat_id}/interactions").json()["data"]) == 1
    c = client.post(
        "/api/v1/auth/otp/challenges", json={"mobile_number": account["mobile_number"]}
    ).json()["data"]
    v = client.post(
        "/api/v1/auth/otp/verifications",
        json={"challenge_id": c["challenge_id"], "code": c["development_code"]},
    ).json()["data"]
    assert v["outcome"] == "reactivation_required" and "session" not in v
    r = client.post(
        "/api/v1/auth/reactivations",
        json={"completion_token": v["completion_token"], "confirm": True},
    )
    assert r.json()["data"]["account"]["id"] == account["id"]
    assert client.get("/api/v1/me", headers=auth).status_code == 401


def test_admin_deletion_releases_period_and_updates_map(client, auth, flat_id):
    review = create_review(client, flat_id, auth)
    path = f"/api/v1/tenant-reviews/{review['id']}/deletion-requests"
    request = client.post(path, headers=auth, json={"reason": "Please remove my review."})
    assert request.status_code == 201
    assert client.post(path, headers=auth, json={"reason": "Again"}).status_code == 409
    assert client.get(f"/api/v1/tenant-reviews/{review['id']}").status_code == 200
    admin, account = sign_in(client, "+919876543211")
    decision = f"/api/v1/admin/deletion-requests/{request.json()['data']['id']}/decision"
    assert client.post(decision, headers=admin, json={"decision": "approved"}).status_code == 403
    with SessionLocal.begin() as db:
        db.get(User, uuid.UUID(account["id"])).role = "admin"
    assert client.post(decision, headers=admin, json={"decision": "approved"}).status_code == 200
    assert client.post(decision, headers=admin, json={"decision": "rejected"}).status_code == 409
    assert client.get(f"/api/v1/tenant-reviews/{review['id']}").status_code == 404
    assert client.get("/api/v1/locations").json()["data"] == []
    create_review(client, flat_id, admin)


def test_files_are_private_validated_and_proof_policy_is_authoritative(client, auth, flat_id):
    with SessionLocal.begin() as db:
        db.add(ProofPolicy(proof_required=True))
    path = f"/api/v1/flats/{flat_id}/tenant-reviews"
    assert (
        client.post(path, headers=auth, json=review_payload()).json()["error"]["code"]
        == "PROOF_REQUIRED"
    )
    invalid = client.post(
        "/api/v1/files",
        headers=auth,
        data={"purpose": "tenancy_proof"},
        files={"file": ("x.pdf", b"not a pdf", "application/pdf")},
    )
    assert invalid.status_code == 415
    response = client.post(
        "/api/v1/files",
        headers=auth,
        data={"purpose": "tenancy_proof"},
        files={"file": ("../../proof.pdf", b"%PDF-1.4\ntest", "application/pdf")},
    )
    assert response.status_code == 202, response.text
    file = response.json()["data"]
    assert file["original_filename"] == "proof.pdf" and "storage_key" not in file
    other, _ = sign_in(client, "+919876543211")
    assert client.get(f"/api/v1/files/{file['id']}/content", headers=other).status_code == 404
    assert (
        client.get(f"/api/v1/files/{file['id']}/content", headers=auth).content == b"%PDF-1.4\ntest"
    )
    created = create_review(client, flat_id, auth, proof_file_ids=[file["id"]])
    assert "proof" not in created
    proofs_path = f"/api/v1/me/tenant-reviews/{created['id']}/proofs"
    assert client.get(proofs_path, headers=auth).json()["data"][0]["file"]["id"] == file["id"]
    assert client.get(proofs_path, headers=other).status_code == 404
    assert (
        client.post(
            path, headers=auth, json=review_payload(proof_file_ids=[file["id"]])
        ).status_code
        == 409
    )


def test_attachment_removal_keeps_interaction_and_hides_file(client, auth, flat_id):
    file = client.post(
        "/api/v1/files",
        headers=auth,
        data={"purpose": "interaction_support"},
        files={"file": ("note.pdf", b"%PDF-1.4\nnote", "application/pdf")},
    ).json()["data"]
    interaction = client.post(
        f"/api/v1/flats/{flat_id}/interactions",
        headers=auth,
        json=interaction_payload(supporting_file_ids=[file["id"]]),
    ).json()["data"]
    path = f"/api/v1/interactions/{interaction['id']}/attachments"
    attachment = client.get(path, headers=auth).json()["data"][0]
    assert client.delete(f"{path}/{attachment['id']}", headers=auth).status_code == 204
    assert client.delete(f"{path}/{attachment['id']}", headers=auth).status_code == 204
    assert client.get(f"/api/v1/files/{file['id']}/content", headers=auth).status_code == 404
    assert client.get(f"/api/v1/interactions/{interaction['id']}").status_code == 200
    with SessionLocal() as db:
        assert db.get(File, uuid.UUID(file["id"])).status == "deletion_pending"


def test_pagination_scopes_and_invalid_bounds(client, auth, flat_id):
    for _ in range(3):
        create_review(client, flat_id, auth)
    path = f"/api/v1/flats/{flat_id}/tenant-reviews"
    first = client.get(path, params={"limit": 2}).json()
    assert len(first["data"]) == 2
    cursor = first["page"]["next_cursor"]
    assert cursor
    second = client.get(path, params={"limit": 2, "cursor": cursor}).json()
    assert len(second["data"]) == 1 and second["page"]["next_cursor"] is None
    assert not {r["id"] for r in first["data"]}.intersection(r["id"] for r in second["data"])
    assert client.get("/api/v1/locations", params={"cursor": cursor}).status_code == 400
    assert client.get(path, params={"cursor": "invalid"}).status_code == 400
    for bbox in ["nan,0,1,1", "0,50,1,40", "bad", "181,0,1,1"]:
        assert client.get("/api/v1/locations", params={"bbox": bbox}).status_code == 400


def test_production_rejects_development_sms_and_default_secret():
    from app.config import Settings

    with pytest.raises(ValueError):
        Settings(app_env="production", sms_backend="development")
