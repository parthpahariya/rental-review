/** Helpers shared by the providers' place searches. */
import type { Area, Bounds, Point, Suggestion } from "./types";

/**
 * Google-style place types (Google, Ola) that describe an area rather than a
 * single building.
 */
export function isAreaType(types: readonly string[]) {
  return types.some(
    (t) =>
      t === "locality" ||
      t === "neighborhood" ||
      t === "colloquial_area" ||
      t === "postal_code" ||
      t === "country" ||
      t === "political" ||
      t.startsWith("sublocality") ||
      t.startsWith("administrative_area"),
  );
}

export function isCityType(types: readonly string[]) {
  return types.some(
    (t) => t === "locality" || t.startsWith("administrative_area"),
  );
}

/** Zoom for a place: close up for a building, wider for an area or city. */
export function zoomFor(exact: boolean, city = false) {
  return exact ? 18 : city ? 12 : 15;
}

/**
 * The map target for a place. A building is centred close up and marked; an
 * area is fitted to its extent when the provider gives one.
 */
export function areaFor(
  name: string,
  detail: string | undefined,
  center: Point,
  exact: boolean,
  bounds?: Bounds,
  city = false,
): Area {
  return {
    name,
    detail,
    center,
    bounds: exact ? undefined : bounds,
    zoom: zoomFor(exact, city),
    exact,
  };
}

/** A suggestion whose place is already known, so picking it costs nothing. */
export function known(area: Area): Suggestion {
  return {
    name: area.name,
    detail: area.detail,
    kind: area.exact ? "building" : "area",
    resolve: () => Promise.resolve(area),
  };
}

/** GET a provider URL as JSON, failing on any HTTP error. */
export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Place search failed (${response.status}).`);
  return response.json() as Promise<T>;
}

/** Aborts the previous request when a newer one starts. */
export function latestOnly() {
  let current: AbortController | null = null;
  return {
    next() {
      current?.abort();
      current = new AbortController();
      return current.signal;
    },
    clear() {
      current = null;
    },
  };
}
