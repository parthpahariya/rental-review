import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { mapConfig } from "../config";

/** The parts of the Maps JavaScript API this app uses, loaded once. */
export type GoogleMaps = {
  maps: google.maps.MapsLibrary;
  marker: google.maps.MarkerLibrary;
  places: google.maps.PlacesLibrary;
  /** Needed by Advanced Markers; set per environment by the backend. */
  mapId: string;
};

let loading: Promise<GoogleMaps> | null = null;

/**
 * Google calls `window.gm_authFailure` when it rejects the key (wrong referrer,
 * API not enabled, no billing). The map is unusable from then on.
 */
let authFailed = false;
const authListeners = new Set<() => void>();
(window as { gm_authFailure?: () => void }).gm_authFailure = () => {
  authFailed = true;
  authListeners.forEach((listener) => listener());
};
export function onAuthFailure(listener: () => void): () => void {
  if (authFailed) listener();
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

/**
 * Loads Google Maps with the browser key the backend hands out. Rejects when no
 * key is configured or the script fails; a later call tries again.
 */
export function loadGoogleMaps(): Promise<GoogleMaps> {
  loading ??= load().catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
}

async function load(): Promise<GoogleMaps> {
  const config = await mapConfig();
  if (!config.api_key) throw new Error("Google Maps is not configured.");
  setOptions({ key: config.api_key, v: "weekly", region: "IN", language: "en" });
  const [maps, marker, places] = await Promise.all([
    importLibrary("maps"),
    importLibrary("marker"),
    importLibrary("places"),
  ]);
  return { maps, marker, places, mapId: config.map_id ?? "DEMO_MAP_ID" };
}
