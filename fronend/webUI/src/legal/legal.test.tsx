import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import DeleteData from "./DeleteData";
import PrivacyPolicy from "./PrivacyPolicy";
import { legalPageFor, SITE } from "./site";

afterEach(cleanup);

describe("legal pages", () => {
  it("are reached at /privacy and /delete-data", () => {
    expect(legalPageFor("/privacy")).toBe("privacy");
    expect(legalPageFor("/privacy/")).toBe("privacy");
    expect(legalPageFor("/delete-data")).toBe("delete-data");
    expect(legalPageFor("/")).toBeNull();
    expect(legalPageFor("/privacy-old")).toBeNull();
  });

  it("explain what is collected, what is public, sharing and rights", () => {
    render(<PrivacyPolicy />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Privacy Policy" }),
    ).toBeInTheDocument();
    for (const section of [
      "What we collect",
      "What is public",
      "Who we share it with",
      "People named in reviews",
      "Your rights",
      "Grievances",
    ])
      expect(
        screen.getByRole("heading", { name: section }),
      ).toBeInTheDocument();
    expect(
      screen.getByText(/Data Protection Board of India/),
    ).toBeInTheDocument();
    for (const link of screen.getAllByRole("link", {
      name: "Delete your data",
    }))
      expect(link).toHaveAttribute("href", "/delete-data");
  });

  it("explains each way to delete data, matching the app's buttons", () => {
    render(<DeleteData />);
    for (const label of [
      "Request deletion",
      "Remove",
      "Deactivate account",
      "Confirm deactivation",
    ])
      expect(screen.getAllByText(label, { selector: "strong" }).length).toBe(1);
    expect(
      screen.getByRole("heading", {
        name: "Deactivate or delete your account",
      }),
    ).toBeInTheDocument();
  });

  it("flags a missing operator or contact email until they are set", () => {
    render(<PrivacyPolicy />);
    const draft = screen.queryByRole("note");
    if (SITE.operator && SITE.contactEmail) expect(draft).toBeNull();
    else expect(draft).toHaveTextContent(/not set yet/);
  });
});
