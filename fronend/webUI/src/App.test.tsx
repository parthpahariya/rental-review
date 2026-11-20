import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { setToken } from "./api";

const mapView: { current: unknown } = { current: null };
vi.mock("./Map", async () => {
  const { useEffect } = await import("react");
  return {
    default: ({ onViewChange }: { onViewChange?: (v: unknown) => void }) => {
      useEffect(() => {
        if (mapView.current) onViewChange?.(mapView.current);
      }, [onViewChange]);
      return <div aria-label="Interactive rental location map" />;
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

const stats = {
  location_count: 12_345_678,
  rated_location_count: 4_560_000,
  tenant_review_count: 23_400_000,
  interaction_review_count: 98_765,
  average_rating: 4.2,
  rating_bands: [
    { stars: 5, count: 2_280_000 },
    { stars: 4, count: 1_368_000 },
    { stars: 3, count: 456_000 },
    { stars: 2, count: 228_000 },
    { stars: 1, count: 228_000 },
  ],
  top_rated: [location],
};

function result(data: unknown, list = true) {
  return new Response(
    JSON.stringify(list ? { data, page: { next_cursor: null } } : { data }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

beforeEach(() => {
  setToken(null);
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      if (input.includes("/stats"))
        return Promise.resolve(result(stats, false));
      if (input.includes("/auth/providers"))
        return Promise.resolve(result({ google_client_id: null }, false));
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
    expect(screen.getByText("Owner: A different owner")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /Select a flat/ })).toHaveValue(
      "flat-1",
    );
  });

  it("asks for a locality before showing the map", async () => {
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
    expect(
      screen.queryByLabelText(/Interactive rental location map/),
    ).not.toBeInTheDocument();
    await user.type(
      screen.getByRole("combobox", { name: /Search for a locality/ }),
      "Indira",
    );
    // Reviewed places in the locality are suggested first.
    expect(
      await screen.findByRole("option", { name: /^Parkside Residences/ }),
    ).toBeInTheDocument();
    const localities = await screen.findAllByRole("option", {
      name: /^Indiranagar/,
    });
    // The same locality listed twice by OpenStreetMap is shown once.
    expect(localities).toHaveLength(1);
    // Results outside India are dropped.
    expect(
      screen.queryByRole("option", { name: /Indira Lane/ }),
    ).not.toBeInTheDocument();
    await user.click(localities[0]);
    expect(
      screen.getByLabelText(/Interactive rental location map/),
    ).toBeInTheDocument();
    expect(document.querySelector(".area-chip strong")).toHaveTextContent(
      "Indiranagar",
    );
    const geocode = vi
      .mocked(fetch)
      .mock.calls.map(([url]) => String(url))
      .find((url) => url.includes("photon"));
    expect(geocode).toContain("q=Indira");
    expect(geocode).toContain("bbox=68.1%2C6.5%2C97.5%2C35.7");
  });

  it("jumps straight to a reviewed place matched by the locality search", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        ((base) => (input: string) =>
          input.startsWith("https://photon.komoot.io/")
            ? Promise.resolve(new Response(JSON.stringify({ features: [] })))
            : base(input))(
          fetch as unknown as (input: string) => Promise<Response>,
        ),
      ),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.type(
      screen.getByRole("combobox", { name: /Search for a locality/ }),
      "Parkside",
    );
    // Buildings are matched on the server, not from a downloaded catalogue.
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining(
          "/locations?reviewed_only=false&limit=3&q=Parkside",
        ),
        expect.anything(),
      ),
    );
    await user.click(
      await screen.findByRole("option", { name: /Parkside Residences/ }),
    );
    expect(await screen.findByText("A helpful owner.")).toBeInTheDocument();
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
              initialize.mock.calls[0][0].callback({ credential: "google-jwt" });
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
            result({ google_client_id: "client.apps.googleusercontent.com" }, false),
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
    await user.click(screen.getByRole("button", { name: /Add a place/ }));
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
      vi.fn((input: string) =>
        Promise.resolve(
          input.includes("/stats") ? result(stats, false) : result(many),
        ),
      ),
    );
    const user = userEvent.setup();
    render(<App />);
    await browse(user);
    const cards = () => screen.getAllByRole("button", { name: /Tower \d+/ });
    await screen.findByRole("button", { name: /Tower 0\b/ });
    expect(cards()).toHaveLength(20);
    expect(cards()[0]).toHaveAccessibleName(/Tower 0\b/);
    await user.click(screen.getByRole("button", { name: /Show 5 more/ }));
    expect(cards()).toHaveLength(25);
    await user.selectOptions(screen.getByLabelText("Sort by"), "rating");
    expect(cards()[0]).toHaveAccessibleName(/Tower 7\b/);
    expect(cards()).toHaveLength(20);
    await user.selectOptions(screen.getByLabelText("Sort by"), "reviews");
    expect(cards()[0]).toHaveAccessibleName(/Tower 3\b/);
  });

  it("presents national totals in lakh and crore without listing every building", async () => {
    render(<App />);
    expect(await screen.findByText("1.2 Cr")).toBeInTheDocument();
    expect(screen.getByText("45.6 L")).toBeInTheDocument();
    expect(screen.getByText("2.3 Cr")).toBeInTheDocument();
    expect(screen.getByText("98,765")).toBeInTheDocument();
    expect(
      screen.getByText(/1\.2 Cr\+ buildings across India/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Across 45\.6 L rated buildings/),
    ).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    // Top-rated buildings come from the stats endpoint.
    expect(
      screen.getByRole("button", { name: /Parkside Residences/ }),
    ).toBeInTheDocument();
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
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
        if (input.includes("/stats"))
          return Promise.resolve(result(stats, false));
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
    expect(
      screen.getByText(/Zoom in to see every building/),
    ).toBeInTheDocument();
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
