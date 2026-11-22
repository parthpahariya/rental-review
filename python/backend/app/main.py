import logging
import sys
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from starlette.exceptions import HTTPException

from . import ads, auth, files, google, maps, properties, reviews
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

# Uvicorn's own access log is disabled (--no-access-log); this one adds timing and
# the request id. Bodies and headers are never logged: they carry Google
# credentials and session tokens. Query strings only hold filters, cursors and paging.
access_log = logging.getLogger("rental_review.access")
if not access_log.handlers:
    _handler = logging.StreamHandler(sys.stdout)
    _handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    access_log.addHandler(_handler)
    access_log.setLevel(logging.INFO)
    access_log.propagate = False

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["X-Request-ID", "X-Response-Time", "Retry-After"],
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
    started = time.perf_counter()
    request.state.request_id = str(uuid.uuid4())
    path = request.url.path + (f"?{request.url.query}" if request.url.query else "")
    # Container health probes run every few seconds; only log them when they fail.
    quiet = request.url.path.startswith("/api/health/")
    if not quiet:
        access_log.info("--> %s %s request_id=%s", request.method, path, request.state.request_id)
    response = await handle(request, call_next)
    elapsed_ms = (time.perf_counter() - started) * 1000
    response.headers["X-Request-ID"] = request.state.request_id
    response.headers["X-Response-Time"] = f"{elapsed_ms:.1f}ms"
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    if quiet and response.status_code < 400:
        return response
    access_log.log(
        logging.WARNING if response.status_code >= 500 else logging.INFO,
        "<-- %s %s %s %.1fms size=%s request_id=%s",
        request.method,
        path,
        response.status_code,
        elapsed_ms,
        response.headers.get("content-length", "-"),
        request.state.request_id,
    )
    return response


async def handle(request: Request, call_next):
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
            # Never print request bodies, emails, or credentials.
            logging.error("Unhandled error; request_id=%s", request.state.request_id)
            response = error_response(
                request, 500, "INTERNAL_ERROR", "An unexpected error occurred."
            )
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


for router in [
    auth.router,
    google.router,
    maps.router,
    ads.router,
    properties.router,
    reviews.router,
    files.router,
]:
    app.include_router(router, prefix="/api/v1")
