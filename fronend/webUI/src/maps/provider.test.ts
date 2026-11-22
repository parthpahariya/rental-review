import { describe, expect, it, vi } from "vitest";
import type { MapProviderName } from "./types";

const config = vi.hoisted(() => ({
  provider: "google" as MapProviderName,
  api_key: "test-key" as string | null,
}));
vi.mock("./config", () => ({
  mapConfig: () =>
    Promise.resolve({
      provider: config.provider,
      api_key: config.api_key,
      map_id: null,
    }),
}));

import { loadMapProvider } from "./provider";

describe("loadMapProvider", () => {
  it.each<[MapProviderName, RegExp]>([
    ["google", /Google/],
    ["here", /HERE/],
    ["mapbox", /Mapbox/],
    ["ola", /Ola Maps/],
    ["osm", /OpenStreetMap/],
  ])(
    "loads %s, which implements the same contract",
    async (name, attribution) => {
      config.provider = name;
      config.api_key = name === "osm" ? null : "test-key";
      const provider = await loadMapProvider();
      expect(provider.name).toBe(name);
      expect(provider.searchAttribution).toMatch(attribution);
      expect(typeof provider.Map).toBe("function");
      const search = provider.createSearch();
      expect(typeof search.search).toBe("function");
      expect(typeof search.finish).toBe("function");
    },
  );
});
