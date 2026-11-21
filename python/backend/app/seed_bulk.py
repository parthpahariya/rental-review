"""Fictional load-test data: ~1M tenant reviews spread across Bengaluru.

    python -m app.seed_bulk               # insert (refuses if already present)
    python -m app.seed_bulk --reviews 200000 --seed 7
    python -m app.seed_bulk --delete      # remove everything this script added

Every row it creates has an id starting with ``b10c5eed-`` so it can be found and
removed without touching real or demo data. Rows are streamed with COPY, which
loads a million reviews in a minute or two instead of hours via the ORM.
"""

import argparse
import math
import random
import time
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select, text

from .database import SessionLocal, engine
from .models import ProofPolicy

PREFIX = "b10c5eed"
KIND = {"user": 1, "location": 2, "flat": 3, "review": 4, "interaction": 5}

# (name, latitude, longitude, spread in degrees, relative density)
LOCALITIES = [
    ("Koramangala", 12.9352, 77.6245, 0.010, 10),
    ("Indiranagar", 12.9719, 77.6412, 0.010, 9),
    ("HSR Layout", 12.9116, 77.6474, 0.011, 9),
    ("Whitefield", 12.9698, 77.7500, 0.020, 12),
    ("Marathahalli", 12.9591, 77.6974, 0.012, 9),
    ("Bellandur", 12.9258, 77.6762, 0.012, 9),
    ("Electronic City", 12.8452, 77.6602, 0.018, 10),
    ("BTM Layout", 12.9166, 77.6101, 0.010, 8),
    ("Jayanagar", 12.9250, 77.5938, 0.011, 7),
    ("JP Nagar", 12.9063, 77.5857, 0.013, 8),
    ("Banashankari", 12.9255, 77.5468, 0.013, 6),
    ("Basavanagudi", 12.9406, 77.5738, 0.008, 4),
    ("Malleshwaram", 13.0035, 77.5709, 0.009, 5),
    ("Rajajinagar", 12.9915, 77.5520, 0.010, 5),
    ("Yeshwanthpur", 13.0280, 77.5400, 0.011, 5),
    ("Hebbal", 13.0358, 77.5970, 0.012, 6),
    ("Yelahanka", 13.1007, 77.5963, 0.018, 6),
    ("RT Nagar", 13.0213, 77.5946, 0.009, 4),
    ("Banaswadi", 13.0141, 77.6518, 0.010, 5),
    ("KR Puram", 13.0076, 77.6955, 0.013, 6),
    ("Hennur", 13.0359, 77.6431, 0.012, 5),
    ("Sarjapur Road", 12.9010, 77.6870, 0.016, 9),
    ("MG Road", 12.9752, 77.6077, 0.007, 3),
    ("Frazer Town", 12.9980, 77.6140, 0.007, 3),
    ("Vijayanagar", 12.9719, 77.5352, 0.011, 5),
    ("Kengeri", 12.9081, 77.4851, 0.016, 4),
    ("Bannerghatta Road", 12.8880, 77.5970, 0.015, 7),
    ("Hoodi", 12.9925, 77.7155, 0.010, 5),
    ("Mahadevapura", 12.9886, 77.6895, 0.010, 5),
    ("Ulsoor", 12.9817, 77.6286, 0.007, 3),
]
# Rough Bengaluru urban extent; points outside are redrawn.
BOUNDS = (12.82, 77.45, 13.14, 77.79)  # south, west, north, east
CELL = 0.0003  # ~33 m: at most one building per cell (API rejects pins < 30 m apart)

STREETS = ["Main Road", "Cross Road", "Main", "Cross", "Layout Road", "Avenue", "Street"]
BUILDING_WORDS = (
    "Prestige Sobha Brigade Purva Lakeview Parkside Green Cedar Maple Silver Royal Sunrise "
    "Orchid Lotus Palm Emerald Golden Skyline Heritage Meadow Garden Shanti Sri Nandi"
).split()
BUILDING_KINDS = ["Residency", "Apartments", "Enclave", "Heights", "Towers", "Homes", "Nest", "Court"]
FIRST = (
    "Aarav Aditi Akash Ananya Anil Anita Arjun Deepa Divya Gaurav Harish Kavya Kiran Lakshmi "
    "Manoj Meera Naveen Neha Pooja Prakash Priya Rahul Ramesh Rohan Sanjay Shreya Sunita Suresh "
    "Usha Vikram Vinod Yamini Ravi Geeta Mohan Lata Ajay Rekha Sunil Kamala"
).split()
LAST = (
    "Rao Reddy Sharma Iyer Nair Menon Gowda Shetty Kumar Patel Gupta Hegde Pai Kulkarni "
    "Joshi Bhat Naidu Krishnan Murthy Prasad Das Singh"
).split()
GOOD = [
    "Owner was responsive and fixed issues within a day or two.",
    "Deposit was returned in full and on time.",
    "Agreement terms were clear and fair from the start.",
    "Very respectful of privacy, always called before visiting.",
    "Maintenance charges were reasonable and transparent.",
]
MIXED = [
    "Repairs happened eventually but needed a few reminders.",
    "Rent was raised a bit more than expected at renewal.",
    "Water supply was irregular in summer, owner tried to help.",
    "Deposit settlement took a few weeks of follow-up.",
    "Communication was fine though slow on weekends.",
]
BAD = [
    "Deducted a large part of the deposit without explanation.",
    "Repairs were ignored for months.",
    "Visited the flat without notice several times.",
    "Increased rent mid-agreement and threatened eviction.",
    "Refused to share a copy of the rental agreement.",
]
INTERACTIONS = [
    "Visited the flat for a viewing; owner explained rent, deposit and maintenance clearly.",
    "Spoke to the owner on the phone about an upcoming vacancy.",
    "Owner was strict about no pets and bachelors but polite about it.",
    "Asked for a ten-month deposit, which felt high for the area.",
    "Showed the flat on a weekend and answered questions about parking and power backup.",
]


def bulk_id(kind, n):
    return uuid.UUID(f"{PREFIX}-{KIND[kind]:04x}-4000-8000-{n:012x}")


def person(rng):
    return f"{rng.choice(FIRST)} {rng.choice(LAST)}"


def places(rng, count):
    weights = [loc[4] for loc in LOCALITIES]
    taken = set()
    south, west, north, east = BOUNDS
    while len(taken) < count:
        name, lat0, lng0, spread, _ = rng.choices(LOCALITIES, weights)[0]
        lat, lng = rng.gauss(lat0, spread), rng.gauss(lng0, spread)
        if not (south <= lat <= north and west <= lng <= east):
            continue
        cell = (math.floor(lat / CELL), math.floor(lng / CELL))
        if cell in taken:
            continue
        taken.add(cell)
        yield name, round(lat, 6), round(lng, 6)


def feedback(rng, rating):
    pool = GOOD if rating >= 4 else MIXED if rating == 3 else BAD
    return " ".join(rng.sample(pool, rng.randint(1, 3)))


def months(d, n):
    y, m = divmod(d.month - 1 + n, 12)
    return date(d.year + y, m + 1, min(d.day, 28))


def seed(reviews, seed_value):
    rng = random.Random(seed_value)
    with SessionLocal() as db:
        if db.scalar(text("SELECT 1 FROM locations WHERE id = :id"), {"id": bulk_id("location", 0)}):
            print("Bulk data already exists; run with --delete first.")
            return
        policy = db.scalar(select(ProofPolicy).order_by(ProofPolicy.effective_from.desc()).limit(1))
        if policy is None:
            raise RuntimeError("Run alembic upgrade head first")
        policy_id = policy.id

    # Shape: ~3.3 reviews per flat, ~2.5 flats per building, ~16 reviews per author.
    flats_needed = math.ceil(reviews / 3.3)
    location_count = math.ceil(flats_needed / 2.5)
    user_count = max(1000, reviews // 16)
    today = date(2026, 11, 1)
    started = time.monotonic()

    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        cur.execute("SET synchronous_commit = off")

        with cur.copy("COPY users (id, google_subject, role, status, "
                      "created_at, updated_at) FROM STDIN") as copy:
            joined = datetime(2024, 1, 1, tzinfo=timezone.utc)
            for n in range(user_count):
                # Fictional Google ids; nobody can sign in as these accounts.
                copy.write_row((bulk_id("user", n), f"bulk-{n}", "user", "active",
                                joined, joined))
        print(f"users: {user_count:,}")

        flat_rows = []  # (flat_id, owner_name, quality)
        with cur.copy("COPY locations (id, address, building_name, latitude, longitude, "
                      "created_at, updated_at) FROM STDIN") as copy:
            for n, (area, lat, lng) in enumerate(places(rng, location_count)):
                created = datetime(2024, 1, 1, tzinfo=timezone.utc) + timedelta(
                    minutes=rng.randint(0, 900_000))
                building = (f"{rng.choice(BUILDING_WORDS)} {rng.choice(BUILDING_KINDS)}"
                            if rng.random() < 0.7 else None)
                address = (f"{rng.randint(1, 999)}, {rng.randint(1, 30)}th "
                           f"{rng.choice(STREETS)}, {area}, Bengaluru")
                copy.write_row((bulk_id("location", n), address, building, lat, lng,
                                created, created))
                flat_rows.append((n, created))
        print(f"locations: {location_count:,}")

        flats = []
        with cur.copy("COPY flats (id, location_id, label, created_at, updated_at) "
                      "FROM STDIN") as copy:
            for loc, created in flat_rows:
                count = rng.choices([1, 2, 3, 4, 5], [30, 25, 20, 15, 10])[0]
                labels = set()
                while len(labels) < count:
                    labels.add(f"{rng.choice('ABCD')}-{rng.randint(1, 14)}{rng.randint(1, 8):02d}"
                               if rng.random() < 0.5 else f"{rng.randint(1, 14)}{rng.randint(1, 8):02d}")
                for label in labels:
                    flat_id = bulk_id("flat", len(flats))
                    copy.write_row((flat_id, bulk_id("location", loc), label, created, created))
                    # Each flat has one owner with a typical behaviour.
                    flats.append((flat_id, person(rng), rng.choices([5, 4, 3, 2, 1],
                                                                    [30, 35, 18, 10, 7])[0]))
        print(f"flats: {len(flats):,}")

        written = 0
        with cur.copy("COPY tenant_reviews (id, author_id, flat_id, owner_name, "
                      "tenancy_start_date, tenancy_end_date, rating, feedback, proof_policy_id, "
                      "submitted_at, updated_at) FROM STDIN") as copy:
            order = list(range(len(flats)))
            rng.shuffle(order)
            for i, f in enumerate(order):
                remaining = reviews - written
                if remaining <= 0:
                    break
                # Re-aim each flat so the total lands on the target count.
                per_flat = remaining / (len(order) - i)
                k = min(remaining, round(rng.expovariate(1 / per_flat)), 10)
                flat_id, owner, quality = flats[f]
                # Back-to-back, non-overlapping tenancies ending before today.
                end = months(today, -rng.randint(0, 6))
                for _ in range(k):
                    start = months(end, -rng.randint(11, 36))
                    rating = max(1, min(5, round(rng.gauss(quality, 0.8))))
                    submitted = datetime.combine(
                        min(end + timedelta(days=rng.randint(1, 120)), today),
                        datetime.min.time(), timezone.utc) + timedelta(
                        seconds=rng.randint(0, 86_399))
                    copy.write_row((bulk_id("review", written),
                                    bulk_id("user", rng.randrange(user_count)), flat_id, owner,
                                    start, end, rating, feedback(rng, rating), policy_id,
                                    submitted, submitted))
                    written += 1
                    end = start - timedelta(days=rng.randint(0, 60))
                if written and written % 200_000 < k:
                    print(f"  tenant reviews: {written:,}")
        print(f"tenant reviews: {written:,}")

        interactions = 0
        with cur.copy("COPY interaction_reviews (id, author_id, flat_id, owner_name, "
                      "description, interaction_date, submitted_at) FROM STDIN") as copy:
            for flat_id, owner, _ in flats:
                if rng.random() >= 0.35:
                    continue
                for author in rng.sample(range(user_count), rng.randint(1, 2)):
                    day = today - timedelta(days=rng.randint(1, 900))
                    copy.write_row((bulk_id("interaction", interactions),
                                    bulk_id("user", author), flat_id, owner,
                                    rng.choice(INTERACTIONS), day,
                                    datetime.combine(day, datetime.min.time(), timezone.utc)))
                    interactions += 1
        print(f"interaction reviews: {interactions:,}")

        raw.commit()
    except BaseException:
        raw.rollback()
        raise
    finally:
        raw.close()

    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        for table in ("users", "locations", "flats", "tenant_reviews", "interaction_reviews"):
            conn.execute(text(f"ANALYZE {table}"))
    print(f"Done in {time.monotonic() - started:.0f}s.")


def delete():
    low, high = f"{PREFIX}-0000-0000-0000-000000000000", f"{PREFIX}-ffff-ffff-ffff-ffffffffffff"
    with engine.begin() as conn:
        # Children first; reviews are only ever attached to bulk flats/users.
        for table, column in [
            ("interaction_reviews", "id"),
            ("tenant_reviews", "id"),
            ("flats", "id"),
            ("locations", "id"),
            ("users", "id"),
        ]:
            result = conn.execute(
                text(f"DELETE FROM {table} WHERE {column} BETWEEN :low AND :high"),
                {"low": low, "high": high},
            )
            print(f"{table}: deleted {result.rowcount:,}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--reviews", type=int, default=1_000_000)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--delete", action="store_true")
    args = parser.parse_args()
    if args.delete:
        delete()
    else:
        seed(args.reviews, args.seed)
