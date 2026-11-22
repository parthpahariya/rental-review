from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# The setting holding each map provider's key; OpenStreetMap needs none.
MAP_KEY_SETTINGS = {"ola": "ola_maps_api_key"}


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
    # Which map and place search the web app uses (see app/maps.py): "ola" (Ola
    # Maps) or "osm" (OpenStreetMap tiles with Photon search, free and keyless).
    # Empty picks Ola when its key is set, else OpenStreetMap.
    map_provider: Literal["", "ola", "osm"] = ""
    # Ola Maps API key: vector tiles + Places Autocomplete. It is public by design
    # (the browser sends it), so restrict it to the site's domains in Ola's console.
    ola_maps_api_key: str = ""
    cors_origins: str = "http://localhost:5173,http://localhost:8080"

    @model_validator(mode="after")
    def validate_deployment(self):
        if self.app_env == "production" and (
            len(self.secret_key) < 32 or self.secret_key.startswith("local-development")
        ):
            raise ValueError("Production requires a private SECRET_KEY")
        key_setting = MAP_KEY_SETTINGS.get(self.map_provider)
        if key_setting and not getattr(self, key_setting):
            raise ValueError(
                f"MAP_PROVIDER={self.map_provider} requires {key_setting.upper()}"
            )
        if self.app_env == "production" and not self.google_audiences:
            raise ValueError("Production requires GOOGLE_CLIENT_IDS (the only sign-in method)")
        return self

    @property
    def google_audiences(self):
        return [x.strip() for x in self.google_client_ids.split(",") if x.strip()]


@lru_cache
def get_settings():
    return Settings()
