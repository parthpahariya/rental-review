/** Place search with HERE Autosuggest (v1). Results carry their position. */
import { areaFor, getJson, known, latestOnly } from "../places";
import { DEFAULT_CENTER, REGION } from "../region";
import type { PlaceSearch, Point, Suggestion } from "../types";

const AUTOSUGGEST = "https://autosuggest.search.hereapi.com/v1/autosuggest";

type HereItem = {
  title: string;
  resultType?: string;
  address?: { label?: string };
  position?: { lat: number; lng: number };
  mapView?: { west: number; south: number; east: number; north: number };
};

/** HERE result types for a single building or address, rather than an area. */
const EXACT = new Set(["place", "houseNumber", "addressBlock"]);
const CITY = new Set(["administrativeArea"]);

export function createHereSearch(apiKey: string): PlaceSearch {
  const requests = latestOnly();
  return {
    async search(text: string, near?: Point): Promise<Suggestion[]> {
      // HERE needs a point to rank around; default to the starting city.
      const at = near ?? DEFAULT_CENTER.center;
      const params = new URLSearchParams({
        q: text,
        at: `${at.latitude.toFixed(4)},${at.longitude.toFixed(4)}`,
        in: `countryCode:${REGION.countryCode3}`,
        limit: "8",
        lang: "en",
        apiKey,
      });
      const { items } = await getJson<{ items: HereItem[] }>(
        `${AUTOSUGGEST}?${params}`,
        requests.next(),
      );
      // Query suggestions ("restaurants near…") have no position; skip them.
      return items
        .filter((i) => i.position)
        .map((i) => {
          const exact = EXACT.has(i.resultType ?? "");
          const label = i.address?.label;
          return known(
            areaFor(
              i.title,
              label && label !== i.title ? label : undefined,
              { latitude: i.position!.lat, longitude: i.position!.lng },
              exact,
              i.mapView,
              CITY.has(i.resultType ?? ""),
            ),
          );
        });
    },
    finish() {
      requests.clear();
    },
  };
}
