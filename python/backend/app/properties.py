import math
import time
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import exists, func, or_, select
from sqlalchemy.orm import Session

from .common import current_user, fail, fields, get_or_404, lock, page
from .database import get_db
from .models import Flat, Interaction, Location, ProofPolicy, TenantReview, User, now
from .schemas import FlatBody, LocationBody, LocationEditBody

router = APIRouter()
Limit = Annotated[int, Query(ge=1, le=100)]
# A new unnamed pin this close to an existing place is taken to be that place.
DUPLICATE_RADIUS_METRES = 30
# A new building with the same name this close is the same building pinned slightly off.
SAME_NAME_RADIUS_METRES = 100
EARTH_RADIUS_METRES = 6_371_000


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


# Site-wide totals scan every review, so they are cached briefly. At national
# scale (crores of buildings) the landing page must never trigger a full scan
# per visitor.
STATS_TTL_SECONDS = 60
_stats_cache: dict = {}


@router.get("/stats")
def stats(db: Session = Depends(get_db)):
    cached = _stats_cache.get("data")
    if cached and time.monotonic() - _stats_cache["at"] < STATS_TTL_SECONDS:
        return {"data": cached}
    live = TenantReview.deleted_at.is_(None)
    tenant_count, average = db.execute(
        select(func.count(TenantReview.id), func.avg(TenantReview.rating)).where(live)
    ).one()
    per_location = (
        select(
            Flat.location_id.label("location_id"),
            func.avg(TenantReview.rating).label("rating"),
            func.count(TenantReview.id).label("reviews"),
        )
        .join(TenantReview, TenantReview.flat_id == Flat.id)
        .where(live)
        .group_by(Flat.location_id)
        .subquery()
    )
    star = func.least(5, func.greatest(1, func.round(per_location.c.rating)))
    bands = dict(db.execute(select(star, func.count()).group_by(star)).all())
    top_ids = db.scalars(
        select(per_location.c.location_id)
        .order_by(per_location.c.rating.desc(), per_location.c.reviews.desc())
        .limit(3)
    ).all()
    data = {
        "location_count": db.scalar(select(func.count(Location.id))),
        "rated_location_count": sum(bands.values()),
        "tenant_review_count": tenant_count,
        "interaction_review_count": db.scalar(select(func.count(Interaction.id))),
        "average_rating": round(float(average), 2) if average is not None else None,
        "rating_bands": [{"stars": s, "count": int(bands.get(s, 0))} for s in (5, 4, 3, 2, 1)],
        "top_rated": [location_data(db, db.get(Location, i)) for i in top_ids],
    }
    _stats_cache.update(data=data, at=time.monotonic())
    return {"data": data}


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


def distance_metres(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_METRES * math.asin(math.sqrt(a))


def same_name(a, b):
    return " ".join((a or "").split()).casefold() == " ".join((b or "").split()).casefold()


def duplicate_location(db, latitude, longitude, building_name, exclude=None):
    """The existing place a new pin would duplicate, if any.

    Neighbouring buildings can be a few metres apart, so a named building is only a
    duplicate of a nearby place with the same name. Without a name there is nothing
    to tell two places apart, so any place within 30 m counts.
    """
    if building_name:
        return nearest_location(
            db,
            latitude,
            longitude,
            SAME_NAME_RADIUS_METRES,
            lambda row: row.id != exclude and same_name(row.building_name, building_name),
        )
    return nearest_location(db, latitude, longitude, match=lambda row: row.id != exclude)


def nearest_location(db, latitude, longitude, radius=DUPLICATE_RADIUS_METRES, match=None):
    # Prefilter with a bounding box, then measure exact distance.
    dlat = math.degrees(radius / EARTH_RADIUS_METRES)
    dlon = dlat / max(math.cos(math.radians(latitude)), 0.01)
    candidates = db.scalars(
        select(Location).where(
            Location.latitude.between(latitude - dlat, latitude + dlat),
            Location.longitude.between(longitude - dlon, longitude + dlon),
        )
    ).all()
    scored = [
        (distance_metres(latitude, longitude, row.latitude, row.longitude), row)
        for row in candidates
        if match is None or match(row)
    ]
    scored = [item for item in scored if item[0] <= radius]
    return min(scored, key=lambda item: item[0])[1] if scored else None


def check_flat_label(db, location_id, label, exclude=None):
    query = select(Flat.id).where(
        Flat.location_id == location_id, func.lower(Flat.label) == label.lower()
    )
    if exclude is not None:
        query = query.where(Flat.id != exclude)
    if db.scalar(query):
        fail(409, "FLAT_ALREADY_EXISTS", f"Flat {label} is already listed at this place.")


def add_flat(db, location_id, label, user):
    check_flat_label(db, location_id, label)
    row = Flat(location_id=location_id, label=label, created_by=user.id)
    db.add(row)
    db.flush()
    return row


@router.post("/locations", status_code=201)
def create_location(
    body: LocationBody,
    response: Response,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    # Serialize creation so two people pinning the same spot cannot both succeed.
    lock(db, "locations:create")
    existing = duplicate_location(db, body.latitude, body.longitude, body.building_name)
    if existing:
        fail(
            409,
            "LOCATION_ALREADY_EXISTS",
            f"{existing.building_name or existing.address} is already on the map here. "
            "Review it instead, or add your flat to it."
            + ("" if body.building_name else " If yours is a different building, add its name."),
        )
    location = Location(
        address=body.address,
        building_name=body.building_name,
        latitude=body.latitude,
        longitude=body.longitude,
        created_by=user.id,
    )
    db.add(location)
    db.flush()
    flat = add_flat(db, location.id, body.flat_label, user)
    response.headers["Location"] = f"/api/v1/flats/{flat.id}"
    return {"data": flat_data(db, flat)}


@router.post("/locations/{location_id}/flats", status_code=201)
def create_flat(
    location_id: UUID,
    body: FlatBody,
    response: Response,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    get_or_404(db, Location, location_id, True)
    flat = add_flat(db, location_id, body.label, user)
    response.headers["Location"] = f"/api/v1/flats/{flat.id}"
    return {"data": flat_data(db, flat)}


# Editing what you added: the creator can fix a place or flat until somebody else
# has contributed to it. After that, others' reviews depend on it staying put.


def others_contributed(db, user, flat_ids):
    """Whether anyone but `user` has a review or interaction on these flats."""
    tenant = select(TenantReview.id).where(
        TenantReview.flat_id.in_(flat_ids),
        TenantReview.author_id != user.id,
        TenantReview.deleted_at.is_(None),
    )
    interaction = select(Interaction.id).where(
        Interaction.flat_id.in_(flat_ids), Interaction.author_id != user.id
    )
    return bool(db.scalar(select(exists(tenant))) or db.scalar(select(exists(interaction))))


NOT_YOURS = 403, "FORBIDDEN"
LOCKED = 409, "EDIT_LOCKED"


def location_lock_reason(db, location, user):
    """None if `user` may edit the place, else (status, code, message)."""
    if location.created_by != user.id:
        return *NOT_YOURS, "You can only edit places you added."
    flat_ids = select(Flat.id).where(Flat.location_id == location.id)
    other_flats = select(Flat.id).where(
        Flat.location_id == location.id,
        or_(Flat.created_by.is_(None), Flat.created_by != user.id),
    )
    if db.scalar(select(exists(other_flats))) or others_contributed(db, user, flat_ids):
        return *LOCKED, "Other people have added to this place, so it can no longer be edited."
    return None


def flat_lock_reason(db, flat, user):
    if flat.created_by != user.id:
        return *NOT_YOURS, "You can only edit flats you added."
    if others_contributed(db, user, [flat.id]):
        return *LOCKED, "Other people have reviewed this flat, so it can no longer be edited."
    return None


@router.get("/me/flats")
def own_flats(
    limit: Limit = 20,
    cursor: str | None = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Flats the user added; `added_place` is true when they pinned the building too."""

    def data(row):
        location = db.get(Location, row.location_id)
        return flat_data(db, row) | {
            "added_place": location.created_by == user.id,
            "can_edit": flat_lock_reason(db, row, user) is None,
        }

    return page(
        db,
        select(Flat).where(Flat.created_by == user.id),
        Flat,
        data,
        f"own-flats:{user.id}",
        limit,
        cursor,
    )


@router.get("/locations/{location_id}/permissions")
def location_permissions(
    location_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    location = get_or_404(db, Location, location_id)
    flats = db.scalars(select(Flat).where(Flat.location_id == location_id)).all()
    return {
        "data": {
            "can_edit_location": location_lock_reason(db, location, user) is None,
            "editable_flat_ids": [f.id for f in flats if flat_lock_reason(db, f, user) is None],
        }
    }


@router.patch("/locations/{location_id}")
def edit_location(
    location_id: UUID,
    body: LocationEditBody,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    # Same lock as creation, so an edit can't race a new pin into a duplicate.
    lock(db, "locations:create")
    location = get_or_404(db, Location, location_id, True)
    if reason := location_lock_reason(db, location, user):
        fail(*reason)
    changes = body.model_dump(exclude_unset=True)
    name = changes.get("building_name", location.building_name)
    latitude = changes.get("latitude", location.latitude)
    longitude = changes.get("longitude", location.longitude)
    moved_or_renamed = (
        latitude != location.latitude
        or longitude != location.longitude
        or not same_name(name, location.building_name)
    )
    existing = moved_or_renamed and duplicate_location(
        db, latitude, longitude, name, exclude=location.id
    )
    if existing:
        fail(
            409,
            "LOCATION_ALREADY_EXISTS",
            f"{existing.building_name or existing.address} is already on the map here.",
        )
    for key, value in changes.items():
        setattr(location, key, value)
    location.updated_at = now()
    db.flush()
    return {"data": location_data(db, location)}


@router.patch("/flats/{flat_id}")
def edit_flat(
    flat_id: UUID,
    body: FlatBody,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    flat = get_or_404(db, Flat, flat_id, True)
    if reason := flat_lock_reason(db, flat, user):
        fail(*reason)
    check_flat_label(db, flat.location_id, body.label, exclude=flat.id)
    flat.label = body.label
    flat.updated_at = now()
    db.flush()
    return {"data": flat_data(db, flat)}
