import { api } from "../api";
import type { MapProviderName } from "./types";

export type MapConfig = {
  provider: MapProviderName;
  /** Google only: the browser key (public by design) and map ID. */
  api_key: string | null;
  map_id: string | null;
};

let loading: Promise<MapConfig> | null = null;

/** The server's map settings, fetched once per visit (retried after a failure). */
export function mapConfig(): Promise<MapConfig> {
  loading ??= api<{ data: MapConfig }>("/map/config")
    .then((r) => r.data)
    .catch((error) => {
      loading = null;
      throw error;
    });
  return loading;
}
