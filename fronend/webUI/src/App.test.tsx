import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { setToken } from "./api";

vi.mock("./Map", () => ({
  default: () => <div aria-label="Interactive rental location map" />,
}));

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
  cleanup();
  vi.unstubAllGlobals();
});

describe("Rental Review", () => {
  it("keeps the selected flat while switching accessible feedback tabs", async () => {
    const user = userEvent.setup();
    render(<App />);
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
    expect(screen.getByRole("combobox")).toHaveValue("flat-1");
  });

  it("shows an empty search state and lets the visitor clear it", async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByRole("searchbox", { hidden: true });
    await user.type(input, "Unknown");
    await user.click(screen.getByRole("button", { name: /^Explore/ }));
    expect(await screen.findByText("No places found")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(
      await screen.findByRole("button", { name: /Parkside Residences/ }),
    ).toBeInTheDocument();
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
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Database unavailable.",
    );
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });
});
