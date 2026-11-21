from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://rental:rental@localhost:5432/rental_review"
    app_env: str = "development"
    secret_key: str = "local-development-only-change-before-deployment"
    # Google sign-in attempts allowed per client IP per hour.
    google_sign_in_ip_limit: int = 100
    session_days: int = 7
    upload_dir: Path = Path("uploads")
    max_upload_bytes: int = 5 * 1024 * 1024
    # OAuth web client id(s) from Google Cloud Console, comma-separated. Google is
    # the only way to sign in, so with this empty nobody can sign in.
    google_client_ids: str = ""
    # Which map and place search the web app uses: "google" or "osm" (OpenStreetMap
    # tiles with Photon search, free and keyless). Empty picks Google when a Maps key
    # is set and OpenStreetMap otherwise.
    map_provider: Literal["", "google", "osm"] = ""
    # Browser key for the Maps JavaScript API and Places API (New), restricted by HTTP
    # referrer in Google Cloud Console. Empty means the map shows as unavailable.
    google_maps_api_key: str = ""
    # Map ID (needed for Advanced Markers). Development falls back to Google's demo ID.
    google_maps_map_id: str = ""
    cors_origins: str = "http://localhost:5173,http://localhost:8080"

    @model_validator(mode="after")
    def validate_deployment(self):
        if self.app_env == "production" and (
            len(self.secret_key) < 32 or self.secret_key.startswith("local-development")
        ):
            raise ValueError("Production requires a private SECRET_KEY")
        if self.map_provider == "google" and not self.google_maps_api_key:
            raise ValueError("MAP_PROVIDER=google requires GOOGLE_MAPS_API_KEY")
        if self.app_env == "production" and not self.google_audiences:
            raise ValueError("Production requires GOOGLE_CLIENT_IDS (the only sign-in method)")
        return self

    @property
    def google_audiences(self):
        return [x.strip() for x in self.google_client_ids.split(",") if x.strip()]


@lru_cache
def get_settings():
    return Settings()
