/** Place search with Google Places API (New): Autocomplete, then Place Details. */
import { REGION } from "../region";
import type { Area, PlaceSearch, Point, Suggestion } from "../types";
import { loadGoogleMaps } from "./loader";

/** Google place types that describe an area rather than a single building. */
function isArea(types: readonly string[]) {
  return types.some(
    (t) =>
      t === "locality" ||
      t === "neighborhood" ||
      t === "colloquial_area" ||
      t === "postal_code" ||
      t === "country" ||
      t.startsWith("sublocality") ||
      t.startsWith("administrative_area"),
  );
}

function isCity(types: readonly string[]) {
  return types.some(
    (t) => t === "locality" || t.startsWith("administrative_area"),
  );
}

/** The map target for a place whose location and viewport have been fetched. */
function toArea(
  place: google.maps.places.Place,
  name: string,
  detail?: string,
): Area {
  const at = place.location;
  if (!at) throw new Error("The place has no location.");
  const types = place.types ?? [];
  const area = isArea(types);
  const v = place.viewport;
  return {
    name,
    detail,
    center: { latitude: at.lat(), longitude: at.lng() },
    // A building is centred close up; an area is fitted to its extent.
    bounds:
      area && v
        ? {
            west: v.getSouthWest().lng(),
            south: v.getSouthWest().lat(),
            east: v.getNorthEast().lng(),
            north: v.getNorthEast().lat(),
          }
        : undefined,
    zoom: !area ? 18 : isCity(types) ? 12 : 15,
    exact: !area,
  };
}

/**
 * Only "Essentials" fields, so picking a suggestion is billed at the cheapest
 * Place Details tier; the name comes from the suggestion itself. Asking for
 * displayName as well would bill the pick as Pro.
 */
const PICK_FIELDS = ["location", "viewport", "types"];

/**
 * Places picked earlier in this visit, by Google place id, so picking one
 * again doesn't pay for another lookup. Kept in memory only, never stored.
 */
const picked = new Map<string, Area>();

/**
 * Localities and buildings from Google Places Autocomplete, biased to `near`
 * so "Nagar" near JP Nagar gives Nagarabhavi, not Nagpur. One Autocomplete
 * session token runs from the first keystroke to the pick, so Google bills
 * the typing as one search.
 */
export function createGoogleSearch(): PlaceSearch {
  let session: google.maps.places.AutocompleteSessionToken | null = null;
  return {
    async search(text: string, near?: Point): Promise<Suggestion[]> {
      const { places } = await loadGoogleMaps();
      session ??= new places.AutocompleteSessionToken();
      const request: google.maps.places.AutocompleteRequest = {
        input: text,
        sessionToken: session,
        includedRegionCodes: [REGION.countryCode.toLowerCase()],
        language: "en",
        region: REGION.countryCode.toLowerCase(),
      };
      if (near) {
        const center = { lat: near.latitude, lng: near.longitude };
        request.locationBias = { center, radius: 50000 };
        request.origin = center;
      }
      const { suggestions } =
        await places.AutocompleteSuggestion.fetchAutocompleteSuggestions(
          request,
        );
      const found: Suggestion[] = [];
      for (const { placePrediction: p } of suggestions) {
        if (!p) continue;
        const name = p.mainText?.text || p.text.text;
        const detail = p.secondaryText?.text;
        found.push({
          name,
          detail,
          kind: isArea(p.types) ? "area" : "building",
          resolve: async () => {
            const earlier = picked.get(p.placeId);
            if (earlier) return earlier;
            // toPlace() keeps the session token, which closes the session.
            const place = p.toPlace();
            await place.fetchFields({ fields: PICK_FIELDS });
            const area = toArea(place, name, detail);
            picked.set(p.placeId, area);
            return area;
          },
        });
      }
      return found.slice(0, 8);
    },
    finish() {
      // The pick ended this session; the next search starts a new one.
      session = null;
    },
  };
}
