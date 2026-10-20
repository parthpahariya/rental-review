import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from starlette.exceptions import HTTPException

from . import auth, files, properties, reviews
from .common import ApiError
from .config import get_settings
from .database import engine

app = FastAPI(
    title="Rental Review API",
    version="1.0.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)
settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["X-Request-ID", "Retry-After"],
)


def error_response(request, status, code, message, fields=None, headers=None, retry_after=None):
    payload = {
        "code": code,
        "message": message,
        "fields": fields or [],
        "request_id": getattr(request.state, "request_id", str(uuid.uuid4())),
    }
    if retry_after is not None:
        payload["retry_after_seconds"] = retry_after
        headers = {**(headers or {}), "Retry-After": str(retry_after)}
    return JSONResponse({"error": payload}, status_code=status, headers=headers)


@app.middleware("http")
async def request_headers(request: Request, call_next):
    request.state.request_id = str(uuid.uuid4())
    try:
        length = int(request.headers.get("content-length", "0"))
    except ValueError:
        return error_response(request, 400, "MALFORMED_REQUEST", "Invalid Content-Length.")
    if length > settings.max_upload_bytes + 1048576:
        response = error_response(
            request, 413, "FILE_TOO_LARGE", "Request exceeds the upload limit."
        )
    else:
        try:
            response = await call_next(request)
        except Exception:
            # Never print request bodies, phone numbers, OTPs, or credentials.
            logging.error("Unhandled error; request_id=%s", request.state.request_id)
            response = error_response(
                request, 500, "INTERNAL_ERROR", "An unexpected error occurred."
            )
    response.headers["X-Request-ID"] = request.state.request_id
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.exception_handler(ApiError)
async def api_error(request, exc):
    return error_response(request, exc.status, exc.code, exc.message, retry_after=exc.retry_after)


@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    # Pydantic's raw errors can contain the submitted secret; project only safe fields.
    fields = [
        {
            "field": ".".join(str(x) for x in item["loc"] if x != "body"),
            "code": "INVALID",
            "message": item["msg"],
        }
        for item in exc.errors()
    ]
    return error_response(
        request, 422, "VALIDATION_ERROR", "Please check the supplied information.", fields
    )


@app.exception_handler(HTTPException)
async def http_error(request, exc):
    codes = {404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED", 413: "FILE_TOO_LARGE"}
    return error_response(
        request,
        exc.status_code,
        codes.get(exc.status_code, "MALFORMED_REQUEST"),
        str(exc.detail),
        headers=exc.headers,
    )


@app.exception_handler(IntegrityError)
async def integrity_error(request, exc):
    constraint = getattr(getattr(exc.orig, "diag", None), "constraint_name", "")
    if constraint == "uq_interaction_author_flat":
        return error_response(
            request,
            409,
            "INTERACTION_REVIEW_ALREADY_EXISTS",
            "You have already reviewed an interaction for this flat.",
        )
    if constraint == "uq_pending_deletion":
        return error_response(
            request, 409, "REQUEST_ALREADY_PENDING", "A deletion request is already pending."
        )
    return error_response(
        request, 409, "RESOURCE_CONFLICT", "This change conflicts with an existing record."
    )


@app.exception_handler(SQLAlchemyError)
async def database_error(request, exc):
    return error_response(
        request, 503, "SERVICE_UNAVAILABLE", "Database temporarily unavailable. Please try again."
    )


@app.get("/api/health/live", tags=["health"])
def live():
    return {"status": "ok"}


@app.get("/api/health/ready", tags=["health"])
def ready():
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
        connection.execute(text("SELECT version_num FROM alembic_version"))
    return {"status": "ok", "database": "ok"}


for router in [auth.router, properties.router, reviews.router, files.router]:
    app.include_router(router, prefix="/api/v1")
