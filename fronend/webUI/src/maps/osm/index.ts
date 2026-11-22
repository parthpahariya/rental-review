import { leafletMap, rasterTiles } from "../leaflet/LeafletMap";
import { MAX_ZOOM } from "../shared";
import type { CreateMapProvider } from "../types";
import { createOsmSearch } from "./search";

const OsmMap = leafletMap(
  rasterTiles("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: MAX_ZOOM,
  }),
);

/** Leaflet on OpenStreetMap tiles with Photon search. Free, no key needed. */
export const createOsmProvider: CreateMapProvider = () => ({
  name: "osm",
  Map: OsmMap,
  createSearch: createOsmSearch,
  searchAttribution: "Search © OpenStreetMap contributors",
});
