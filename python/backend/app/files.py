import secrets
from pathlib import Path
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Form, Request, Response, UploadFile
from fastapi import File as Upload
from fastapi.responses import FileResponse
from sqlalchemy import exists, or_, select
from sqlalchemy.orm import Session

from .common import current_user, fail, file_data, get_or_404
from .config import get_settings
from .database import get_db
from .models import Attachment, File, Proof, User

router = APIRouter()
ALLOWED_TYPES = {
    "application/pdf": b"%PDF-",
    "image/png": b"\x89PNG\r\n\x1a\n",
    "image/jpeg": b"\xff\xd8\xff",
}


def owned_file(db, file_id, user, lock_row=False):
    row = get_or_404(db, File, file_id, lock_row)
    if row.uploader_id != user.id or row.status in {"deleted", "deletion_pending"}:
        fail(404, "NOT_FOUND", "File could not be found.")
    return row


def attachment_files(db, ids, user, purpose):
    rows = []
    for file_id in sorted(ids):
        row = owned_file(db, file_id, user, True)
        if row.purpose != purpose:
            fail(422, "FILE_PURPOSE_MISMATCH", "Choose a file uploaded for this kind of review.")
        if row.status != "ready":
            fail(409, "FILE_NOT_READY", "The file is not ready to attach.")
        attached = db.scalar(
            select(
                or_(
                    exists().where(Proof.file_id == row.id),
                    exists().where(Attachment.file_id == row.id),
                )
            )
        )
        if attached:
            fail(409, "FILE_ALREADY_ATTACHED", "This file has already been attached.")
        rows.append(row)
    return rows


@router.get("/file-upload-policy")
def policy(user: User = Depends(current_user)):
    return {
        "data": {
            "purposes": [
                {
                    "purpose": purpose,
                    "allowed_media_types": list(ALLOWED_TYPES),
                    "max_size_bytes": get_settings().max_upload_bytes,
                }
                for purpose in ("tenancy_proof", "interaction_support")
            ]
        }
    }


@router.post("/files", status_code=202)
async def upload_file(
    request: Request,
    response: Response,
    purpose: Literal["tenancy_proof", "interaction_support"] = Form(...),
    file: UploadFile = Upload(...),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    form = await request.form()
    if len(form.multi_items()) != 2 or set(form.keys()) != {"file", "purpose"}:
        fail(422, "VALIDATION_ERROR", "Upload exactly one file and its purpose.")
    if file.content_type not in ALLOWED_TYPES:
        fail(415, "UNSUPPORTED_MEDIA_TYPE", "Choose a PDF, PNG, or JPEG file.")
    settings = get_settings()
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    storage_key = secrets.token_hex(24)
    target = settings.upload_dir / storage_key
    size = 0
    try:
        with target.open("xb") as output:
            first = await file.read(65536)
            if not first.startswith(ALLOWED_TYPES[file.content_type]):
                fail(
                    415,
                    "UNSUPPORTED_MEDIA_TYPE",
                    "The file content does not match its declared type.",
                )
            chunk = first
            while chunk:
                size += len(chunk)
                if size > settings.max_upload_bytes:
                    fail(
                        413,
                        "FILE_TOO_LARGE",
                        f"Files must be no larger than {settings.max_upload_bytes // 1048576} MB.",
                    )
                output.write(chunk)
                chunk = await file.read(65536)
        filename = Path((file.filename or "upload").replace("\\", "/")).name
        filename = "".join(c for c in filename if c.isprintable())[:255] or "upload"
        row = File(
            uploader_id=user.id,
            purpose=purpose,
            original_filename=filename,
            media_type=file.content_type,
            size_bytes=size,
            storage_key=storage_key,
            status="ready",
        )
        db.add(row)
        db.commit()
    except Exception:
        target.unlink(missing_ok=True)
        raise
    finally:
        await file.close()
    response.headers["Location"] = f"/api/v1/files/{row.id}"
    # Small files are synchronously signature-checked; no malware-scanning claim.
    return {"data": file_data(row)}


@router.get("/files/{file_id}")
def get_file(file_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return {"data": file_data(owned_file(db, file_id, user))}


@router.get("/files/{file_id}/content")
def content(file_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = owned_file(db, file_id, user)
    if row.status != "ready":
        fail(409, "FILE_NOT_READY", "The file is not ready.")
    target = get_settings().upload_dir / row.storage_key
    if not target.is_file():
        fail(404, "NOT_FOUND", "File content is unavailable.")
    return FileResponse(
        target,
        media_type=row.media_type,
        filename=row.original_filename,
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )
