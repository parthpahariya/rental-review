/**
 * Ola Maps: Ola's vector map style rendered by MapLibre inside the Leaflet
 * engine, with Ola Places Autocomplete for search. Needs OLA_MAPS_API_KEY on
 * the server.
 */
import L from "leaflet";
import { setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre looks for its worker next to its own file, which the bundle moves;
// let Vite emit the worker and tell MapLibre where it is.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "@maplibre/maplibre-gl-leaflet";
import { leafletMap } from "../leaflet/LeafletMap";
import type { CreateMapProvider } from "../types";
import { createOlaSearch, withOlaKey } from "./search";

setWorkerUrl(workerUrl);

const ATTRIBUTION =
  '&copy; <a href="https://maps.olakrutrim.com">Ola Maps</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const STYLE =
  "https://api.olamaps.io/tiles/vector/v1/styles/default-light-standard/style.json";

export const createOlaProvider: CreateMapProvider = (config) => {
  const key = config.api_key ?? "";
  return {
    name: "ola",
    Map: leafletMap((onFail) => {
      const layer = L.maplibreGL({
        style: STYLE,
        // The style, its tiles, fonts and sprites all need the key.
        transformRequest: (url) => ({ url: withOlaKey(url, key) }),
      });
      // The plugin drops Leaflet's `attribution` option, so supply the credit
      // the way Leaflet's attribution control asks layers for it.
      layer.getAttribution = () => ATTRIBUTION;
      // A refused style or tile (e.g. 401 for an inactive key) leaves the
      // background blank; say so instead of showing an empty grey map.
      layer.on("add", () =>
        layer.getMaplibreMap().on("error", (e) => {
          const status = (e.error as { status?: number } | undefined)?.status;
          if (status === 401 || status === 403) onFail();
        }),
      );
      return layer;
    }),
    createSearch: () => createOlaSearch(key),
    searchAttribution: "Search by Ola Maps",
  };
};
