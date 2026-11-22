"""Ad settings for the web app: which ad network fills the page's ad slots,
and its ids. With ADS_PROVIDER empty the page loads no ad script at all."""

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

from .config import get_settings

router = APIRouter()

# Where the web app may show an ad. Never on the map or inside a place's reviews.
PLACEMENTS = ("home", "list", "place")


@router.get("/ads/config")
def ads_config():
    settings = get_settings()
    if settings.ads_provider != "adsense":
        return {"data": {"provider": None, "client": None, "slots": {}}}
    slots = {p: getattr(settings, f"adsense_slot_{p}") for p in PLACEMENTS}
    return {
        "data": {
            "provider": "adsense",
            "client": settings.adsense_client,
            "slots": {p: unit for p, unit in slots.items() if unit},
        }
    }


@router.get("/ads.txt", response_class=PlainTextResponse)
def ads_txt():
    """Authorises the ad network to sell this site's ad space (served at /ads.txt)."""
    settings = get_settings()
    if settings.ads_provider != "adsense":
        return PlainTextResponse("", status_code=404)
    publisher = settings.adsense_client.removeprefix("ca-")
    return f"google.com, {publisher}, DIRECT, f08c47fec0942fa0\n"
