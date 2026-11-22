/**
 * Typed coordinates in the search box, e.g. "12.9716, 77.5946" copied from a
 * phone's map app. They're the visitor's own input, so going there needs no
 * provider, and a place search would only return noise for them.
 */
import { REGION } from "./region";
import type { Area, Point } from "./types";

const PAIR = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

/** True for text that is just two numbers, whether or not they're valid. */
export function looksLikeCoordinates(text: string) {
  return PAIR.test(text);
}

/** "latitude, longitude" inside the search region (India), or null. */
export function parseCoordinates(text: string): Point | null {
  const match = PAIR.exec(text);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  const [west, south, east, north] = REGION.bbox.split(",").map(Number);
  if (
    latitude < south ||
    latitude > north ||
    longitude < west ||
    longitude > east
  )
    return null;
  return { latitude, longitude };
}

/** The map target for typed coordinates: centred close up and marked. */
export function coordinatesArea(point: Point): Area {
  return {
    name: `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`,
    detail: "Coordinates",
    center: point,
    zoom: 18,
    exact: true,
  };
}
