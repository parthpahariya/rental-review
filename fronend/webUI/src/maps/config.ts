import { api } from "../api";
import type { MapConfig } from "./types";

export type { MapConfig } from "./types";

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
