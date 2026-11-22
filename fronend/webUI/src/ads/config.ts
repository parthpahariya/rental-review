import { api } from "../api";
import type { AdConfig } from "./types";

const NONE: AdConfig = { provider: null, client: null, slots: {} };
let loading: Promise<AdConfig> | null = null;

/**
 * The server's ad settings, fetched once per visit. Any failure means no ads:
 * ads must never break or delay the page.
 */
export function adConfig(): Promise<AdConfig> {
  loading ??= api<{ data: AdConfig }>("/ads/config")
    .then((r) => r.data)
    .catch(() => NONE);
  return loading;
}
