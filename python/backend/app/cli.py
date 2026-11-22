import argparse

from sqlalchemy import func, select

from .database import SessionLocal
from .models import User


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    admin = commands.add_parser("make-admin", help="Promote an account that signed in with Google")
    admin.add_argument("email")
    args = parser.parse_args()
    with SessionLocal.begin() as db:
        if args.command == "make-admin":
            users = db.scalars(
                select(User)
                .where(User.google_subject.is_not(None))
                .where(func.lower(User.email) == args.email.strip().lower())
                .with_for_update()
            ).all()
            if not users:
                parser.error("Sign in with this Google account first")
            if len(users) > 1:
                parser.error("Several accounts have used this email; promote by id in SQL")
            user = users[0]
            user.role = "admin"
            print("Account promoted to administrator.")


if __name__ == "__main__":
    main()
