/** Place search with Ola Maps Places: Autocomplete, then Details if needed. */
import {
  areaFor,
  getJson,
  isAreaType,
  isCityType,
  latestOnly,
} from "../places";
import type { PlaceSearch, Point, Suggestion } from "../types";

const API = "https://api.olamaps.io/places/v1";

/** Adds the API key to an Ola Maps URL; other URLs pass through unchanged. */
export function withOlaKey(url: string, key: string) {
  if (!url.startsWith("https://api.olamaps.io/")) return url;
  const u = new URL(url);
  u.searchParams.set("api_key", key);
  return u.toString();
}

type OlaPrediction = {
  description: string;
  place_id: string;
  types?: string[];
  structured_formatting?: { main_text?: string; secondary_text?: string };
  geometry?: { location?: { lat: number; lng: number } };
};
type OlaDetails = {
  result?: { geometry?: { location?: { lat: number; lng: number } } };
};

export function createOlaSearch(key: string): PlaceSearch {
  const requests = latestOnly();
  return {
    async search(text: string, near?: Point): Promise<Suggestion[]> {
      const params = new URLSearchParams({ input: text, language: "en" });
      if (near)
        params.set(
          "location",
          `${near.latitude.toFixed(4)},${near.longitude.toFixed(4)}`,
        );
      const { predictions = [] } = await getJson<{
        predictions?: OlaPrediction[];
      }>(withOlaKey(`${API}/autocomplete?${params}`, key), requests.next());
      return predictions.slice(0, 8).map((p) => {
        const types = p.types ?? [];
        const exact = !isAreaType(types);
        const name = p.structured_formatting?.main_text || p.description;
        const detail = p.structured_formatting?.secondary_text;
        return {
          name,
          detail,
          kind: exact ? "building" : "area",
          resolve: async () => {
            // Autocomplete usually includes the location; Details otherwise.
            let at = p.geometry?.location;
            if (!at) {
              const details = await getJson<OlaDetails>(
                withOlaKey(
                  `${API}/details?place_id=${encodeURIComponent(p.place_id)}`,
                  key,
                ),
              );
              at = details.result?.geometry?.location;
            }
            if (!at) throw new Error("The place has no location.");
            return areaFor(
              name,
              detail,
              { latitude: at.lat, longitude: at.lng },
              exact,
              undefined,
              isCityType(types),
            );
          },
        };
      });
    },
    finish() {
      requests.clear();
    },
  };
}
