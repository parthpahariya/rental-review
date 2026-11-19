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
      if (input.includes("/auth/otp/challenges"))
        return Promise.resolve(
          result(
            {
              challenge_id: "challenge",
              development_code: "123456",
              resend_available_at: new Date().toISOString(),
            },
            false,
          ),
        );
      if (input.includes("/auth/otp/verifications"))
        return Promise.resolve(
          result(
            {
              outcome: "registration_required",
              completion_token: "completion",
            },
            false,
          ),
        );
      if (input.includes("/auth/registrations"))
        return Promise.resolve(
          result(
            {
              account: {
                id: "me",
                mobile_number: "+919876543210",
                role: "user",
              },
              session: { token: "test-session" },
            },
            false,
          ),
        );
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
    screen.getByRole("button", { name: /Browse all places on the map/ }),
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
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/locations"),
        expect.anything(),
      ),
    );
    await user.type(
      screen.getByRole("combobox", { name: /Search for a locality/ }),
      "Parkside",
    );
    await user.click(
      await screen.findByRole("option", { name: /Parkside Residences/ }),
    );
    expect(await screen.findByText("A helpful owner.")).toBeInTheDocument();
  });

  it("completes development OTP registration and opens an account session", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await user.type(screen.getByLabelText("Mobile number"), "9876543210");
    await user.click(
      screen.getByRole("button", { name: /Send verification code/ }),
    );
    expect(await screen.findByText("123456")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Verification code"), "123456");
    await user.click(screen.getByRole("button", { name: /Verify & continue/ }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Your account" }),
      ).toBeInTheDocument(),
    );
    expect(sessionStorage.getItem("rental-session")).toBe("test-session");
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
              { id: "me", mobile_number: "+919876543210", role: "user" },
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
      vi.fn(() => Promise.resolve(result(many))),
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
