/** The Ola Maps search turns its API's answer into the app's suggestions. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOlaSearch, withOlaKey } from "./ola/search";

const near = { latitude: 12.955, longitude: 77.63 };

function respond(...bodies: unknown[]) {
  const fetchMock = vi.fn();
  for (const body of bodies)
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const url = (mock: ReturnType<typeof vi.fn>, call = 0) =>
  new URL(String(mock.mock.calls[call][0]));

afterEach(() => vi.unstubAllGlobals());

describe("Ola Maps search", () => {
  it("uses the location from Autocomplete, or Details when missing", async () => {
    const fetchMock = respond(
      {
        predictions: [
          {
            description: "KVR Akshaya, JP Nagar, Bengaluru",
            place_id: "ola:1",
            types: ["premise"],
            structured_formatting: {
              main_text: "KVR Akshaya",
              secondary_text: "JP Nagar, Bengaluru",
            },
            geometry: { location: { lat: 12.9046, lng: 77.5862 } },
          },
          {
            description: "Indiranagar, Bengaluru",
            place_id: "ola:2",
            types: ["sublocality"],
          },
        ],
      },
      { result: { geometry: { location: { lat: 12.9784, lng: 77.6408 } } } },
    );
    const found = await createOlaSearch("ola-key").search("KVR", near);
    const q = url(fetchMock);
    expect(q.pathname).toBe("/places/v1/autocomplete");
    expect(q.searchParams.get("api_key")).toBe("ola-key");
    expect(q.searchParams.get("location")).toBe("12.9550,77.6300");
    expect(found.map((f) => [f.name, f.kind])).toEqual([
      ["KVR Akshaya", "building"],
      ["Indiranagar, Bengaluru", "area"],
    ]);
    expect(await found[0].resolve()).toMatchObject({
      center: { latitude: 12.9046, longitude: 77.5862 },
      exact: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await found[1].resolve()).center).toEqual({
      latitude: 12.9784,
      longitude: 77.6408,
    });
    expect(url(fetchMock, 1).pathname).toBe("/places/v1/details");
  });

  it("adds the key only to Ola Maps URLs", () => {
    expect(
      withOlaKey("https://api.olamaps.io/tiles/vector/v1/style.json", "k"),
    ).toBe("https://api.olamaps.io/tiles/vector/v1/style.json?api_key=k");
    expect(withOlaKey("https://example.com/font.pbf", "k")).toBe(
      "https://example.com/font.pbf",
    );
  });
});
