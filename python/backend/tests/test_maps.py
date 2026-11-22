import pytest

from app.config import Settings, get_settings

KEYS = {
    "google": "google_maps_api_key",
    "here": "here_api_key",
    "mapbox": "mapbox_access_token",
    "ola": "ola_maps_api_key",
}


@pytest.fixture
def settings(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "map_provider", "")
    monkeypatch.setattr(s, "google_maps_map_id", "")
    for key in KEYS.values():
        monkeypatch.setattr(s, key, "")
    return s


def config(client):
    return client.get("/api/v1/map/config").json()["data"]


def test_defaults_to_openstreetmap_without_keys(client, settings):
    assert config(client) == {"provider": "osm", "api_key": None, "map_id": None}


def test_defaults_to_google_when_its_key_is_set(client, settings, monkeypatch):
    monkeypatch.setattr(settings, "google_maps_api_key", "g-key")
    assert config(client) == {"provider": "google", "api_key": "g-key", "map_id": "DEMO_MAP_ID"}
    monkeypatch.setattr(settings, "google_maps_map_id", "map-123")
    assert config(client)["map_id"] == "map-123"


@pytest.mark.parametrize("provider", ["here", "mapbox", "ola"])
def test_each_provider_gets_only_its_own_key(client, settings, monkeypatch, provider):
    for name, key in KEYS.items():
        monkeypatch.setattr(settings, key, f"{name}-key")
    monkeypatch.setattr(settings, "map_provider", provider)
    assert config(client) == {"provider": provider, "api_key": f"{provider}-key", "map_id": None}


def test_openstreetmap_hands_out_no_key(client, settings, monkeypatch):
    monkeypatch.setattr(settings, "google_maps_api_key", "g-key")
    monkeypatch.setattr(settings, "map_provider", "osm")
    assert config(client) == {"provider": "osm", "api_key": None, "map_id": None}


@pytest.mark.parametrize("provider, key", KEYS.items())
def test_a_keyed_provider_requires_its_key(provider, key):
    with pytest.raises(ValueError, match=key.upper()):
        Settings(map_provider=provider, **{k: "" for k in KEYS.values()})


def test_unknown_provider_is_rejected():
    with pytest.raises(ValueError):
        Settings(map_provider="bing")
