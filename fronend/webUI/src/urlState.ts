/**
 * Where the visitor is, kept in the address bar so a refresh, the back button
 * or a shared link reopens the same map spot, place and flat:
 *
 *   /?at=12.93520,77.62450,16&area=Koramangala&place=<uuid>&flat=<uuid>
 *     &review=<uuid>   (or &interaction=<uuid>: one post open on its own page)
 */
import type { Point } from "./Map";

export type UrlState = {
  at: (Point & { zoom: number }) | null;
  area: string | null;
  place: string | null;
  flat: string | null;
  /** A tenant review or interaction opened on its own page, within the place. */
  post: { kind: "review" | "interaction"; id: string } | null;
};

// Ids are UUIDs; anything else safe for a URL path segment is let through for
// the API to reject, but nothing like "../" can reach the request path.
const ID = /^[A-Za-z0-9-]{1,64}$/;

export function readUrlState(search = window.location.search): UrlState {
  const params = new URLSearchParams(search);
  const id = (key: string) => {
    const value = params.get(key);
    return value && ID.test(value) ? value : null;
  };
  let at: UrlState["at"] = null;
  const parts = (params.get("at") || "").split(",").map(Number);
  if (parts.length === 3 && parts.every(Number.isFinite)) {
    const [latitude, longitude, zoom] = parts;
    if (
      Math.abs(latitude) <= 90 &&
      Math.abs(longitude) <= 180 &&
      zoom >= 2 &&
      zoom <= 19
    )
      at = { latitude, longitude, zoom: Math.round(zoom) };
  }
  return {
    at,
    area: params.get("area")?.slice(0, 100) || null,
    place: id("place"),
    flat: id("flat"),
    post: id("review")
      ? { kind: "review", id: id("review")! }
      : id("interaction")
        ? { kind: "interaction", id: id("interaction")! }
        : null,
  };
}

export function writeUrlState(state: UrlState) {
  const params = new URLSearchParams();
  if (state.at)
    params.set(
      "at",
      [
        state.at.latitude.toFixed(5),
        state.at.longitude.toFixed(5),
        String(state.at.zoom),
      ].join(","),
    );
  if (state.area) params.set("area", state.area);
  if (state.place) params.set("place", state.place);
  if (state.place && state.flat) params.set("flat", state.flat);
  if (state.place && state.post) params.set(state.post.kind, state.post.id);
  const query = params.toString().replace(/%2C/g, ",");
  const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  // Replace rather than push: panning shouldn't flood the back history.
  if (
    url !==
    `${window.location.pathname}${window.location.search}${window.location.hash}`
  )
    window.history.replaceState(window.history.state, "", url);
}
