import argparse
from datetime import timedelta

from sqlalchemy import exists, or_, select

from .config import get_settings
from .database import SessionLocal
from .models import Attachment, File, Proof, ProofPolicy, User, now
from .schemas import PhoneBody


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    admin = commands.add_parser("make-admin", help="Promote an existing OTP-verified account")
    admin.add_argument("mobile_number")
    policy = commands.add_parser("proof-policy")
    policy.add_argument("requirement", choices=["optional", "required"])
    commands.add_parser(
        "cleanup-files", help="Delete removed files and unattached uploads older than 24 hours"
    )
    args = parser.parse_args()
    with SessionLocal.begin() as db:
        if args.command == "make-admin":
            phone = PhoneBody(mobile_number=args.mobile_number).mobile_number
            user = db.scalar(select(User).where(User.mobile_number == phone).with_for_update())
            if user is None:
                parser.error("Sign in and register this mobile number first")
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
