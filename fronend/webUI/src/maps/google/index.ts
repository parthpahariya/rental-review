import type { MapProvider } from "../types";
import GoogleMap from "./GoogleMap";
import { createGoogleSearch } from "./search";

/** Google Maps JavaScript API map with Google Places search. Needs a key. */
export const googleProvider: MapProvider = {
  name: "google",
  Map: GoogleMap,
  createSearch: createGoogleSearch,
  searchAttribution: "Powered by Google",
};
