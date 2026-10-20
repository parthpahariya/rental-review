import math
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import exists, func, or_, select
from sqlalchemy.orm import Session

from .common import fail, fields, get_or_404, page
from .database import get_db
from .models import Flat, Interaction, Location, ProofPolicy, TenantReview, now

router = APIRouter()
Limit = Annotated[int, Query(ge=1, le=100)]


def summary(db, flat_ids):
    count, average = db.execute(
        select(func.count(TenantReview.id), func.avg(TenantReview.rating)).where(
            TenantReview.flat_id.in_(flat_ids), TenantReview.deleted_at.is_(None)
        )
    ).one()
    interactions = db.scalar(
        select(func.count(Interaction.id)).where(Interaction.flat_id.in_(flat_ids))
    )
    return {
        "tenant_review_count": count,
        "interaction_review_count": interactions,
        "average_rating": round(float(average), 2) if average is not None else None,
    }


def location_data(db, row, include_summary=True):
    result = fields(row, "id address building_name latitude longitude")
    if include_summary:
        result["summary"] = summary(db, select(Flat.id).where(Flat.location_id == row.id))
    return result


def flat_data(db, row):
    return {
        "id": row.id,
        "label": row.label,
        "location": location_data(db, db.get(Location, row.location_id), False),
        "summary": summary(db, [row.id]),
    }


def effective_policy(db):
    policy = db.scalar(
        select(ProofPolicy)
        .where(ProofPolicy.effective_from <= now())
        .order_by(ProofPolicy.effective_from.desc())
        .limit(1)
    )
    if not policy:
        fail(
            503, "SERVICE_UNAVAILABLE", "Review policy is not initialized. Run database migrations."
        )
    return policy


@router.get("/review-submission-policy")
def submission_policy(db: Session = Depends(get_db)):
    policy = effective_policy(db)
    return {
        "data": {
            "proof_policy_id": policy.id,
            "proof_required": policy.proof_required,
            "effective_from": policy.effective_from,
            "editing_window_days": 30,
        }
    }


@router.get("/locations")
def locations(
    q: Annotated[str | None, Query(min_length=1, max_length=200)] = None,
    bbox: str | None = None,
    reviewed_only: bool = True,
    limit: Limit = 20,
    cursor: str | None = None,
    db: Session = Depends(get_db),
):
    query = select(Location)
    if q is not None:
        if not q.strip():
            fail(422, "VALIDATION_ERROR", "Search cannot be blank.")
        query = query.where(
            or_(
                Location.address.icontains(q.strip(), autoescape=True),
                Location.building_name.icontains(q.strip(), autoescape=True),
            )
        )
    if bbox:
        try:
            west, south, east, north = [float(x) for x in bbox.split(",")]
            if not all(math.isfinite(x) for x in (west, south, east, north)) or not (
                -180 <= west <= 180 and -180 <= east <= 180 and -90 <= south <= north <= 90
            ):
                raise ValueError()
        except ValueError:
            fail(400, "INVALID_BOUNDS", "Use west,south,east,north in valid WGS84 coordinates.")
        longitude = (
            Location.longitude.between(west, east)
            if west <= east
            else or_(Location.longitude >= west, Location.longitude <= east)
        )
        query = query.where(longitude, Location.latitude.between(south, north))
    if reviewed_only:
        reviewed_flat = select(Flat.id).where(Flat.location_id == Location.id).correlate(Location)
        query = query.where(
            or_(
                exists(
                    select(TenantReview.id).where(
                        TenantReview.flat_id.in_(reviewed_flat), TenantReview.deleted_at.is_(None)
                    )
                ),
                exists(select(Interaction.id).where(Interaction.flat_id.in_(reviewed_flat))),
            )
        )
    return page(
        db,
        query,
        Location,
        lambda row: location_data(db, row),
        f"locations:{q}:{bbox}:{reviewed_only}",
        limit,
        cursor,
    )


@router.get("/locations/{location_id}")
def location(location_id: UUID, db: Session = Depends(get_db)):
    return {"data": location_data(db, get_or_404(db, Location, location_id))}


@router.get("/locations/{location_id}/flats")
def flats(
    location_id: UUID, limit: Limit = 20, cursor: str | None = None, db: Session = Depends(get_db)
):
    get_or_404(db, Location, location_id)
    return page(
        db,
        select(Flat).where(Flat.location_id == location_id),
        Flat,
        lambda row: flat_data(db, row),
        f"flats:{location_id}",
        limit,
        cursor,
    )


@router.get("/flats/{flat_id}")
def flat(flat_id: UUID, db: Session = Depends(get_db)):
    return {"data": flat_data(db, get_or_404(db, Flat, flat_id))}
