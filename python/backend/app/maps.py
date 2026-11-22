"""Map settings for the web app: which provider draws the map and runs place
search, and that provider's browser key. Stored places never depend on the
provider (see models.Location), so this can change at any time."""

from fastapi import APIRouter

from .config import MAP_KEY_SETTINGS, get_settings

router = APIRouter()


def current_provider(settings):
    return settings.map_provider or ("google" if settings.google_maps_api_key else "osm")


@router.get("/map/config")
def map_config():
    """The provider, its browser key (public by design: the browser sends it to the
    provider), and for Google the map ID. Only the chosen provider's key is sent."""
    settings = get_settings()
    provider = current_provider(settings)
    key_setting = MAP_KEY_SETTINGS.get(provider)
    map_id = None
    if provider == "google":
        map_id = settings.google_maps_map_id or (
            "DEMO_MAP_ID" if settings.app_env != "production" else None
        )
    return {
        "data": {
            "provider": provider,
            "api_key": (getattr(settings, key_setting) or None) if key_setting else None,
            "map_id": map_id,
        }
    }
