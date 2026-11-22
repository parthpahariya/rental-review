from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# The setting holding each map provider's key; OpenStreetMap needs none.
MAP_KEY_SETTINGS = {
    "google": "google_maps_api_key",
    "here": "here_api_key",
    "mapbox": "mapbox_access_token",
    "ola": "ola_maps_api_key",
}


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
    # Which map and place search the web app uses (see app/maps.py): "google",
    # "here", "mapbox", "ola", or "osm" (OpenStreetMap tiles with Photon search, free
    # and keyless). Empty picks Google when a Google Maps key is set, else OSM.
    map_provider: Literal["", "google", "here", "mapbox", "ola", "osm"] = ""
    # Each provider's browser key. They are public by design (the browser needs them),
    # so restrict each one to the site's domains in that provider's console.
    # Google: Maps JavaScript API + Places API (New).
    google_maps_api_key: str = ""
    # Google Map ID (needed for Advanced Markers). Development uses Google's demo ID.
    google_maps_map_id: str = ""
    # HERE platform API key: Raster Tile API v3 + Autosuggest.
    here_api_key: str = ""
    # Mapbox public access token (pk.…): Static Tiles API + Search Box API.
    mapbox_access_token: str = ""
    # Ola Maps API key: vector tiles + Places Autocomplete.
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
