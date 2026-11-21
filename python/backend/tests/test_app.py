import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models import File, Flat, ProofPolicy, TenantReview, User, now
from tests.conftest import google_token, sign_in


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
    assert not {"email", "mobile_number", "author_id", "files"}.intersection(created.json()["data"])
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
    credential = google_token(sub="sub-tenant", email="tenant@example.com")
    v = client.post("/api/v1/auth/google", json={"credential": credential}).json()["data"]
    assert v == {"outcome": "reactivation_required"}
    r = client.post("/api/v1/auth/google", json={"credential": credential, "reactivate": True})
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


def test_production_requires_private_secret_and_google():
    from app.config import Settings

    strong = "x" * 40
    with pytest.raises(ValueError):
        Settings(
            app_env="production", secret_key="short", google_client_ids="id.apps.googleusercontent.com"
        )
    with pytest.raises(ValueError):
        Settings(app_env="production", secret_key=strong, google_client_ids="")
    Settings(app_env="production", secret_key=strong, google_client_ids="id.apps.googleusercontent.com")


def place_payload(**changes):
    return {
        "address": "12 New Road, Bengaluru",
        "building_name": "Fresh Pin House",
        "latitude": 12.9,
        "longitude": 77.5,
        "flat_label": "2B",
        **changes,
    }


def test_locations_store_only_map_neutral_data():
    """Stored places must work with any map provider (Google, OpenStreetMap):
    plain WGS84 degrees and what users typed, never a provider's ids or data."""
    from app.models import Location

    assert {c.name for c in Location.__table__.columns} == {
        "id",
        "address",
        "building_name",
        "latitude",
        "longitude",
        "created_by",
        "created_at",
        "updated_at",
    }


def test_new_pin_rejects_provider_fields(client, auth):
    for field in ("place_id", "google_place_id", "osm_id", "zoom", "viewport"):
        response = client.post(
            "/api/v1/locations", headers=auth, json=place_payload(**{field: "x"})
        )
        assert response.status_code == 422, field


def test_new_pin_creates_location_and_flat_for_reviews(client, auth):
    assert client.post("/api/v1/locations", json=place_payload()).status_code == 401
    response = client.post("/api/v1/locations", headers=auth, json=place_payload())
    assert response.status_code == 201, response.text
    flat = response.json()["data"]
    assert response.headers["location"] == f"/api/v1/flats/{flat['id']}"
    assert flat["label"] == "2B"
    assert flat["location"]["building_name"] == "Fresh Pin House"
    assert flat["summary"]["tenant_review_count"] == 0
    create_review(client, flat["id"], auth)
    markers = client.get("/api/v1/locations").json()["data"]
    assert [m["id"] for m in markers] == [flat["location"]["id"]]
    assert markers[0]["summary"]["tenant_review_count"] == 1


def test_new_pin_rejects_nearby_duplicates_and_bad_input(client, auth, flat_id):
    # The flat_id fixture "Test House" sits at 12.97, 77.64.
    def pin(**changes):
        return client.post("/api/v1/locations", headers=auth, json=place_payload(**changes))

    # Same name ~10 m or ~80 m away (any case/spacing) is the same building.
    for lat in (12.97009, 12.97072):
        same = pin(latitude=lat, longitude=77.64, building_name="  test   HOUSE ")
        assert same.status_code == 409, same.text
        assert same.json()["error"]["code"] == "LOCATION_ALREADY_EXISTS"
    # Unnamed ~10 m away can't be told apart, so it is rejected with a hint.
    unnamed = pin(latitude=12.97009, longitude=77.64, building_name=None)
    assert unnamed.status_code == 409
    assert "add its name" in unnamed.json()["error"]["message"]
    # A differently named building right next door is allowed.
    neighbour = pin(latitude=12.97009, longitude=77.64, building_name="Next Door Towers")
    assert neighbour.status_code == 201, neighbour.text
    # Same name far away (another branch of a chain, say) is a different place.
    far = pin(latitude=12.9720, longitude=77.64, building_name="Test House")
    assert far.status_code == 201, far.text
    for bad in (
        {"address": "  "},
        {"flat_label": ""},
        {"latitude": 91},
        {"longitude": "77"},
        {"owner_id": "x"},
    ):
        response = client.post("/api/v1/locations", headers=auth, json=place_payload(**bad))
        assert response.status_code == 422, bad


def test_add_flat_to_existing_pin(client, auth, flat_id):
    location_id = client.get(f"/api/v1/flats/{flat_id}").json()["data"]["location"]["id"]
    url = f"/api/v1/locations/{location_id}/flats"
    assert client.post(url, json={"label": "102"}).status_code == 401
    response = client.post(url, headers=auth, json={"label": " 102 "})
    assert response.status_code == 201, response.text
    assert response.json()["data"]["label"] == "102"
    duplicate = client.post(url, headers=auth, json={"label": "101"})
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "FLAT_ALREADY_EXISTS"
    missing = client.post(
        f"/api/v1/locations/{uuid.uuid4()}/flats", headers=auth, json={"label": "1"}
    )
    assert missing.status_code == 404
    labels = [f["label"] for f in client.get(url).json()["data"]]
    assert sorted(labels) == ["101", "102"]


def test_creator_can_edit_place_and_flat_until_others_contribute(client, auth):
    flat = client.post("/api/v1/locations", headers=auth, json=place_payload()).json()["data"]
    location_id, flat_id = flat["location"]["id"], flat["id"]
    perms = client.get(f"/api/v1/locations/{location_id}/permissions", headers=auth).json()
    assert perms["data"] == {"can_edit_location": True, "editable_flat_ids": [flat_id]}

    edited = client.patch(
        f"/api/v1/locations/{location_id}",
        headers=auth,
        json={"building_name": "Renamed House", "address": "14 Fixed Road", "latitude": 12.9001,
              "longitude": 77.5001},
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["data"]["building_name"] == "Renamed House"
    assert edited.json()["data"]["latitude"] == 12.9001
    # Clearing the optional name is allowed; latitude alone or a null address is not.
    assert client.patch(f"/api/v1/locations/{location_id}", headers=auth,
                        json={"building_name": None}).status_code == 200
    for bad in ({"latitude": 12.91}, {"address": None}, {}, {"created_by": "x"}):
        assert client.patch(f"/api/v1/locations/{location_id}", headers=auth,
                            json=bad).status_code == 422, bad
    relabel = client.patch(f"/api/v1/flats/{flat_id}", headers=auth, json={"label": "3C"})
    assert relabel.status_code == 200 and relabel.json()["data"]["label"] == "3C"
    # The creator's own review does not lock anything.
    create_review(client, flat_id, auth)
    assert client.patch(f"/api/v1/flats/{flat_id}", headers=auth,
                        json={"label": "3D"}).status_code == 200

    other, _ = sign_in(client, "neighbour")
    # Someone else can't edit it ...
    response = client.patch(f"/api/v1/locations/{location_id}", headers=other,
                            json={"address": "Hijacked"})
    assert response.status_code == 403
    assert client.patch(f"/api/v1/flats/{flat_id}", headers=other,
                        json={"label": "X"}).status_code == 403
    assert client.get(f"/api/v1/locations/{location_id}/permissions",
                      headers=other).json()["data"] == {
        "can_edit_location": False, "editable_flat_ids": []}
    # ... and once they contribute, the creator can't either.
    client.post(f"/api/v1/flats/{flat_id}/interactions", headers=other,
                json=interaction_payload())
    locked = client.patch(f"/api/v1/locations/{location_id}", headers=auth,
                          json={"address": "Changed later"})
    assert locked.status_code == 409 and locked.json()["error"]["code"] == "EDIT_LOCKED"
    assert client.patch(f"/api/v1/flats/{flat_id}", headers=auth,
                        json={"label": "9Z"}).status_code == 409


def test_place_edit_keeps_duplicate_and_flat_rules(client, auth, flat_id):
    flat = client.post("/api/v1/locations", headers=auth, json=place_payload()).json()["data"]
    location_id = flat["location"]["id"]
    # Moving onto "Test House" (fixture at 12.97, 77.64) under its name is a duplicate.
    clash = client.patch(f"/api/v1/locations/{location_id}", headers=auth,
                         json={"building_name": "Test House", "latitude": 12.97009,
                               "longitude": 77.64})
    assert clash.status_code == 409
    assert clash.json()["error"]["code"] == "LOCATION_ALREADY_EXISTS"
    second = client.post(f"/api/v1/locations/{location_id}/flats", headers=auth,
                         json={"label": "4A"}).json()["data"]
    taken = client.patch(f"/api/v1/flats/{second['id']}", headers=auth, json={"label": "2b"})
    assert taken.status_code == 409 and taken.json()["error"]["code"] == "FLAT_ALREADY_EXISTS"
    # Seeded/older places have no recorded creator and stay read-only.
    with SessionLocal() as db:
        seeded = str(db.get(Flat, uuid.UUID(flat_id)).location_id)
    assert client.patch(f"/api/v1/locations/{seeded}", headers=auth,
                        json={"address": "Mine now"}).status_code == 403


def test_own_reviews_can_be_filtered_to_one_flat(client, auth, flat_id):
    review = create_review(client, flat_id, auth)
    other_flat = client.post("/api/v1/locations", headers=auth, json=place_payload()).json()
    create_review(client, other_flat["data"]["id"], auth)
    mine = client.get(f"/api/v1/me/tenant-reviews?flat_id={flat_id}", headers=auth).json()
    assert [r["id"] for r in mine["data"]] == [review["id"]]
    assert mine["data"][0]["can_edit"] is True
    assert len(client.get("/api/v1/me/tenant-reviews", headers=auth).json()["data"]) == 2
    # Another user's view of the same flat lists nothing as theirs.
    other, _ = sign_in(client, "neighbour")
    assert client.get(f"/api/v1/me/tenant-reviews?flat_id={flat_id}",
                      headers=other).json()["data"] == []


def test_notebook_lists_what_the_user_added_and_where_their_reviews_are(client, auth, flat_id):
    mine = client.post("/api/v1/locations", headers=auth, json=place_payload()).json()["data"]
    with SessionLocal() as db:
        seeded_location = str(db.get(Flat, uuid.UUID(flat_id)).location_id)
    extra = client.post(f"/api/v1/locations/{seeded_location}/flats", headers=auth,
                        json={"label": "9F"}).json()["data"]
    added = client.get("/api/v1/me/flats", headers=auth).json()["data"]
    by_id = {f["id"]: f for f in added}
    assert set(by_id) == {mine["id"], extra["id"]}
    assert by_id[mine["id"]]["added_place"] is True
    assert by_id[mine["id"]]["location"]["building_name"] == "Fresh Pin House"
    assert by_id[extra["id"]]["added_place"] is False and by_id[extra["id"]]["can_edit"] is True
    other, _ = sign_in(client, "neighbour")
    assert client.get("/api/v1/me/flats", headers=other).json()["data"] == []

    review = create_review(client, mine["id"], auth)
    own = client.get("/api/v1/me/tenant-reviews", headers=auth).json()["data"][0]
    assert own["place"]["building_name"] == "Fresh Pin House"
    assert own["place"]["flat_label"] == "2B"
    client.post(f"/api/v1/flats/{mine['id']}/interactions", headers=auth,
                json=interaction_payload())
    own_interaction = client.get("/api/v1/me/interactions", headers=auth).json()["data"][0]
    assert own_interaction["place"]["address"] == "12 New Road, Bengaluru"
    # Public review shapes stay as they were.
    assert "place" not in client.get(f"/api/v1/tenant-reviews/{review['id']}").json()["data"]
