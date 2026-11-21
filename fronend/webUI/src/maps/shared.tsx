/** Map behaviour that is the same whichever provider draws the map. */
import { formatCount, formatShort, formatShortAtLeast } from "../format";
import type { Bounds } from "./types";

/** Closest zoom used; pins are never grouped at this level. */
export const MAX_ZOOM = 19;

/** Where the map opens before any area is chosen (Bengaluru). */
export const START = { latitude: 12.955, longitude: 77.63, zoom: 12 };

export const MAP_LABEL =
  "Interactive rental location map. Select a pin to read reviews, or select an empty spot to add a new place. The property list provides the same results.";

/** Shown in place of the map when it can't load; the list still works. */
export function MapUnavailable() {
  return (
    <div className="property-map" role="region" aria-label={MAP_LABEL}>
      <p className="map-unavailable" role="status">
        The map isn’t available right now. The property list shows the same
        places.
      </p>
    </div>
  );
}

/** Maps keep counting past ±180° when the world repeats; the API won't. */
export function wrapLongitude(lng: number) {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/** Valid WGS84 bounds from unwrapped ones (west > east crosses the antimeridian). */
export function validBounds(b: Bounds): Bounds {
  const south = Math.max(-90, b.south);
  const north = Math.min(90, b.north);
  if (b.east - b.west >= 360) return { west: -180, south, east: 180, north };
  return {
    west: wrapLongitude(b.west),
    south,
    east: wrapLongitude(b.east),
    north,
  };
}

/**
 * How far (px) pins reach to merge into one bubble. Wide when zoomed out so the
 * city reads as a few well-spaced bubbles; tighter close up so single buildings
 * show as their own pins.
 */
export function clusterRadius(zoom: number) {
  if (zoom <= 13) return 160;
  if (zoom <= 15) return 130;
  if (zoom <= 16) return 100;
  return 60;
}

/** The rating label on a building's pin. */
export function pinLabel(averageRating: number | null) {
  return averageRating == null ? "New" : `★ ${averageRating.toFixed(1)}`;
}

/**
 * Size, text and spoken label of a bubble standing for `count` pins. With
 * `partial`, only some places in view are loaded, so counts are lower bounds.
 */
export function clusterLabel(count: number, partial: boolean) {
  return {
    size: count < 10 ? 44 : count < 100 ? 52 : count < 1000 ? 60 : 68,
    text: partial ? formatShortAtLeast(count) : formatShort(count),
    spoken: `${partial ? "At least " : ""}${formatCount(count)} places`,
  };
}
