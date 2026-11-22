/**
 * HERE: Raster Tile API v3 drawn by the Leaflet engine, with HERE Autosuggest
 * for search. Needs HERE_API_KEY on the server.
 */
import { leafletMap, rasterTiles } from "../leaflet/LeafletMap";
import { MAX_ZOOM } from "../shared";
import type { CreateMapProvider } from "../types";
import { createHereSearch } from "./search";

export const createHereProvider: CreateMapProvider = (config) => {
  const key = encodeURIComponent(config.api_key ?? "");
  return {
    name: "here",
    Map: leafletMap(
      rasterTiles(
        `https://maps.hereapi.com/v3/base/mc/{z}/{x}/{y}/png?style=explore.day&apiKey=${key}`,
        {
          attribution: `&copy; ${new Date().getFullYear()} HERE`,
          maxZoom: MAX_ZOOM,
        },
      ),
    ),
    createSearch: () => createHereSearch(config.api_key ?? ""),
    searchAttribution: "Search powered by HERE",
  };
};
