import pytest

from app.config import Settings, get_settings


@pytest.fixture
def settings(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "ads_provider", "")
    monkeypatch.setattr(s, "adsense_client", "")
    for placement in ("home", "list", "place"):
        monkeypatch.setattr(s, f"adsense_slot_{placement}", "")
    return s


def test_no_ads_by_default(client, settings):
    assert client.get("/api/v1/ads/config").json()["data"] == {
        "provider": None,
        "client": None,
        "slots": {},
    }
    assert client.get("/api/v1/ads.txt").status_code == 404


def test_adsense_slots_and_ads_txt(client, settings, monkeypatch):
    monkeypatch.setattr(settings, "ads_provider", "adsense")
    monkeypatch.setattr(settings, "adsense_client", "ca-pub-123")
    monkeypatch.setattr(settings, "adsense_slot_home", "111")
    monkeypatch.setattr(settings, "adsense_slot_place", "333")
    # A placement without an ad unit id is left out, so it shows nothing.
    assert client.get("/api/v1/ads/config").json()["data"] == {
        "provider": "adsense",
        "client": "ca-pub-123",
        "slots": {"home": "111", "place": "333"},
    }
    response = client.get("/api/v1/ads.txt")
    assert response.text == "google.com, pub-123, DIRECT, f08c47fec0942fa0\n"
    assert response.headers["content-type"].startswith("text/plain")


def test_adsense_requires_publisher_id():
    with pytest.raises(ValueError, match="ADSENSE_CLIENT"):
        Settings(ads_provider="adsense", adsense_client="")
