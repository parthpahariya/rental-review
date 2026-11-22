import pytest

from app.config import Settings, get_settings


@pytest.fixture
def settings(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "map_provider", "")
    monkeypatch.setattr(s, "ola_maps_api_key", "")
    return s


def config(client):
    return client.get("/api/v1/map/config").json()["data"]


def test_defaults_to_openstreetmap_without_a_key(client, settings):
    assert config(client) == {"provider": "osm", "api_key": None}


def test_defaults_to_ola_when_its_key_is_set(client, settings, monkeypatch):
    monkeypatch.setattr(settings, "ola_maps_api_key", "ola-key")
    assert config(client) == {"provider": "ola", "api_key": "ola-key"}


def test_openstreetmap_hands_out_no_key(client, settings, monkeypatch):
    monkeypatch.setattr(settings, "ola_maps_api_key", "ola-key")
    monkeypatch.setattr(settings, "map_provider", "osm")
    assert config(client) == {"provider": "osm", "api_key": None}


def test_ola_requires_its_key():
    with pytest.raises(ValueError, match="OLA_MAPS_API_KEY"):
        Settings(map_provider="ola", ola_maps_api_key="")


@pytest.mark.parametrize("provider", ["google", "here", "mapbox", "bing"])
def test_other_providers_are_rejected(provider):
    with pytest.raises(ValueError):
        Settings(map_provider=provider)
