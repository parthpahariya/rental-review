/**
 * The contract between the app and an ad network. Pages only place an
 * <AdSlot placement="…" />; which network fills it, if any, is the server's
 * ADS_PROVIDER setting (see python/backend/app/ads.py).
 */
import type { ComponentType } from "react";

/** Where an ad may appear. Never on the map or inside a place's reviews. */
export type AdPlacement = "home" | "list" | "place";

export type AdProviderName = "adsense";

/** The server's ad settings (GET /ads/config). */
export type AdConfig = {
  provider: AdProviderName | null;
  /** The network's publisher id, e.g. AdSense "ca-pub-…". */
  client: string | null;
  /** The ad unit id for each placement that shows ads. */
  slots: Partial<Record<AdPlacement, string>>;
};

/** Renders one ad unit of a network. */
export type AdUnitProps = { client: string; unit: string };
export type AdUnit = ComponentType<AdUnitProps>;
