/** Place search with Photon (komoot), an OpenStreetMap geocoder: free, no key. */
import { REGION } from "../region";
import type { Area, PlaceSearch, Point, Suggestion } from "../types";

const GEOCODER = "https://photon.komoot.io/api/";

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    type?: string;
    city?: string;
    county?: string;
    state?: string;
    countrycode?: string;
    extent?: [number, number, number, number];
  };
};

function toAreas(features: PhotonFeature[]): Area[] {
  const areas: Area[] = [];
  for (const { geometry, properties: p } of features) {
    if (!p.name) continue;
    // The bounding box also covers parts of neighbouring countries.
    if (p.countrycode && p.countrycode !== REGION.countryCode) continue;
    const [longitude, latitude] = geometry.coordinates;
    // OpenStreetMap often lists one locality twice, e.g. as a suburb and as
    // an administrative district a short distance apart.
    if (
      areas.some(
        (a) =>
          a.name.toLowerCase() === p.name!.toLowerCase() &&
          Math.abs(a.center.latitude - latitude) < 0.03 &&
          Math.abs(a.center.longitude - longitude) < 0.03,
      )
    )
      continue;
    const detail = [p.city || p.county, p.state]
      .filter((x) => x && x !== p.name)
      .join(", ");
    const e = p.extent;
    areas.push({
      name: p.name,
      detail,
      center: { latitude, longitude },
      bounds: e
        ? { west: e[0], north: e[1], east: e[2], south: e[3] }
        : undefined,
      zoom: p.type === "city" ? 12 : 15,
    });
  }
  return areas;
}

/**
 * Localities in India from Photon. With `near`, matches are ranked by distance
 * from that point. OpenStreetMap knows few apartment names in India, so this
 * suggests areas only; buildings are found on the map.
 */
export function createOsmSearch(): PlaceSearch {
  let inFlight: AbortController | null = null;
  return {
    async search(text: string, near?: Point): Promise<Suggestion[]> {
      // A newer search makes the previous answer useless.
      inFlight?.abort();
      const controller = new AbortController();
      inFlight = controller;
      const params = new URLSearchParams({
        q: text,
        // Ask for extra: some results are dropped as duplicates or outside India.
        limit: "15",
        lang: "en",
        bbox: REGION.bbox,
      });
      if (near) {
        params.set("lat", near.latitude.toFixed(4));
        params.set("lon", near.longitude.toFixed(4));
      }
      for (const layer of ["locality", "district", "city"])
        params.append("layer", layer);
      const response = await fetch(`${GEOCODER}?${params}`, {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Locality search is unavailable.");
      const body: { features: PhotonFeature[] } = await response.json();
      return toAreas(body.features)
        .slice(0, 8)
        .map((area) => ({
          name: area.name,
          detail: area.detail,
          kind: "area" as const,
          resolve: () => Promise.resolve(area),
        }));
    },
    finish() {
      inFlight = null;
    },
  };
}
