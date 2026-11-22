import { mapConfig } from "./config";
import type {
  CreateMapProvider,
  MapProvider,
  MapProviderName,
} from "./types";

/**
 * Every map provider, each in its own folder and its own bundle chunk, so a
 * visitor downloads only the one the server picked. Adding a provider means a
 * folder implementing CreateMapProvider plus one line here (and its key on the
 * server, see python/backend/app/maps.py).
 */
const providers: Record<MapProviderName, () => Promise<CreateMapProvider>> = {
  google: () => import("./google").then((m) => m.createGoogleProvider),
  here: () => import("./here").then((m) => m.createHereProvider),
  mapbox: () => import("./mapbox").then((m) => m.createMapboxProvider),
  ola: () => import("./ola").then((m) => m.createOlaProvider),
  osm: () => import("./osm").then((m) => m.createOsmProvider),
};

/** The map provider the server is configured for (MAP_PROVIDER). */
export async function loadMapProvider(): Promise<MapProvider> {
  const config = await mapConfig();
  const create = await providers[config.provider]();
  return create(config);
}
