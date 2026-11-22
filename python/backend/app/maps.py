"""Map settings for the web app: which provider draws the map and runs place
search, and that provider's browser key. Stored places never depend on the
provider (see models.Location), so this can change at any time."""

from fastapi import APIRouter

from .config import MAP_KEY_SETTINGS, get_settings

router = APIRouter()


def current_provider(settings):
    return settings.map_provider or ("ola" if settings.ola_maps_api_key else "osm")


@router.get("/map/config")
def map_config():
    """The provider and its browser key (public by design: the browser sends it to
    the provider). OpenStreetMap needs no key."""
    settings = get_settings()
    provider = current_provider(settings)
    key_setting = MAP_KEY_SETTINGS.get(provider)
    api_key = getattr(settings, key_setting) if key_setting else ""
    return {"data": {"provider": provider, "api_key": api_key or None}}
