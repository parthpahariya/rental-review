"""Idempotent fictional demo data; never seeds sessions or a public admin account."""

import uuid
from datetime import date, timedelta

from .database import SessionLocal
from .models import Flat, Interaction, Location, TenantReview, User, now


def seed_id(name):
    return uuid.uuid5(uuid.NAMESPACE_URL, f"rental-review-demo:{name}")


def seed():
    with SessionLocal.begin() as db:
        if db.get(Location, seed_id("location-0")):
            print("Demo data already exists.")
            return
        author = db.get(User, seed_id("author"))
        if not author:
            # Fictional Google identity; nobody can sign in as it.
            author = User(id=seed_id("author"), google_subject="demo-author")
            db.add(author)
            db.flush()
        examples = [
            (
                "Parkside Residences",
                "12, 80 Feet Road, Indiranagar, Bengaluru",
                12.9719,
                77.6412,
                "A-204",
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
                        rating=rating,
                        feedback=feedback,
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
                    description=description,
                    interaction_date=date(2025, 2, 1),
                )
            )
        # Another flat at the same location exercises the selected-flat boundary.
        db.add(Flat(id=seed_id("flat-extra"), location_id=seed_id("location-0"), label="A-305"))
    print("Fictional demo locations and reviews seeded.")


if __name__ == "__main__":
    seed()
