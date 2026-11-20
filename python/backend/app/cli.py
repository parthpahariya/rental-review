import argparse
from datetime import timedelta

from sqlalchemy import exists, func, or_, select

from .config import get_settings
from .database import SessionLocal
from .models import Attachment, File, Proof, ProofPolicy, User, now


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    admin = commands.add_parser("make-admin", help="Promote an account that signed in with Google")
    admin.add_argument("email")
    policy = commands.add_parser("proof-policy")
    policy.add_argument("requirement", choices=["optional", "required"])
    commands.add_parser(
        "cleanup-files", help="Delete removed files and unattached uploads older than 24 hours"
    )
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
        elif args.command == "proof-policy":
            db.add(ProofPolicy(proof_required=args.requirement == "required"))
            print("New proof policy recorded.")
        elif args.command == "cleanup-files":
            rows = db.scalars(
                select(File)
                .where(
                    or_(
                        File.status == "deletion_pending",
                        (File.created_at < now() - timedelta(hours=24))
                        & ~exists().where(Proof.file_id == File.id)
                        & ~exists().where(Attachment.file_id == File.id),
                    )
                )
                .with_for_update()
            )
            count = 0
            for row in rows:
                (get_settings().upload_dir / row.storage_key).unlink(missing_ok=True)
                row.status = "deleted"
                count += 1
            print(f"Cleaned up {count} files.")


if __name__ == "__main__":
    main()
