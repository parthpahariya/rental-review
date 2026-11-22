/** Each provider's search turns its API's answer into the app's suggestions. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHereSearch } from "./here/search";
import { createMapboxSearch } from "./mapbox/search";
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

describe("HERE search", () => {
  it("marks buildings, fits areas, and skips query suggestions", async () => {
    const fetchMock = respond({
      items: [
        {
          title: "Prestige Shantiniketan",
          resultType: "place",
          address: { label: "Whitefield, Bengaluru, India" },
          position: { lat: 12.9886, lng: 77.7287 },
        },
        {
          title: "Indiranagar",
          resultType: "locality",
          address: { label: "Indiranagar, Bengaluru, India" },
          position: { lat: 12.9784, lng: 77.6408 },
          mapView: { west: 77.62, south: 12.96, east: 77.66, north: 12.99 },
        },
        { title: "Prestige restaurants", resultType: "categoryQuery" },
      ],
    });
    const found = await createHereSearch("here-key").search("Prestige", near);
    const q = url(fetchMock);
    expect(q.origin + q.pathname).toBe(
      "https://autosuggest.search.hereapi.com/v1/autosuggest",
    );
    expect(q.searchParams.get("at")).toBe("12.9550,77.6300");
    expect(q.searchParams.get("in")).toBe("countryCode:IND");
    expect(q.searchParams.get("apiKey")).toBe("here-key");
    expect(found.map((f) => [f.name, f.kind])).toEqual([
      ["Prestige Shantiniketan", "building"],
      ["Indiranagar", "area"],
    ]);
    const building = await found[0].resolve();
    expect(building).toMatchObject({
      center: { latitude: 12.9886, longitude: 77.7287 },
      zoom: 18,
      exact: true,
    });
    expect((await found[1].resolve()).bounds).toEqual({
      west: 77.62,
      south: 12.96,
      east: 77.66,
      north: 12.99,
    });
    // HERE results carry their position, so a pick costs no extra request.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("Mapbox search", () => {
  it("suggests, then retrieves the pick in the same session", async () => {
    const fetchMock = respond(
      {
        suggestions: [
          {
            name: "Prestige Shantiniketan",
            mapbox_id: "poi.123",
            feature_type: "poi",
            place_formatted: "Whitefield, Bengaluru",
          },
          {
            name: "Indiranagar",
            mapbox_id: "nb.456",
            feature_type: "neighborhood",
          },
        ],
      },
      {
        features: [
          { geometry: { coordinates: [77.7287, 12.9886] }, properties: {} },
        ],
      },
    );
    const search = createMapboxSearch("pk.token");
    const found = await search.search("Prestige", near);
    const suggest = url(fetchMock);
    expect(suggest.pathname).toBe("/search/searchbox/v1/suggest");
    expect(suggest.searchParams.get("country")).toBe("in");
    expect(suggest.searchParams.get("proximity")).toBe("77.6300,12.9550");
    expect(found.map((f) => f.kind)).toEqual(["building", "area"]);
    const area = await found[0].resolve();
    const retrieve = url(fetchMock, 1);
    expect(retrieve.pathname).toBe("/search/searchbox/v1/retrieve/poi.123");
    // One billing session from the first keystroke to the pick.
    expect(retrieve.searchParams.get("session_token")).toBe(
      suggest.searchParams.get("session_token"),
    );
    expect(area).toMatchObject({
      center: { latitude: 12.9886, longitude: 77.7287 },
      exact: true,
    });
    search.finish();
    respond({ suggestions: [] });
    await search.search("Indira", near);
    expect(
      url(vi.mocked(fetch)).searchParams.get("session_token"),
    ).not.toBe(suggest.searchParams.get("session_token"));
  });
});

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
