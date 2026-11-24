import uuid
from datetime import timedelta

from app.database import SessionLocal
from app.models import Comment, User, now
from tests.conftest import sign_in
from tests.test_app import create_review, interaction_payload


def make_admin(account):
    with SessionLocal.begin() as db:
        db.get(User, uuid.UUID(account["id"])).role = "admin"


def comment(client, path, headers, body="Did they return the deposit in full?"):
    response = client.post(f"{path}/comments", headers=headers, json={"body": body})
    assert response.status_code == 201, response.text
    return response.json()["data"]


def test_discussion_on_review_is_public_ordered_and_anonymous(client, auth, flat_id):
    review = create_review(client, flat_id, auth)
    path = f"/api/v1/tenant-reviews/{review['id']}"
    neighbour, _ = sign_in(client, "neighbour")

    assert client.post(f"{path}/comments", json={"body": "Hi"}).status_code == 401
    first = comment(client, path, neighbour)
    second = comment(client, path, auth, "Yes, within two weeks.")

    public = client.get(f"{path}/comments").json()["data"]
    assert [c["id"] for c in public] == [first["id"], second["id"]]  # oldest first
    assert [c["by_subject_author"] for c in public] == [False, True]
    # No author identity, and no viewer flags for anonymous readers.
    assert not {"author_id", "mine", "can_edit"} & set(public[0])
    assert client.get(path).json()["data"]["comment_count"] == 2

    mine = client.get(f"{path}/comments", headers=neighbour).json()["data"]
    assert [(c["mine"], c["can_edit"]) for c in mine] == [(True, True), (False, False)]

    for body in ["", "   ", "x" * 2001]:
        response = client.post(f"{path}/comments", headers=auth, json={"body": body})
        assert response.status_code == 422


def test_discussion_on_interaction(client, auth, flat_id):
    created = client.post(
        f"/api/v1/flats/{flat_id}/interactions", headers=auth, json=interaction_payload()
    ).json()["data"]
    path = f"/api/v1/interactions/{created['id']}"
    neighbour, _ = sign_in(client, "neighbour")
    posted = comment(client, path, neighbour, "Same experience at my viewing.")
    assert posted["subject_type"] == "interaction"
    listed = client.get(f"/api/v1/flats/{flat_id}/interactions").json()["data"]
    assert listed[0]["comment_count"] == 1
    assert client.get("/api/v1/interactions/" + str(uuid.uuid4()) + "/comments").status_code == 404


def test_authors_edit_within_window_and_delete(client, auth, flat_id):
    review = create_review(client, flat_id, auth)
    path = f"/api/v1/tenant-reviews/{review['id']}"
    neighbour, _ = sign_in(client, "neighbour")
    posted = comment(client, path, neighbour)
    url = f"/api/v1/comments/{posted['id']}"

    assert client.patch(url, headers=auth, json={"body": "Hijack"}).status_code == 403
    edited = client.patch(url, headers=neighbour, json={"body": "Updated question."})
    assert edited.status_code == 200 and edited.json()["data"]["body"] == "Updated question."

    with SessionLocal.begin() as db:
        db.get(Comment, uuid.UUID(posted["id"])).submitted_at = now() - timedelta(days=31)
    closed = client.patch(url, headers=neighbour, json={"body": "Too late"})
    assert closed.status_code == 403
    assert closed.json()["error"]["code"] == "EDIT_WINDOW_CLOSED"

    assert client.delete(url, headers=auth).status_code == 403
    assert client.delete(url, headers=neighbour).status_code == 204
    assert client.get(url).status_code == 404
    assert client.get(f"{path}/comments").json()["data"] == []
    assert client.get(path).json()["data"]["comment_count"] == 0

    own = client.get("/api/v1/me/comments", headers=neighbour).json()["data"]
    assert own[0]["deleted_at"] is not None and own[0]["place"]["flat_label"] == "101"


def test_reports_go_to_admin_who_removes_or_dismisses(client, auth, flat_id):
    review = create_review(client, flat_id, auth)
    path = f"/api/v1/tenant-reviews/{review['id']}"
    troll, _ = sign_in(client, "troll")
    first = comment(client, path, troll, "Rude remark")
    second = comment(client, path, troll, "Fair question")

    own_report = client.post(
        f"/api/v1/comments/{first['id']}/reports", headers=troll, json={"reason": "x"}
    )
    assert own_report.status_code == 403
    reporter, _ = sign_in(client, "reporter")
    for headers in (auth, reporter):
        response = client.post(
            f"/api/v1/comments/{first['id']}/reports", headers=headers, json={"reason": "Abusive"}
        )
        assert response.status_code == 201
    again = client.post(
        f"/api/v1/comments/{first['id']}/reports", headers=auth, json={"reason": "Again"}
    )
    assert again.status_code == 409
    second_report = client.post(
        f"/api/v1/comments/{second['id']}/reports", headers=auth, json={"reason": "Not sure"}
    ).json()["data"]

    admin, account = sign_in(client, "admin")
    assert client.get("/api/v1/admin/comment-reports", headers=admin).status_code == 403
    make_admin(account)
    queue = client.get("/api/v1/admin/comment-reports", headers=admin).json()["data"]
    assert len(queue) == 3
    assert {r["subject"]["id"] for r in queue} == {review["id"]}
    assert queue[0]["place"]["flat_label"] == "101"

    # Removing settles both reports of the first comment and hides it.
    report_id = next(r["id"] for r in queue if r["comment"]["id"] == first["id"])
    decision = f"/api/v1/admin/comment-reports/{report_id}/decision"
    assert client.post(decision, headers=admin, json={"decision": "removed"}).status_code == 200
    assert client.post(decision, headers=admin, json={"decision": "dismissed"}).status_code == 409
    assert [c["id"] for c in client.get(f"{path}/comments").json()["data"]] == [second["id"]]

    dismiss = f"/api/v1/admin/comment-reports/{second_report['id']}/decision"
    assert client.post(dismiss, headers=admin, json={"decision": "dismissed"}).status_code == 200
    assert client.get("/api/v1/admin/comment-reports", headers=admin).json()["data"] == []
    statuses = [
        r["status"]
        for r in client.get(
            "/api/v1/admin/comment-reports?status=all", headers=admin
        ).json()["data"]
    ]
    assert sorted(statuses) == ["dismissed", "removed", "removed"]


def test_deleted_review_takes_its_discussion_with_it(client, auth, flat_id):
    review = create_review(client, flat_id, auth)
    path = f"/api/v1/tenant-reviews/{review['id']}"
    posted = comment(client, path, auth)
    from app.models import TenantReview

    with SessionLocal.begin() as db:
        db.get(TenantReview, uuid.UUID(review["id"])).deleted_at = now()
    assert client.get(f"{path}/comments").status_code == 404
    assert client.get(f"/api/v1/comments/{posted['id']}").status_code == 404
    assert client.post(f"{path}/comments", headers=auth, json={"body": "Hi"}).status_code == 404


def test_comment_pages_continue_oldest_first(client, auth, flat_id):
    review = create_review(client, flat_id, auth)
    path = f"/api/v1/tenant-reviews/{review['id']}"
    ids = [comment(client, path, auth, f"Comment {n}")["id"] for n in range(5)]
    first = client.get(f"{path}/comments?limit=3").json()
    cursor = first["page"]["next_cursor"]
    rest = client.get(f"{path}/comments?limit=3&cursor={cursor}").json()
    assert [c["id"] for c in first["data"] + rest["data"]] == ids
    assert rest["page"]["next_cursor"] is None
