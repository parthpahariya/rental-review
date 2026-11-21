import { mapConfig } from "./config";
import type { MapProvider, MapProviderName } from "./types";

/**
 * Each provider is its own bundle chunk, so a visitor downloads only the one
 * the server picked (Google's or Leaflet's code, never both).
 */
const providers: Record<MapProviderName, () => Promise<MapProvider>> = {
  google: () => import("./google").then((m) => m.googleProvider),
  osm: () => import("./osm").then((m) => m.osmProvider),
};

/** The map provider the server is configured for (MAP_PROVIDER). */
export async function loadMapProvider(): Promise<MapProvider> {
  const { provider } = await mapConfig();
  return providers[provider]();
}
