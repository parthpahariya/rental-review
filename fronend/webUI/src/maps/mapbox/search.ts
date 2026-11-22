/**
 * Place search with the Mapbox Search Box API: /suggest while typing, then
 * /retrieve for the pick. One session token runs from the first keystroke to
 * the pick, so Mapbox bills the typing as one search session.
 */
import { areaFor, getJson, latestOnly } from "../places";
import { REGION } from "../region";
import type { PlaceSearch, Point, Suggestion } from "../types";

const API = "https://api.mapbox.com/search/searchbox/v1";

type MapboxSuggestion = {
  name: string;
  mapbox_id: string;
  feature_type: string;
  place_formatted?: string;
};
type MapboxFeature = {
  geometry: { coordinates: [number, number] };
  properties: { bbox?: [number, number, number, number] };
};

/** Mapbox feature types that are areas rather than a building or address. */
const AREAS = new Set([
  "country",
  "region",
  "postcode",
  "district",
  "place",
  "locality",
  "neighborhood",
  "street",
]);
const CITIES = new Set(["region", "district", "place"]);

export function createMapboxSearch(token: string): PlaceSearch {
  const requests = latestOnly();
  let session: string | null = null;
  return {
    async search(text: string, near?: Point): Promise<Suggestion[]> {
      session ??= crypto.randomUUID();
      const params = new URLSearchParams({
        q: text,
        access_token: token,
        session_token: session,
        country: REGION.countryCode.toLowerCase(),
        language: "en",
        limit: "8",
      });
      if (near)
        params.set(
          "proximity",
          `${near.longitude.toFixed(4)},${near.latitude.toFixed(4)}`,
        );
      const { suggestions } = await getJson<{
        suggestions: MapboxSuggestion[];
      }>(`${API}/suggest?${params}`, requests.next());
      const sessionToken = session;
      return suggestions.map((s) => {
        const exact = !AREAS.has(s.feature_type);
        return {
          name: s.name,
          detail: s.place_formatted,
          kind: exact ? "building" : "area",
          resolve: async () => {
            const query = new URLSearchParams({
              access_token: token,
              session_token: sessionToken,
            });
            const { features } = await getJson<{ features: MapboxFeature[] }>(
              `${API}/retrieve/${encodeURIComponent(s.mapbox_id)}?${query}`,
            );
            const feature = features[0];
            if (!feature) throw new Error("The place has no location.");
            const [longitude, latitude] = feature.geometry.coordinates;
            const b = feature.properties.bbox;
            return areaFor(
              s.name,
              s.place_formatted,
              { latitude, longitude },
              exact,
              b ? { west: b[0], south: b[1], east: b[2], north: b[3] } : undefined,
              CITIES.has(s.feature_type),
            );
          },
        };
      });
    },
    finish() {
      // The retrieve ended this session; the next search starts a new one.
      session = null;
      requests.clear();
    },
  };
}
