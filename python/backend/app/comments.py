"""Discussions: public comments under a tenant review or an interaction.

Anyone can read a discussion; signed-in visitors comment, edit their own for
30 days, delete their own, and report others' comments. Admins settle reports
from a queue, removing the comment or dismissing the report.
"""

from datetime import timedelta
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .common import (
    COMMENT_EDIT_DAYS,
    admin_user,
    comment_data,
    current_user,
    fail,
    get_or_404,
    interaction_data,
    optional_user,
    page,
    place_of,
    review_data,
    visible_comments,
)
from .database import get_db
from .models import Comment, CommentReport, Interaction, TenantReview, User, now
from .properties import Limit
from .schemas import CommentBody, ReportBody, ReportDecisionBody

router = APIRouter()


def review_subject(db, review_id, lock_row=False):
    row = get_or_404(db, TenantReview, review_id, lock_row)
    if row.deleted_at:
        fail(404, "NOT_FOUND", "This review is unavailable.")
    return row


def visible_comment(db, comment_id, lock_row=False):
    row = get_or_404(db, Comment, comment_id, lock_row)
    if row.deleted_at or row.removed_at:
        fail(404, "NOT_FOUND", "This comment is unavailable.")
    if row.tenant_review_id:
        # A comment under a deleted review goes with it.
        review_subject(db, row.tenant_review_id)
    return row


def own_comment(db, comment_id, user):
    row = visible_comment(db, comment_id, True)
    if row.author_id != user.id:
        fail(403, "FORBIDDEN", "You can only manage your own comments.")
    return row


def discussion(db, subject, viewer, limit, cursor):
    key, value = subject
    return page(
        db,
        visible_comments(**{key: value}),
        Comment,
        lambda r: comment_data(db, r, viewer),
        f"comments:{key}:{value}",
        limit,
        cursor,
        chronological=True,
        oldest_first=True,
    )


def add_comment(db, user, body, response, **subject):
    row = Comment(author_id=user.id, body=body.body, **subject)
    db.add(row)
    db.flush()
    response.headers["Location"] = f"/api/v1/comments/{row.id}"
    return {"data": comment_data(db, row, user)}


@router.get("/tenant-reviews/{review_id}/comments")
def review_comments(
    review_id: UUID,
    limit: Limit = 50,
    cursor: str | None = None,
    viewer: User | None = Depends(optional_user),
    db: Session = Depends(get_db),
):
    review_subject(db, review_id)
    return discussion(db, ("tenant_review_id", review_id), viewer, limit, cursor)


@router.post("/tenant-reviews/{review_id}/comments", status_code=201)
def comment_on_review(
    review_id: UUID,
    body: CommentBody,
    response: Response,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    review_subject(db, review_id, True)
    return add_comment(db, user, body, response, tenant_review_id=review_id)


@router.get("/interactions/{interaction_id}/comments")
def interaction_comments(
    interaction_id: UUID,
    limit: Limit = 50,
    cursor: str | None = None,
    viewer: User | None = Depends(optional_user),
    db: Session = Depends(get_db),
):
    get_or_404(db, Interaction, interaction_id)
    return discussion(db, ("interaction_id", interaction_id), viewer, limit, cursor)


@router.post("/interactions/{interaction_id}/comments", status_code=201)
def comment_on_interaction(
    interaction_id: UUID,
    body: CommentBody,
    response: Response,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    get_or_404(db, Interaction, interaction_id)
    return add_comment(db, user, body, response, interaction_id=interaction_id)


@router.get("/comments/{comment_id}")
def comment(
    comment_id: UUID,
    viewer: User | None = Depends(optional_user),
    db: Session = Depends(get_db),
):
    return {"data": comment_data(db, visible_comment(db, comment_id), viewer)}


@router.patch("/comments/{comment_id}")
def edit_comment(
    comment_id: UUID,
    body: CommentBody,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    row = own_comment(db, comment_id, user)
    if now() >= row.submitted_at + timedelta(days=COMMENT_EDIT_DAYS):
        fail(
            403,
            "EDIT_WINDOW_CLOSED",
            f"Comments can only be edited for {COMMENT_EDIT_DAYS} days after posting.",
        )
    row.body, row.updated_at = body.body, now()
    db.flush()
    return {"data": comment_data(db, row, user)}


@router.delete("/comments/{comment_id}", status_code=204)
def delete_comment(
    comment_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    row = own_comment(db, comment_id, user)
    row.deleted_at = now()
    # Nothing is left for the admin to decide once the author deletes it.
    for report in db.scalars(
        select(CommentReport).where(
            CommentReport.comment_id == row.id, CommentReport.status == "pending"
        )
    ):
        report.status, report.decided_at = "dismissed", now()
        report.decision_note = "Deleted by its author."
    db.flush()
    return Response(status_code=204)


@router.post("/comments/{comment_id}/reports", status_code=201)
def report_comment(
    comment_id: UUID,
    body: ReportBody,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    row = visible_comment(db, comment_id, True)
    if row.author_id == user.id:
        fail(403, "CANNOT_REPORT_OWN", "You can edit or delete your own comment instead.")
    if db.scalar(
        select(CommentReport.id).where(
            CommentReport.comment_id == row.id, CommentReport.reported_by == user.id
        )
    ):
        fail(409, "ALREADY_REPORTED", "You have already reported this comment.")
    report = CommentReport(comment_id=row.id, reported_by=user.id, reason=body.reason)
    db.add(report)
    db.flush()  # A unique constraint also guards concurrent reports.
    return {"data": {"id": report.id, "status": report.status}}


@router.get("/me/comments")
def own_comments(
    limit: Limit = 20,
    cursor: str | None = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    def data(row):
        flat_id = subject_of(db, row).flat_id
        return comment_data(db, row, user) | {
            "place": place_of(db, flat_id),
            "flat_id": flat_id,
            "deleted_at": row.deleted_at,
            "removed_at": row.removed_at,
        }

    return page(
        db,
        select(Comment).where(Comment.author_id == user.id),
        Comment,
        data,
        f"own-comments:{user.id}",
        limit,
        cursor,
        True,
    )


def subject_of(db, row):
    if row.tenant_review_id:
        return db.get(TenantReview, row.tenant_review_id)
    return db.get(Interaction, row.interaction_id)


def report_data(db, report):
    row = db.get(Comment, report.comment_id)
    subject = subject_of(db, row)
    result = {
        "id": report.id,
        "reason": report.reason,
        "status": report.status,
        "submitted_at": report.submitted_at,
        "decided_at": report.decided_at,
        "decided_by": report.decided_by,
        "decision_note": report.decision_note,
        "comment": comment_data(db, row)
        | {"deleted_at": row.deleted_at, "removed_at": row.removed_at},
    }
    # What the comment replies to, so the admin can judge it in context.
    result["subject"] = (
        review_data(db, subject) if row.tenant_review_id else interaction_data(db, subject)
    )
    result["place"] = place_of(db, subject.flat_id)
    return result


@router.get("/admin/comment-reports")
def admin_reports(
    status: Literal["pending", "removed", "dismissed", "all"] = "pending",
    limit: Limit = 20,
    cursor: str | None = None,
    user: User = Depends(admin_user),
    db: Session = Depends(get_db),
):
    query = select(CommentReport)
    if status != "all":
        query = query.where(CommentReport.status == status)
    return page(
        db,
        query,
        CommentReport,
        lambda r: report_data(db, r),
        f"admin-comment-reports:{status}",
        limit,
        cursor,
        True,
    )


@router.post("/admin/comment-reports/{report_id}/decision")
def decide_report(
    report_id: UUID,
    body: ReportDecisionBody,
    user: User = Depends(admin_user),
    db: Session = Depends(get_db),
):
    report = get_or_404(db, CommentReport, report_id)
    # Lock the comment first, then its reports, in the same order as reporting.
    row = get_or_404(db, Comment, report.comment_id, True)
    report = get_or_404(db, CommentReport, report_id, True)
    if report.status != "pending":
        fail(409, "REPORT_ALREADY_DECIDED", "This report already has a final decision.")
    if body.decision == "removed":
        row.removed_at = now()
    # One decision settles every pending report of the comment.
    for pending in db.scalars(
        select(CommentReport).where(
            CommentReport.comment_id == row.id, CommentReport.status == "pending"
        )
    ):
        pending.status, pending.decided_at, pending.decided_by = body.decision, now(), user.id
        pending.decision_note = body.decision_note
    db.flush()
    return {"data": report_data(db, report)}
