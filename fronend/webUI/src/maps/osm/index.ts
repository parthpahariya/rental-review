import type { MapProvider } from "../types";
import LeafletMap from "./LeafletMap";
import { createOsmSearch } from "./search";

/** Leaflet on OpenStreetMap tiles with Photon search. Free, no key needed. */
export const osmProvider: MapProvider = {
  name: "osm",
  Map: LeafletMap,
  createSearch: createOsmSearch,
  searchAttribution: "Search © OpenStreetMap contributors",
};
