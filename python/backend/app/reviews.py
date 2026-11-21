from datetime import timedelta
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .common import (
    admin_user,
    current_user,
    deletion_data,
    fail,
    fields,
    file_data,
    get_or_404,
    interaction_data,
    own_review_data,
    page,
    place_of,
    review_data,
)
from .database import get_db
from .files import attachment_files
from .models import (
    Attachment,
    DeletionRequest,
    File,
    Flat,
    Interaction,
    Proof,
    TenantReview,
    User,
    now,
)
from .properties import Limit, effective_policy
from .schemas import (
    AttachmentBody,
    DecisionBody,
    DeletionBody,
    EditBody,
    InteractionBody,
    ReviewBody,
)

router = APIRouter()


def visible_review(db, review_id, lock_row=False):
    row = get_or_404(db, TenantReview, review_id, lock_row)
    if row.deleted_at:
        fail(404, "NOT_FOUND", "This review is unavailable.")
    return row


def require_author(row, user, private=False):
    if row.author_id != user.id:
        fail(
            404 if private else 403,
            "NOT_FOUND" if private else "FORBIDDEN",
            "You can only manage your own records.",
        )


@router.get("/flats/{flat_id}/tenant-reviews")
def reviews(
    flat_id: UUID, limit: Limit = 20, cursor: str | None = None, db: Session = Depends(get_db)
):
    get_or_404(db, Flat, flat_id)
    return page(
        db,
        select(TenantReview).where(
            TenantReview.flat_id == flat_id, TenantReview.deleted_at.is_(None)
        ),
        TenantReview,
        lambda r: review_data(db, r),
        f"reviews:{flat_id}",
        limit,
        cursor,
        True,
    )


@router.get("/tenant-reviews/{review_id}")
def review(review_id: UUID, db: Session = Depends(get_db)):
    return {"data": review_data(db, visible_review(db, review_id))}


@router.post("/flats/{flat_id}/tenant-reviews", status_code=201)
def create_review(
    flat_id: UUID,
    body: ReviewBody,
    response: Response,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    # Lock the flat even when it has no reviews. READ COMMITTED then sees the
    # previous lock holder's committed review before checking for overlap.
    get_or_404(db, Flat, flat_id, True)
    conflict = db.scalar(
        select(TenantReview.id)
        .where(
            TenantReview.flat_id == flat_id,
            TenantReview.author_id != user.id,
            TenantReview.deleted_at.is_(None),
            TenantReview.tenancy_start_date < body.tenancy_end_date,
            TenantReview.tenancy_end_date > body.tenancy_start_date,
        )
        .limit(1)
    )
    if conflict:
        fail(
            409,
            "TENANCY_PERIOD_CONFLICT",
            "Another tenant has already reviewed an overlapping tenancy for this flat.",
        )
    policy = effective_policy(db)
    if policy.proof_required and not body.proof_file_ids:
        fail(422, "PROOF_REQUIRED", "Proof of tenancy is currently required.")
    files = attachment_files(db, body.proof_file_ids, user, "tenancy_proof")
    row = TenantReview(
        author_id=user.id,
        flat_id=flat_id,
        proof_policy_id=policy.id,
        **body.model_dump(exclude={"proof_file_ids"}),
    )
    db.add(row)
    db.flush()
    for file in files:
        db.add(Proof(tenant_review_id=row.id, file_id=file.id))
    response.headers["Location"] = f"/api/v1/tenant-reviews/{row.id}"
    return {"data": review_data(db, row)}


@router.patch("/tenant-reviews/{review_id}")
def edit_review(
    review_id: UUID,
    body: EditBody,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    row = visible_review(db, review_id, True)
    require_author(row, user)
    if now() >= row.submitted_at + timedelta(days=30):
        fail(403, "EDIT_WINDOW_CLOSED", "Reviews can only be edited for 30 days after submission.")
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    row.updated_at = now()
    db.flush()
    return {"data": review_data(db, row)}


@router.get("/me/tenant-reviews")
def own_reviews(
    flat_id: UUID | None = None,
    limit: Limit = 20,
    cursor: str | None = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    query = select(TenantReview).where(TenantReview.author_id == user.id)
    if flat_id is not None:
        # Lets a flat's page mark which of its reviews are the viewer's own.
        query = query.where(TenantReview.flat_id == flat_id)
    return page(
        db,
        query,
        TenantReview,
        lambda r: own_review_data(db, r),
        f"own-reviews:{user.id}:{flat_id}",
        limit,
        cursor,
        True,
    )


@router.get("/me/tenant-reviews/{review_id}")
def own_review(review_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = get_or_404(db, TenantReview, review_id)
    require_author(row, user, True)
    return {"data": own_review_data(db, row)}


@router.get("/me/tenant-reviews/{review_id}/proofs")
def own_proofs(
    review_id: UUID,
    limit: Limit = 20,
    cursor: str | None = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    require_author(get_or_404(db, TenantReview, review_id), user, True)
    return page(
        db,
        select(Proof).where(Proof.tenant_review_id == review_id),
        Proof,
        lambda row: dict(
            fields(row, "id tenant_review_id created_at"), file=file_data(db.get(File, row.file_id))
        ),
        f"proofs:{review_id}",
        limit,
        cursor,
    )


@router.get("/flats/{flat_id}/interactions")
def interactions(
    flat_id: UUID, limit: Limit = 20, cursor: str | None = None, db: Session = Depends(get_db)
):
    get_or_404(db, Flat, flat_id)
    return page(
        db,
        select(Interaction).where(Interaction.flat_id == flat_id),
        Interaction,
        lambda r: interaction_data(db, r),
        f"interactions:{flat_id}",
        limit,
        cursor,
        True,
    )


@router.get("/interactions/{interaction_id}")
def interaction(interaction_id: UUID, db: Session = Depends(get_db)):
    return {"data": interaction_data(db, get_or_404(db, Interaction, interaction_id))}


@router.post("/flats/{flat_id}/interactions", status_code=201)
def create_interaction(
    flat_id: UUID,
    body: InteractionBody,
    response: Response,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    get_or_404(db, Flat, flat_id)
    if db.scalar(
        select(Interaction.id).where(
            Interaction.flat_id == flat_id, Interaction.author_id == user.id
        )
    ):
        fail(
            409,
            "INTERACTION_REVIEW_ALREADY_EXISTS",
            "You have already shared an interaction for this flat.",
        )
    files = attachment_files(db, body.supporting_file_ids, user, "interaction_support")
    row = Interaction(
        author_id=user.id, flat_id=flat_id, **body.model_dump(exclude={"supporting_file_ids"})
    )
    db.add(row)
    db.flush()  # A database unique constraint also guards concurrent requests.
    for file in files:
        db.add(Attachment(interaction_review_id=row.id, file_id=file.id))
    response.headers["Location"] = f"/api/v1/interactions/{row.id}"
    return {"data": interaction_data(db, row)}


@router.get("/me/interactions")
def own_interactions(
    limit: Limit = 20,
    cursor: str | None = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    return page(
        db,
        select(Interaction).where(Interaction.author_id == user.id),
        Interaction,
        lambda r: interaction_data(db, r) | {"place": place_of(db, r.flat_id)},
        f"own-interactions:{user.id}",
        limit,
        cursor,
        True,
    )


@router.get("/me/interactions/{interaction_id}")
def own_interaction(
    interaction_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    row = get_or_404(db, Interaction, interaction_id)
    require_author(row, user, True)
    return {"data": interaction_data(db, row) | {"place": place_of(db, row.flat_id)}}


def attachment_data(db, row):
    return dict(
        fields(row, "id interaction_review_id created_at"),
        file=file_data(db.get(File, row.file_id)),
    )


@router.get("/interactions/{interaction_id}/attachments")
def attachments(
    interaction_id: UUID,
    limit: Limit = 20,
    cursor: str | None = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    require_author(get_or_404(db, Interaction, interaction_id), user, True)
    return page(
        db,
        select(Attachment).where(
            Attachment.interaction_review_id == interaction_id, Attachment.removed_at.is_(None)
        ),
        Attachment,
        lambda r: attachment_data(db, r),
        f"attachments:{interaction_id}",
        limit,
        cursor,
    )


@router.post("/interactions/{interaction_id}/attachments", status_code=201)
def add_attachment(
    interaction_id: UUID,
    body: AttachmentBody,
    response: Response,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    require_author(get_or_404(db, Interaction, interaction_id), user)
    file = attachment_files(db, [body.file_id], user, "interaction_support")[0]
    row = Attachment(interaction_review_id=interaction_id, file_id=file.id)
    db.add(row)
    db.flush()
    response.headers["Location"] = f"/api/v1/interactions/{interaction_id}/attachments/{row.id}"
    return {"data": attachment_data(db, row)}


@router.get("/interactions/{interaction_id}/attachments/{attachment_id}")
def attachment(
    interaction_id: UUID,
    attachment_id: UUID,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    require_author(get_or_404(db, Interaction, interaction_id), user, True)
    row = get_or_404(db, Attachment, attachment_id)
    if row.interaction_review_id != interaction_id or row.removed_at:
        fail(404, "NOT_FOUND", "Attachment unavailable.")
    return {"data": attachment_data(db, row)}


@router.delete("/interactions/{interaction_id}/attachments/{attachment_id}", status_code=204)
def remove_attachment(
    interaction_id: UUID,
    attachment_id: UUID,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    require_author(get_or_404(db, Interaction, interaction_id), user, True)
    row = get_or_404(db, Attachment, attachment_id, True)
    if row.interaction_review_id != interaction_id:
        fail(404, "NOT_FOUND", "Attachment unavailable.")
    if not row.removed_at:
        row.removed_at = now()
        file = get_or_404(db, File, row.file_id, True)
        file.status = "deletion_pending"
    return Response(status_code=204)


@router.post("/tenant-reviews/{review_id}/deletion-requests", status_code=201)
def request_deletion(
    review_id: UUID,
    body: DeletionBody,
    response: Response,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    row = visible_review(db, review_id, True)
    require_author(row, user)
    if db.scalar(
        select(DeletionRequest.id).where(
            DeletionRequest.tenant_review_id == row.id, DeletionRequest.status == "pending"
        )
    ):
        fail(409, "REQUEST_ALREADY_PENDING", "A deletion request is already awaiting a decision.")
    request = DeletionRequest(tenant_review_id=row.id, requested_by=user.id, reason=body.reason)
    db.add(request)
    db.flush()
    response.headers["Location"] = f"/api/v1/me/deletion-requests/{request.id}"
    return {"data": deletion_data(db, request)}


@router.get("/me/deletion-requests")
def own_requests(
    status: Literal["pending", "approved", "rejected"] | None = None,
    limit: Limit = 20,
    cursor: str | None = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    query = select(DeletionRequest).where(DeletionRequest.requested_by == user.id)
    if status:
        query = query.where(DeletionRequest.status == status)
    return page(
        db,
        query,
        DeletionRequest,
        lambda r: deletion_data(db, r),
        f"requests:{user.id}:{status}",
        limit,
        cursor,
        True,
    )


@router.get("/me/deletion-requests/{request_id}")
def own_request(
    request_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    row = get_or_404(db, DeletionRequest, request_id)
    if row.requested_by != user.id:
        fail(404, "NOT_FOUND", "Deletion request unavailable.")
    return {"data": deletion_data(db, row)}


@router.get("/admin/deletion-requests")
def admin_requests(
    status: Literal["pending", "approved", "rejected", "all"] = "pending",
    limit: Limit = 20,
    cursor: str | None = None,
    user: User = Depends(admin_user),
    db: Session = Depends(get_db),
):
    query = select(DeletionRequest)
    if status != "all":
        query = query.where(DeletionRequest.status == status)
    return page(
        db,
        query,
        DeletionRequest,
        lambda r: deletion_data(db, r, True),
        f"admin-requests:{status}",
        limit,
        cursor,
        True,
    )


@router.get("/admin/deletion-requests/{request_id}")
def admin_request(
    request_id: UUID, user: User = Depends(admin_user), db: Session = Depends(get_db)
):
    return {"data": deletion_data(db, get_or_404(db, DeletionRequest, request_id), True)}


@router.post("/admin/deletion-requests/{request_id}/decision")
def decide(
    request_id: UUID,
    body: DecisionBody,
    user: User = Depends(admin_user),
    db: Session = Depends(get_db),
):
    candidate = get_or_404(db, DeletionRequest, request_id)
    review = get_or_404(db, TenantReview, candidate.tenant_review_id)
    get_or_404(db, Flat, review.flat_id, True)
    row = get_or_404(db, DeletionRequest, request_id, True)
    db.refresh(row)
    if row.status != "pending":
        fail(409, "REQUEST_ALREADY_DECIDED", "This request already has a final decision.")
    review = get_or_404(db, TenantReview, row.tenant_review_id, True)
    row.status, row.decided_at, row.decided_by = body.decision, now(), user.id
    row.decision_note = body.decision_note
    if body.decision == "approved":
        review.deleted_at = now()
    db.flush()
    return {"data": deletion_data(db, row, True)}
