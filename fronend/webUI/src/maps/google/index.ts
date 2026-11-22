import type { CreateMapProvider } from "../types";
import GoogleMap from "./GoogleMap";
import { createGoogleSearch } from "./search";

/**
 * Google Maps JavaScript API map with Google Places search. Needs a key; the
 * loader reads it (and the map ID) from the server's map settings.
 */
export const createGoogleProvider: CreateMapProvider = () => ({
  name: "google",
  Map: GoogleMap,
  createSearch: createGoogleSearch,
  searchAttribution: "Powered by Google",
});
