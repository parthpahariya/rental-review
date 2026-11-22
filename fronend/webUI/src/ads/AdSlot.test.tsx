import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { AdConfig } from "./types";

const config = vi.hoisted(() => ({
  current: { provider: null, client: null, slots: {} } as AdConfig,
}));
vi.mock("./config", () => ({ adConfig: () => Promise.resolve(config.current) }));

import AdSlot from "./AdSlot";

const SCRIPT = 'script[src^="https://pagead2.googlesyndication.com/"]';

afterEach(() => {
  cleanup();
  document.querySelectorAll(SCRIPT).forEach((s) => s.remove());
  delete window.adsbygoogle;
});

describe("AdSlot", () => {
  it("shows nothing and loads no ad script without an ad network", async () => {
    config.current = { provider: null, client: null, slots: {} };
    const { container } = render(<AdSlot placement="home" />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
    expect(document.querySelector(SCRIPT)).toBeNull();
  });

  it("shows nothing for a placement without an ad unit", async () => {
    config.current = {
      provider: "adsense",
      client: "ca-pub-1",
      slots: { home: "111" },
    };
    const { container } = render(<AdSlot placement="place" />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a labelled AdSense unit and adds the script once", async () => {
    config.current = {
      provider: "adsense",
      client: "ca-pub-1",
      slots: { home: "111", list: "222" },
    };
    render(
      <>
        <AdSlot placement="home" />
        <AdSlot placement="list" />
      </>,
    );
    const ads = await screen.findAllByRole("complementary", {
      name: "Advertisement",
    });
    expect(ads).toHaveLength(2);
    expect(ads[0]).toHaveTextContent("Sponsored");
    const units = await vi.waitFor(() => {
      const found = document.querySelectorAll("ins.adsbygoogle");
      expect(found).toHaveLength(2);
      return found;
    });
    expect(units[0]).toHaveAttribute("data-ad-client", "ca-pub-1");
    expect(units[0]).toHaveAttribute("data-ad-slot", "111");
    expect(units[1]).toHaveAttribute("data-ad-slot", "222");
    const scripts = document.querySelectorAll(SCRIPT);
    expect(scripts).toHaveLength(1);
    expect(scripts[0].getAttribute("src")).toContain("client=ca-pub-1");
    // Each unit asks AdSense to fill it once.
    expect(window.adsbygoogle).toHaveLength(2);
  });
});
