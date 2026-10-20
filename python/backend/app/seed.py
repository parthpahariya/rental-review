"""Idempotent fictional demo data; never seeds sessions or a public admin account."""

import uuid
from datetime import date, timedelta

from sqlalchemy import select

from .database import SessionLocal
from .models import Flat, Interaction, Location, ProofPolicy, TenantReview, User, now


def seed_id(name):
    return uuid.uuid5(uuid.NAMESPACE_URL, f"rental-review-demo:{name}")


def seed():
    with SessionLocal.begin() as db:
        if db.get(Location, seed_id("location-0")):
            print("Demo data already exists.")
            return
        policy = db.scalar(select(ProofPolicy).order_by(ProofPolicy.effective_from.desc()).limit(1))
        if policy is None:
            raise RuntimeError("Run alembic upgrade head first")
        author = db.scalar(select(User).where(User.mobile_number == "+447700900001"))
        if not author:
            author = User(id=seed_id("author"), mobile_number="+447700900001")
            db.add(author)
            db.flush()
        examples = [
            (
                "Parkside Residences",
                "12, 80 Feet Road, Indiranagar, Bengaluru",
                12.9719,
                77.6412,
                "A-204",
                "Anita Rao",
                5,
                "A thoughtful owner and a lovely place to call home. Repairs were handled quickly and my deposit was returned in full.",
                "The viewing was well organised. The owner was transparent about the rent, maintenance charges, and agreement.",
            ),
            (
                "The Courtyard",
                "24, 5th Main, Koramangala, Bengaluru",
                12.9348,
                77.6241,
                "302",
                "Vikram Mehta",
                4,
                "Quiet building and a fair agreement. Communication was easy, although a plumbing repair took a little longer than expected.",
                "Discussed the deposit and pet policy during a viewing. All the costs were explained before making a decision.",
            ),
            (
                "Cedar House",
                "8, Church Street, MG Road, Bengaluru",
                12.9752,
                77.6077,
                "101",
                "Leela Menon",
                3,
                "Great location and a comfortable flat. The deposit settlement needed several follow-ups, but was eventually resolved.",
                "Visited the flat on a weekend. The owner answered my questions about parking and the water supply.",
            ),
            (
                "Lakeview Apartments",
                "16, 1st Cross, HSR Layout, Bengaluru",
                12.9132,
                77.6451,
                "B-501",
                "Rahul Nair",
                None,
                "",
                "Spoke with the owner about an upcoming vacancy. Helpful conversation with clear information about the lease.",
            ),
        ]
        for index, (
            name,
            address,
            lat,
            lng,
            label,
            owner,
            rating,
            feedback,
            description,
        ) in enumerate(examples):
            location = Location(
                id=seed_id(f"location-{index}"),
                building_name=name,
                address=address,
                latitude=lat,
                longitude=lng,
            )
            flat = Flat(id=seed_id(f"flat-{index}"), location_id=location.id, label=label)
            db.add(location)
            db.flush()
            db.add(flat)
            db.flush()
            if rating:
                db.add(
                    TenantReview(
                        id=seed_id(f"review-{index}"),
                        author_id=author.id,
                        flat_id=flat.id,
                        owner_name=owner,
                        rating=rating,
                        feedback=feedback,
                        proof_policy_id=policy.id,
                        tenancy_start_date=date(2024, 1, 1),
                        tenancy_end_date=date(2025, 1, 1),
                        submitted_at=now() - timedelta(days=15 + index),
                    )
                )
            db.add(
                Interaction(
                    id=seed_id(f"interaction-{index}"),
                    author_id=author.id,
                    flat_id=flat.id,
                    owner_name=owner,
                    description=description,
                    interaction_date=date(2025, 2, 1),
                )
            )
        # Another flat at the same location exercises the selected-flat boundary.
        db.add(Flat(id=seed_id("flat-extra"), location_id=seed_id("location-0"), label="A-305"))
    print("Fictional demo locations and reviews seeded.")


if __name__ == "__main__":
    seed()
