/**
 * Mapbox: Static Tiles API (raster tiles of a Mapbox style) drawn by the
 * Leaflet engine, with the Mapbox Search Box API for search. Needs a public
 * access token (pk.…) as MAPBOX_ACCESS_TOKEN on the server.
 */
import { leafletMap, rasterTiles } from "../leaflet/LeafletMap";
import { MAX_ZOOM } from "../shared";
import type { CreateMapProvider } from "../types";
import { createMapboxSearch } from "./search";

export const createMapboxProvider: CreateMapProvider = (config) => {
  const token = encodeURIComponent(config.api_key ?? "");
  return {
    name: "mapbox",
    Map: leafletMap(
      rasterTiles(
        `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}?access_token=${token}`,
        {
          // Mapbox serves 512 px tiles; this keeps zoom levels in step.
          tileSize: 512,
          zoomOffset: -1,
          maxZoom: MAX_ZOOM,
          attribution:
            '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> <a href="https://www.mapbox.com/map-feedback/">Improve this map</a>',
        },
      ),
    ),
    createSearch: () => createMapboxSearch(config.api_key ?? ""),
    searchAttribution: "Search by Mapbox",
  };
};
