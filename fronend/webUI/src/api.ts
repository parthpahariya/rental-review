export type Summary = {
  tenant_review_count: number;
  interaction_review_count: number;
  average_rating: number | null;
};
export type Location = {
  id: string;
  building_name: string | null;
  address: string;
  latitude: number;
  longitude: number;
  summary: Summary;
};
export type Flat = {
  id: string;
  label: string;
  location: Location;
  summary: Summary;
};
/** Where a review is; only on the author's own records. */
export type Place = {
  building_name: string | null;
  address: string;
  flat_label: string;
};
export type Review = {
  id: string;
  flat_id: string;
  location_id?: string;
  place?: Place;
  owner_name: string;
  rating: number;
  feedback: string;
  tenancy_start_date: string;
  tenancy_end_date: string;
  submitted_at: string;
  editing_deadline: string;
  can_edit?: boolean;
  can_request_deletion?: boolean;
  deleted_at?: string | null;
};
export type Interaction = {
  id: string;
  flat_id: string;
  location_id?: string;
  place?: Place;
  owner_name: string;
  description: string;
  interaction_date: string;
  submitted_at: string;
};
export type Stats = {
  location_count: number;
  rated_location_count: number;
  tenant_review_count: number;
  interaction_review_count: number;
  average_rating: number | null;
  rating_bands: { stars: number; count: number }[];
  top_rated: Location[];
};
export type Account = {
  id: string;
  email: string | null;
  google_linked?: boolean;
  role: "user" | "admin";
  status: string;
};
export type Deletion = {
  id: string;
  tenant_review_id: string;
  reason: string;
  status: string;
  decision_note: string | null;
  review?: Review;
};
export type Attachment = {
  id: string;
  file: { id: string; original_filename: string };
};
export type List<T> = { data: T[]; page: { next_cursor: string | null } };

let sessionToken = sessionStorage.getItem("rental-session");
export function setToken(token: string | null) {
  sessionToken = token;
  if (token) sessionStorage.setItem("rental-session", token);
  else sessionStorage.removeItem("rental-session");
}
export function hasToken() {
  return !!sessionToken;
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public retryAfter?: number,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (sessionToken) headers.set("Authorization", `Bearer ${sessionToken}`);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const response = await fetch(`/api/v1${path}`, { ...options, headers });
  if (response.status === 204) return undefined as T;
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("The service is unavailable. Please try again.");
  }
  if (!response.ok) {
    const error = body.error;
    if (error?.code === "UNAUTHENTICATED" && sessionToken) {
      setToken(null);
      window.dispatchEvent(new Event("rental-session-ended"));
    }
    const detail = error?.fields
      ?.map(
        (f: { field: string; message: string }) => `${f.field}: ${f.message}`,
      )
      .join(" ");
    throw new ApiError(
      error?.code || "REQUEST_FAILED",
      detail || error?.message || "Request failed.",
      response.status,
      error?.retry_after_seconds,
    );
  }
  return body as T;
}

export const post = <T>(path: string, body: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown) =>
  api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
/** A flat the signed-in user added, from `/me/flats`. */
export type OwnFlat = Flat & { added_place: boolean; can_edit: boolean };
/** What the signed-in user may change at a place they added. */
export type Permissions = {
  can_edit_location: boolean;
  editable_flat_ids: string[];
};
export const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";

export async function allPages<T>(path: string): Promise<T[]> {
  return (await somePages<T>(path, Infinity)).rows;
}

/**
 * Follows `next_cursor` for at most `maxPages` pages. `more` is true when the
 * server still had rows left, e.g. a zoomed-out map over a dense city.
 */
export async function somePages<T>(
  path: string,
  maxPages: number,
  signal?: AbortSignal,
): Promise<{ rows: T[]; more: boolean }> {
  const results: T[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const result: List<T> = await api(
      `${path}${path.includes("?") ? "&" : "?"}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      signal ? { signal } : {},
    );
    results.push(...result.data);
    cursor = result.page.next_cursor;
    pages += 1;
  } while (cursor && pages < maxPages);
  return { rows: results, more: !!cursor };
}

export async function upload(file: File, purpose: string) {
  const form = new FormData();
  form.set("file", file);
  form.set("purpose", purpose);
  const result = await api<{ data: { id: string; status: string } }>("/files", {
    method: "POST",
    body: form,
  });
  if (result.data.status !== "ready")
    throw new Error("The upload is still being processed. Please try again.");
  return result.data.id;
}

export async function downloadFile(fileId: string, filename: string) {
  const response = await fetch(`/api/v1/files/${fileId}/content`, {
    headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {},
  });
  if (!response.ok) throw new Error("This file is unavailable.");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
