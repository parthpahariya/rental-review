import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { setToken } from "./api";
import { scrollToListEnd } from "./test-setup";

const mapView: { current: unknown } = { current: null };
/** Stands in for Google Places; tests set what each call returns. */
const googlePlaces = vi.hoisted(() => ({
  autocomplete: vi.fn(),
  tokens: 0,
}));
/** Which map provider the server reports; tests switch it per case. */
const mapProvider = vi.hoisted(() => ({ current: "google" as "google" | "osm" }));
vi.mock("./maps/config", () => ({
  mapConfig: () =>
    Promise.resolve({
      provider: mapProvider.current,
      api_key: mapProvider.current === "google" ? "test-key" : null,
      map_id: null,
    }),
}));
vi.mock("./maps/google/loader", () => ({
  loadGoogleMaps: () =>
    Promise.resolve({
      mapId: "test-map",
      places: {
        AutocompleteSessionToken: class {
          id = ++googlePlaces.tokens;
        },
        AutocompleteSuggestion: {
          fetchAutocompleteSuggestions: (request: unknown) =>
            googlePlaces.autocomplete(request),
        },
      },
    }),
}));

type FakePlace = {
  name: string;
  lat: number;
  lng: number;
  types: string[];
  /** [west, south, east, north] */
  viewport?: [number, number, number, number];
};
const latLng = (lat: number, lng: number) => ({
  lat: () => lat,
  lng: () => lng,
});
function fakePlace(p: FakePlace) {
  const [west, south, east, north] = p.viewport ?? [];
  return {
    displayName: p.name,
    types: p.types,
    location: latLng(p.lat, p.lng),
    viewport: p.viewport && {
      getSouthWest: () => latLng(south!, west!),
      getNorthEast: () => latLng(north!, east!),
    },
    fetchFields: vi.fn(() => Promise.resolve({})),
  };
}
function suggestion(p: FakePlace, secondary: string) {
  const place = fakePlace(p);
  return {
    placePrediction: {
      mainText: { text: p.name },
      secondaryText: { text: secondary },
      text: { text: `${p.name}, ${secondary}` },
      types: p.types,
      placeId: `place-${p.name}`,
      toPlace: () => place,
    },
    place,
  };
}
const indiranagar = suggestion(
  {
    name: "Indiranagar",
    lat: 12.9784,
    lng: 77.6408,
    types: ["sublocality_level_1", "sublocality", "political"],
    viewport: [77.62, 12.96, 77.66, 12.99],
  },
  "Bengaluru, Karnataka, India",
);
const prestige = suggestion(
  {
    name: "Prestige Shantiniketan",
    lat: 12.9886,
    lng: 77.7287,
    types: ["premise", "establishment"],
  },
  "Whitefield, Bengaluru, Karnataka, India",
);
vi.mock("./Map", async () => {
  const { useEffect } = await import("react");
  return {
    default: ({
      onViewChange,
      onPick,
      searched,
    }: {
      onViewChange?: (v: unknown) => void;
      onPick?: (p: { latitude: number; longitude: number }) => void;
      searched?: { latitude: number; longitude: number } | null;
    }) => {
      useEffect(() => {
        if (mapView.current) onViewChange?.(mapView.current);
      }, [onViewChange]);
      return (
        <div aria-label="Interactive rental location map">
          {/* Stands in for tapping an empty spot on the real map. */}
          <button
            onClick={() => onPick?.({ latitude: 12.955, longitude: 77.63 })}
          >
            Tap the map here
          </button>
          {searched && (
            <span>
              Searched place at {searched.latitude},{searched.longitude}
            </span>
          )}
        </div>
      );
    },
  };
});

const location = {
  id: "location-1",
  building_name: "Parkside Residences",
  address: "Indiranagar, Bengaluru",
  latitude: 12,
  longitude: 77,
  summary: {
    average_rating: 5,
    tenant_review_count: 1,
    interaction_review_count: 1,
  },
};
const flat = {
  id: "flat-1",
  label: "A-204",
  location,
  summary: location.summary,
};
const review = {
  id: "review-1",
  flat_id: flat.id,
  owner_name: "Anita Rao",
  rating: 5,
  feedback: "A helpful owner.",
  tenancy_start_date: "2024-01-01",
  tenancy_end_date: "2025-01-01",
  submitted_at: "2025-02-01T00:00:00Z",
  editing_deadline: "2025-03-03T00:00:00Z",
};
const interaction = {
  id: "interaction-1",
  flat_id: flat.id,
  owner_name: "A different owner",
  description: "A transparent viewing.",
  interaction_date: "2025-02-01",
  submitted_at: "2025-02-02T00:00:00Z",
};

function result(data: unknown, list = true) {
  return new Response(
    JSON.stringify(list ? { data, page: { next_cursor: null } } : { data }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

beforeEach(() => {
  mapProvider.current = "google";
  googlePlaces.autocomplete.mockReset();
  googlePlaces.autocomplete.mockResolvedValue({ suggestions: [] });
  // Every test starts at the home page with a clean address bar and no
  // remembered preferences (such as a hidden results list).
  window.history.replaceState(null, "", "/");
  localStorage.clear();
  setToken(null);
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      if (input.includes("/auth/providers"))
        return Promise.resolve(result({ google_client_id: null }, false));
      if (input.endsWith("/locations/location-1"))
        return Promise.resolve(result(location, false));
      if (input.includes("/locations/location-1/flats"))
        return Promise.resolve(result([flat]));
      if (input.includes("/locations"))
        return Promise.resolve(
          result(input.includes("q=Unknown") ? [] : [location]),
        );
      if (input.includes("/flats/flat-1/tenant-reviews"))
        return Promise.resolve(result([review]));
      if (input.includes("/flats/flat-1/interactions"))
        return Promise.resolve(result([interaction]));
      throw new Error(`Unexpected request: ${input}`);
    }),
  );
});
afterEach(() => {
  mapView.current = null;
  window.history.replaceState(null, "", "/");
  cleanup();
  vi.unstubAllGlobals();
});

async function browse(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("button", { name: /Browse places on the map/ }),
  );
}

describe("Rental Review", () => {
  it("keeps the selected flat while switching accessible feedback tabs", async () => {
    const user = userEvent.setup();
    render(<App />);
    await browse(user);
    await user.click(
      await screen.findByRole("button", { name: /Parkside Residences/ }),
    );
    expect(await screen.findByText("A helpful owner.")).toBeInTheDocument();
    await user.keyboard("{Tab}");
    await user.click(screen.getByRole("tab", { name: /Tenant Reviews/ }));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: /Interactions/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("A transparent viewing.")).toBeInTheDocument();
    expect(screen.getByText("A different owner")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /Select a flat/ })).toHaveValue(
      "flat-1",
    );
  });

  it("asks for a locality before showing the map", async () => {
    googlePlaces.autocomplete.mockResolvedValue({
      suggestions: [indiranagar, prestige],
    });
    const user = userEvent.setup();
    render(<App />);
    expect(
      screen.queryByLabelText(/Interactive rental location map/),
    ).not.toBeInTheDocument();
    await user.type(
      screen.getByRole("combobox", { name: /Search for a locality/ }),
      "Indira",
    );
    const option = await screen.findByRole("option", { name: /^Indiranagar/ });
    expect(screen.getByText("Powered by Google")).toBeInTheDocument();
    const request = googlePlaces.autocomplete.mock.calls.at(-1)![0];
    expect(request).toMatchObject({
      input: "Indira",
      includedRegionCodes: ["in"],
      // Biased towards Bengaluru (no location shared in the test).
      locationBias: { center: { lat: 12.955, lng: 77.63 }, radius: 50000 },
    });
    await user.click(option);
    expect(
      await screen.findByLabelText(/Interactive rental location map/),
    ).toBeInTheDocument();
    // The chosen area shows in the topbar, next to the profile.
    expect(
      screen.getByRole("button", { name: "Area: Indiranagar. Change area" }),
    ).toHaveTextContent("Indiranagar");
    expect(indiranagar.place.fetchFields).toHaveBeenCalled();
    // An area is fitted on screen, not marked with a pin.
    expect(screen.queryByText(/Searched place/)).not.toBeInTheDocument();
  });

  it("finds buildings and keeps one search session until a pick", async () => {
    googlePlaces.autocomplete.mockResolvedValue({
      suggestions: [prestige],
    });
    const user = userEvent.setup();
    render(<App />);
    const box = screen.getByRole("combobox", { name: /Search for a locality/ });
    await user.type(box, "Pres");
    await screen.findByRole("option", { name: /^Prestige Shantiniketan/ });
    await user.type(box, "tige");
    await waitFor(() =>
      expect(googlePlaces.autocomplete).toHaveBeenCalledTimes(2),
    );
    const [first, second] = googlePlaces.autocomplete.mock.calls.map(
      ([r]) => r.sessionToken,
    );
    // Keystrokes in one search share a token, so Google bills one session.
    expect(second).toBe(first);
    await user.click(
      await screen.findByRole("option", { name: /^Prestige Shantiniketan/ }),
    );
    expect(
      await screen.findByRole("button", {
        name: "Area: Prestige Shantiniketan. Change area",
      }),
    ).toBeInTheDocument();
    expect(prestige.place.fetchFields).toHaveBeenCalled();
    // The map marks the building the visitor picked.
    expect(
      screen.getByText("Searched place at 12.9886,77.7287"),
    ).toBeInTheDocument();
    // A new search after the pick starts a new session.
    await user.type(
      screen.getByRole("combobox", { name: /Search for a locality/ }),
      "Indira",
    );
    await waitFor(() =>
      expect(googlePlaces.autocomplete).toHaveBeenCalledTimes(3),
    );
    expect(googlePlaces.autocomplete.mock.calls[2][0].sessionToken).not.toBe(
      first,
    );
  });

  it("searches OpenStreetMap when the server picks it", async () => {
    mapProvider.current = "osm";
    const photon = {
      features: [
        {
          geometry: { coordinates: [77.6404672, 12.9732913] },
          properties: { name: "Indiranagar", type: "locality" },
        },
        {
          geometry: { coordinates: [77.6443636, 12.9810684] },
          properties: { name: "Indiranagar", type: "district" },
        },
        {
          // An apartment complex, mapped as named residential land.
          geometry: { coordinates: [77.5927, 12.8733] },
          properties: {
            name: "Indira Elysian",
            type: "locality",
            osm_key: "landuse",
            osm_value: "residential",
            extent: [77.5911502, 12.8738344, 77.5942017, 12.8728041],
          },
        },
        {
          geometry: { coordinates: [79.9, 6.9] },
          properties: {
            name: "Indira Lane",
            type: "locality",
            countrycode: "LK",
          },
        },
      ],
    };
    const base = fetch as unknown as (input: string) => Promise<Response>;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) =>
        input.startsWith("https://photon.komoot.io/")
          ? Promise.resolve(new Response(JSON.stringify(photon)))
          : base(input),
      ),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.type(
      screen.getByRole("combobox", { name: /Search for a locality/ }),
      "Indira",
    );
    const localities = await screen.findAllByRole("option", {
      name: /^Indiranagar/,
    });
    // The same locality listed twice by OpenStreetMap is shown once.
    expect(localities).toHaveLength(1);
    // Results outside India are dropped.
    expect(
      screen.queryByRole("option", { name: /Indira Lane/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Search © OpenStreetMap contributors"),
    ).toBeInTheDocument();
    expect(googlePlaces.autocomplete).not.toHaveBeenCalled();
    const geocode = vi
      .mocked(fetch)
      .mock.calls.map(([url]) => String(url))
      .find((url) => url.startsWith("https://photon.komoot.io/api/"));
    expect(geocode).toContain("q=Indira");
    expect(geocode).toContain("bbox=68.1%2C6.5%2C97.5%2C35.7");
    expect(geocode).toContain("lat=12.9550");
    await user.click(localities[0]);
    expect(
      await screen.findByRole("button", {
        name: "Area: Indiranagar. Change area",
      }),
    ).toBeInTheDocument();
    // A neighbourhood is fitted on screen without a pin…
    expect(screen.queryByText(/Searched place/)).not.toBeInTheDocument();
    // …but an apartment complex is centred and marked.
    const box = screen.getAllByRole("combobox", {
      name: /Search for a locality/,
    })[0];
    await user.clear(box);
    await user.type(box, "Indira Ely");
    await user.click(
      await screen.findByRole("option", { name: /^Indira Elysian/ }),
    );
    expect(
      // The middle of the complex's footprint.
      await screen.findByText(/^Searched place at 12\.8733\d*,77\.5926\d*$/),
    ).toBeInTheDocument();
  });

  it("asks Google nothing until the visitor types", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      screen.getByRole("combobox", { name: /Search for a locality/ }),
    );
    await user.keyboard("Ind");
    // Three letters are not enough to search, and the empty box lists nothing.
    await new Promise((r) => setTimeout(r, 500));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(googlePlaces.autocomplete).not.toHaveBeenCalled();
  });

  it("lets the visitor hide the results list and bring it back", async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    await browse(user);
    await screen.findByRole("button", { name: /Parkside Residences/ });
    await user.click(screen.getByRole("button", { name: "Hide list" }));
    expect(
      screen.queryByRole("button", { name: /Parkside Residences/ }),
    ).not.toBeInTheDocument();
    const show = screen.getByRole("button", { name: /Show list · 1 place/ });
    // The choice is remembered: a fresh visit keeps the list hidden.
    first.unmount();
    render(<App />);
    expect(
      await screen.findByRole("button", { name: /Show list/ }),
    ).toBeInTheDocument();
    expect(show).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Show list/ }));
    expect(
      await screen.findByRole("button", { name: /Parkside Residences/ }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Show list/ }),
    ).not.toBeInTheDocument();
  });

  it("lists buildings already on Rental Review first, without Google", async () => {
    googlePlaces.autocomplete.mockResolvedValue({ suggestions: [prestige] });
    const user = userEvent.setup();
    render(<App />);
    await user.type(
      screen.getByRole("combobox", { name: /Search for a locality/ }),
      "Parkside",
    );
    const listed = await screen.findByRole("option", {
      name: /^Parkside Residences.*On Rental Review/,
    });
    // Too few listed matches, so Google fills in below them.
    expect(
      await screen.findByRole("option", { name: /^Prestige Shantiniketan/ }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("option")[0]).toBe(listed);
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(urls.some((u) => u.includes("q=Parkside"))).toBe(true);
    await user.click(listed);
    expect(
      await screen.findByRole("button", {
        name: "Area: Parkside Residences. Change area",
      }),
    ).toBeInTheDocument();
    // Picking a listed building needs no paid Google lookup.
    expect(prestige.place.fetchFields).not.toHaveBeenCalled();
  });

  it("skips Google when enough listed buildings match", async () => {
    const towers = ["North", "South", "East"].map((side, i) => ({
      ...location,
      id: `tower-${i}`,
      building_name: `${side} Tower`,
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) =>
        Promise.resolve(
          result(input.includes("q=Tower") ? towers : []),
        ),
      ),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.type(
      screen.getByRole("combobox", { name: /Search for a locality/ }),
      "Tower",
    );
    expect(
      await screen.findAllByRole("option", { name: /Tower.*On Rental Review/ }),
    ).toHaveLength(3);
    expect(googlePlaces.autocomplete).not.toHaveBeenCalled();
    expect(screen.queryByText("Powered by Google")).not.toBeInTheDocument();
  });

  it("says when nothing matches and when suggestions fail", async () => {
    const user = userEvent.setup();
    render(<App />);
    const box = screen.getByRole("combobox", { name: /Search for a locality/ });
    await user.type(box, "Unknown");
    expect(
      await screen.findByText(/No places in India match “Unknown”/),
    ).toBeInTheDocument();
    googlePlaces.autocomplete.mockRejectedValue(new Error("quota"));
    await user.type(box, "x");
    expect(
      await screen.findByText("Place suggestions are unavailable right now."),
    ).toBeInTheDocument();
  });

  it("explains when Google sign-in is not configured and offers no phone login", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      await screen.findByText(/Google sign-in isn’t available right now/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Mobile number")).not.toBeInTheDocument();
  });

  it("signs in with Google when the server has a client id", async () => {
    const initialize = vi.fn();
    // Stands in for Google's script: renders a button that returns a credential.
    vi.stubGlobal("google", {
      accounts: {
        id: {
          initialize,
          renderButton: (el: HTMLElement) => {
            const button = document.createElement("button");
            button.textContent = "Continue with Google";
            button.type = "button";
            button.onclick = () =>
              initialize.mock.calls[0][0].callback({
                credential: "google-jwt",
              });
            el.appendChild(button);
          },
        },
      },
    });
    const base = fetch as unknown as (
      input: string,
      init?: RequestInit,
    ) => Promise<Response>;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string, init?: RequestInit) => {
        if (input.includes("/auth/providers"))
          return Promise.resolve(
            result(
              { google_client_id: "client.apps.googleusercontent.com" },
              false,
            ),
          );
        if (input.includes("/auth/google"))
          return Promise.resolve(
            result(
              {
                outcome: "registered",
                account: {
                  id: "me",
                  email: "tenant@example.com",
                  role: "user",
                },
                session: { token: "google-session" },
              },
              false,
            ),
          );
        return base(input, init);
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await user.click(
      await screen.findByRole("button", { name: "Continue with Google" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Your account" }),
      ).toBeInTheDocument(),
    );
    expect(initialize.mock.calls[0][0].client_id).toBe(
      "client.apps.googleusercontent.com",
    );
    const call = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => String(url).includes("/auth/google"));
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      credential: "google-jwt",
      reactivate: false,
    });
    expect(sessionStorage.getItem("rental-session")).toBe("google-session");
    vi.unstubAllGlobals();
  });

  it("adds a new place from the map and opens the review form for it", async () => {
    const newLocation = {
      id: "location-2",
      building_name: "Fresh Pin House",
      address: "12 New Road, Bengaluru",
      latitude: 12.955,
      longitude: 77.63,
      summary: {
        average_rating: null,
        tenant_review_count: 0,
        interaction_review_count: 0,
      },
    };
    const newFlat = {
      id: "flat-2",
      label: "7C",
      location: newLocation,
      summary: newLocation.summary,
    };
    const base = fetch as unknown as (input: string) => Promise<Response>;
    const calls: { url: string; body?: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string, init?: RequestInit) => {
        calls.push({
          url: input,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        if (input.endsWith("/me"))
          return Promise.resolve(
            result(
              { id: "me", email: "tenant@example.com", role: "user" },
              false,
            ),
          );
        if (init?.method === "POST" && input.endsWith("/locations"))
          return Promise.resolve(result(newFlat, false));
        if (input.includes("/locations/location-2/permissions"))
          return Promise.resolve(
            result(
              { can_edit_location: true, editable_flat_ids: ["flat-2"] },
              false,
            ),
          );
        if (input.includes("/locations/location-2/flats"))
          return Promise.resolve(result([newFlat]));
        if (input.includes("/flats/flat-2/"))
          return Promise.resolve(result([]));
        if (input.includes("/review-submission-policy"))
          return Promise.resolve(result({ proof_required: false }, false));
        return base(input);
      }),
    );
    setToken("test-session");
    const user = userEvent.setup();
    render(<App />);
    await browse(user);
    await screen.findByRole("button", { name: /Parkside Residences/ });
    // No "Add a place" button in the panel: places are added by tapping the map.
    expect(
      screen.queryByRole("button", { name: /Add a place/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tap the map here" }));
    await user.click(screen.getByRole("button", { name: /Continue/ }));
    await user.type(screen.getByLabelText(/Building name/), "Fresh Pin House");
    await user.type(screen.getByLabelText("Address"), "12 New Road, Bengaluru");
    await user.type(screen.getByLabelText(/^Flat/), "7C");
    await user.click(
      screen.getByRole("button", { name: /Add place and write a review/ }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Share your rental experience",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Fresh Pin House · Flat 7C")).toBeInTheDocument();
    const created = calls.find((c) => c.url.endsWith("/locations") && c.body);
    expect(created?.body).toEqual({
      address: "12 New Road, Bengaluru",
      building_name: "Fresh Pin House",
      flat_label: "7C",
      latitude: 12.955,
      longitude: 77.63,
    });
  });

  it("lets the person who added a place edit it", async () => {
    const mine = { ...location, id: "location-9", building_name: "Typo Hsue" };
    const myFlat = { ...flat, id: "flat-9", label: "2O2", location: mine };
    const base = fetch as unknown as (input: string) => Promise<Response>;
    const calls: { url: string; method?: string; body?: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string, init?: RequestInit) => {
        calls.push({
          url: input,
          method: init?.method,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        if (input.endsWith("/me"))
          return Promise.resolve(
            result({ id: "me", email: "me@example.com", role: "user" }, false),
          );
        if (input.includes("/locations/location-9/permissions"))
          return Promise.resolve(
            result(
              { can_edit_location: true, editable_flat_ids: ["flat-9"] },
              false,
            ),
          );
        if (init?.method === "PATCH" && input.endsWith("/locations/location-9"))
          return Promise.resolve(
            result({ ...mine, building_name: "Tidy House" }, false),
          );
        if (init?.method === "PATCH" && input.endsWith("/flats/flat-9"))
          return Promise.resolve(result({ ...myFlat, label: "202" }, false));
        if (input.includes("/locations/location-9/flats"))
          return Promise.resolve(result([myFlat]));
        if (input.includes("/flats/flat-9/"))
          return Promise.resolve(result([]));
        if (input.includes("/locations?"))
          return Promise.resolve(result([mine]));
        return base(input);
      }),
    );
    setToken("test-session");
    const user = userEvent.setup();
    render(<App />);
    await browse(user);
    await user.click(await screen.findByRole("button", { name: /Typo Hsue/ }));
    await user.click(
      await screen.findByRole("button", { name: /Edit what you added/ }),
    );
    const name = screen.getByLabelText(/Building name/);
    await user.clear(name);
    await user.type(name, "Tidy House");
    const label = screen.getByLabelText(/^Flat/);
    await user.clear(label);
    await user.type(label, "202");
    await user.click(screen.getByRole("button", { name: /Save changes/ }));
    expect(
      await screen.findByRole("heading", { name: "Tidy House" }),
    ).toBeInTheDocument();
    const edits = calls.filter((c) => c.method === "PATCH");
    // Only what changed is sent.
    expect(edits.map((c) => [c.url, c.body])).toEqual([
      ["/api/v1/locations/location-9", { building_name: "Tidy House" }],
      ["/api/v1/flats/flat-9", { label: "202" }],
    ]);
  });

  it("offers Edit on the signed-in user's own reviews only", async () => {
    const base = fetch as unknown as (
      input: string,
      init?: RequestInit,
    ) => Promise<Response>;
    const calls: { url: string; method?: string; body?: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string, init?: RequestInit) => {
        calls.push({
          url: input,
          method: init?.method,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        if (input.endsWith("/me"))
          return Promise.resolve(
            result({ id: "me", email: "me@example.com", role: "user" }, false),
          );
        if (input.includes("/permissions"))
          return Promise.resolve(
            result({ can_edit_location: false, editable_flat_ids: [] }, false),
          );
        if (input.includes("/me/tenant-reviews?flat_id=flat-1"))
          return Promise.resolve(result([{ ...review, can_edit: true }]));
        if (init?.method === "PATCH")
          return Promise.resolve(result({ ...review, rating: 2 }, false));
        return base(input, init);
      }),
    );
    setToken("test-session");
    const user = userEvent.setup();
    render(<App />);
    await browse(user);
    await user.click(
      await screen.findByRole("button", { name: /Parkside Residences/ }),
    );
    expect(await screen.findByText(/Your review/)).toBeInTheDocument();
    await user.click(
      await screen.findByRole("button", { name: /Edit your review/ }),
    );
    expect(
      await screen.findByRole("heading", { name: /Edit/ }),
    ).toBeInTheDocument();
  });

  it("notebook shows where each review is and opens it on the map", async () => {
    const place = {
      building_name: "Parkside Residences",
      address: location.address,
      flat_label: flat.label,
    };
    const base = fetch as unknown as (
      input: string,
      init?: RequestInit,
    ) => Promise<Response>;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string, init?: RequestInit) => {
        if (input.endsWith("/me"))
          return Promise.resolve(
            result(
              {
                id: "me",
                name: "Asha Rao",
                email: "me@example.com",
                role: "user",
              },
              false,
            ),
          );
        if (input.includes("/me/tenant-reviews"))
          return Promise.resolve(
            result([
              { ...review, location_id: "location-1", place, can_edit: true },
            ]),
          );
        if (input.includes("/me/flats"))
          return Promise.resolve(
            result([{ ...flat, added_place: true, can_edit: true }]),
          );
        if (
          input.includes("/me/interactions") ||
          input.includes("/me/deletion")
        )
          return Promise.resolve(result([]));
        if (input.includes("/permissions"))
          return Promise.resolve(
            result({ can_edit_location: false, editable_flat_ids: [] }, false),
          );
        return base(input, init);
      }),
    );
    setToken("test-session");
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: "Your account" }),
    );
    expect(await screen.findByText("Places you added")).toBeInTheDocument();
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByText("me@example.com")).toBeInTheDocument();
    expect(screen.getByText("You added this building")).toBeInTheDocument();
    const links = await screen.findAllByRole("button", {
      name: /Parkside Residences · Flat A-204/,
    });
    // One under "Places you added", one on the review.
    expect(links).toHaveLength(2);
    await user.click(links[1]);
    expect(
      await screen.findByRole("heading", { name: "Parkside Residences" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("A helpful owner.")).toBeInTheDocument();
    expect(screen.queryByText("Your rental notebook")).not.toBeInTheDocument();
  });

  it("lets the user edit their name in the notebook", async () => {
    const base = fetch as unknown as (
      input: string,
      init?: RequestInit,
    ) => Promise<Response>;
    const patches: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string, init?: RequestInit) => {
        if (init?.method === "PATCH" && input.endsWith("/me")) {
          const body = JSON.parse(String(init.body));
          patches.push(body);
          return Promise.resolve(
            result(
              {
                id: "me",
                name: body.name,
                name_is_custom: body.name !== null,
                email: "me@example.com",
                role: "user",
              },
              false,
            ),
          );
        }
        if (input.endsWith("/me"))
          return Promise.resolve(
            result(
              {
                id: "me",
                name: "Asha Rao",
                email: "me@example.com",
                role: "user",
              },
              false,
            ),
          );
        if (input.includes("/me/")) return Promise.resolve(result([]));
        return base(input, init);
      }),
    );
    setToken("test-session");
    const user = userEvent.setup();
    render(<App />);
    // The name's first letter wins over the email's ("A", not "M").
    expect(
      await screen.findByRole("button", { name: "Your account" }),
    ).toHaveTextContent(/^A$/);
    await user.click(
      await screen.findByRole("button", { name: "Your account" }),
    );
    await user.click(await screen.findByRole("button", { name: /Edit name/ }));
    const input = screen.getByLabelText("Your name");
    await user.clear(input);
    await user.type(input, "  Asha  ");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Asha")).toBeInTheDocument();
    expect(patches).toEqual([{ name: "Asha" }]);
    // Going back to the Google name sends null.
    await user.click(screen.getByRole("button", { name: /Edit name/ }));
    await user.click(
      screen.getByRole("button", { name: "Use my Google name" }),
    );
    await waitFor(() =>
      expect(patches).toEqual([{ name: "Asha" }, { name: null }]),
    );
  });

  it("shows no edit button on places added by someone else", async () => {
    const base = fetch as unknown as (input: string) => Promise<Response>;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) => {
        if (input.endsWith("/me"))
          return Promise.resolve(
            result({ id: "me", email: "me@example.com", role: "user" }, false),
          );
        if (input.includes("/permissions"))
          return Promise.resolve(
            result({ can_edit_location: false, editable_flat_ids: [] }, false),
          );
        return base(input);
      }),
    );
    setToken("test-session");
    const user = userEvent.setup();
    render(<App />);
    await browse(user);
    await user.click(
      await screen.findByRole("button", { name: /Parkside Residences/ }),
    );
    expect(await screen.findByText("A helpful owner.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Edit what you added/ }),
    ).not.toBeInTheDocument();
  });

  it("keeps the map spot and open place in the address bar across a refresh", async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    await browse(user);
    await user.click(
      await screen.findByRole("button", { name: /Parkside Residences/ }),
    );
    expect(await screen.findByText("A helpful owner.")).toBeInTheDocument();
    await waitFor(() =>
      expect(window.location.search).toContain("place=location-1"),
    );
    const saved = new URLSearchParams(window.location.search);
    expect(saved.get("at")).toMatch(/^-?\d+\.\d{5},-?\d+\.\d{5},\d+$/);
    expect(saved.get("flat")).toBe("flat-1");
    first.unmount();

    // A fresh load of the same URL opens the map, the place and its flat.
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: "Parkside Residences" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("A helpful owner.")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /Rent with your eyes open/i }),
    ).not.toBeInTheDocument();
  });

  it("ignores a malformed address bar and shows the home page", async () => {
    window.history.replaceState(null, "", "/?at=999,abc,5&place=../../x");
    render(<App />);
    expect(
      await screen.findByRole("button", { name: /Browse places on the map/ }),
    ).toBeInTheDocument();
  });

  it("lists only the places inside the visible map area", async () => {
    mapView.current = {
      center: { latitude: 20, longitude: 80 },
      bounds: { west: 79, south: 19, east: 81, north: 21 },
    };
    const user = userEvent.setup();
    render(<App />);
    await browse(user);
    expect(
      await screen.findByText("No places in this area"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Parkside Residences/ }),
    ).not.toBeInTheDocument();
    cleanup();
    // A fresh visit, not a refresh: start from the home page again.
    window.history.replaceState(null, "", "/");
    mapView.current = {
      center: { latitude: 12, longitude: 77 },
      bounds: { west: 76.9, south: 11.9, east: 77.1, north: 12.1 },
    };
    render(<App />);
    await browse(user);
    await screen.findByRole("button", { name: /Parkside Residences/ });
    expect(screen.getByText(/1 place in this area/)).toBeInTheDocument();
  });

  it("pages a crowded area 20 at a time and sorts it", async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      ...location,
      id: `dense-${i}`,
      building_name: `Tower ${i}`,
      latitude: 12 + i * 0.0001,
      summary: {
        average_rating: i === 7 ? 5 : 3,
        tenant_review_count: i === 3 ? 9 : 1,
        interaction_review_count: 0,
      },
    }));
    mapView.current = {
      center: { latitude: 12, longitude: 77 },
      bounds: { west: 76.9, south: 11.9, east: 77.1, north: 12.1 },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) => Promise.resolve(result(many))),
    );
    const user = userEvent.setup();
    render(<App />);
    await browse(user);
    const cards = () => screen.getAllByRole("button", { name: /Tower \d+/ });
    await screen.findByRole("button", { name: /Tower 0\b/ });
    expect(cards()).toHaveLength(20);
    expect(cards()[0]).toHaveAccessibleName(/Tower 0\b/);
    // No button: scrolling to the end of the list loads the rest.
    expect(
      screen.queryByRole("button", { name: /more/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Loading more places…")).toBeInTheDocument();
    act(() => scrollToListEnd());
    expect(cards()).toHaveLength(25);
    // Everything is listed, so the end marker goes away.
    expect(screen.queryByText("Loading more places…")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Sort by"), "rating");
    expect(cards()[0]).toHaveAccessibleName(/Tower 7\b/);
    expect(cards()).toHaveLength(20);
    await user.selectOptions(screen.getByLabelText("Sort by"), "reviews");
    expect(cards()[0]).toHaveAccessibleName(/Tower 3\b/);
  });

  it("shows How it works only on the home page and a profile icon when signed in", async () => {
    const base = fetch as unknown as (
      input: string,
      init?: RequestInit,
    ) => Promise<Response>;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string, init?: RequestInit) =>
        input.endsWith("/me")
          ? Promise.resolve(
              result(
                { id: "me", email: "me@example.com", role: "user" },
                false,
              ),
            )
          : base(input, init),
      ),
    );
    setToken("test-session");
    const user = userEvent.setup();
    render(<App />);
    const profile = await screen.findByRole("button", { name: "Your account" });
    // Shows the first letter of the name, or of the email when there is no
    // name; the accessible name stays "Your account".
    expect(profile).toHaveTextContent(/^M$/);
    expect(
      screen.getByRole("button", { name: "How it works" }),
    ).toBeInTheDocument();
    await browse(user);
    await screen.findByRole("button", { name: /Parkside Residences/ });
    expect(
      screen.queryByRole("button", { name: "How it works" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Your account" }),
    ).toBeInTheDocument();
  });

  it("home page has no statistics or top-rated list and loads no place data", async () => {
    render(<App />);
    expect(
      await screen.findByText(/Buildings across India, rated by the people/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /Top-rated/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: /in numbers/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/rated buildings/)).not.toBeInTheDocument();
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(urls.some((u) => u.includes("/stats"))).toBe(false);
    expect(urls.some((u) => u.includes("/locations"))).toBe(false);
  });

  it("loads only the visible map area and caps dense views", async () => {
    mapView.current = {
      center: { latitude: 12, longitude: 77 },
      bounds: { west: 76.9, south: 11.9, east: 77.1, north: 12.1 },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) => {
        const page = Array.from({ length: 100 }, (_, i) => ({
          ...location,
          id: `${input.length}-${Math.random()}-${i}`,
        }));
        return Promise.resolve(
          new Response(
            JSON.stringify({ data: page, page: { next_cursor: "next" } }),
          ),
        );
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await browse(user);
    expect(
      await screen.findByText(/500 places\+ in this area/),
    ).toBeInTheDocument();
    // The "+" in the count is the only sign of the cap; no extra message.
    expect(
      screen.queryByText(/Zoom in to see every building/),
    ).not.toBeInTheDocument();
    const pages = vi
      .mocked(fetch)
      .mock.calls.map(([url]) => String(url))
      .filter((u) => u.includes("/locations?"));
    expect(pages).toHaveLength(5);
    expect(pages[0]).toContain("bbox=76.90000,11.90000,77.10000,12.10000");
  });

  it("shows a recovery action when public location retrieval fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: "SERVICE_UNAVAILABLE",
                message: "Database unavailable.",
              },
            }),
            { status: 503 },
          ),
        ),
      ),
    );
    const user = userEvent.setup();
    render(<App />);
    await browse(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Database unavailable.",
    );
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });
});
