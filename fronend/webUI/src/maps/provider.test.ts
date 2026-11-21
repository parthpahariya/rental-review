import { describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ provider: "google" as "google" | "osm" }));
vi.mock("./config", () => ({
  mapConfig: () =>
    Promise.resolve({ provider: config.provider, api_key: null, map_id: null }),
}));

import { loadMapProvider } from "./provider";

describe("loadMapProvider", () => {
  it("loads the provider the server is configured for", async () => {
    config.provider = "google";
    const google = await loadMapProvider();
    expect(google.name).toBe("google");
    expect(google.searchAttribution).toBe("Powered by Google");
    config.provider = "osm";
    const osm = await loadMapProvider();
    expect(osm.name).toBe("osm");
    expect(osm.searchAttribution).toMatch(/OpenStreetMap/);
    // Both implement the same contract the app uses.
    for (const p of [google, osm]) {
      expect(typeof p.Map).toBe("function");
      const search = p.createSearch();
      expect(typeof search.search).toBe("function");
      expect(typeof search.finish).toBe("function");
    }
  });
});
