import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./components";
import type { Bounds, Point } from "./Map";

/** Where the map should open: a locality, a single place, or everything. */
export type Area = {
  name: string;
  detail?: string;
  center: Point;
  bounds?: Bounds;
  zoom?: number;
};

// Locality suggestions cover India. The map still opens on Bengaluru by default,
// where the demo properties are.
export const REGION = {
  name: "India",
  countryCode: "IN",
  bbox: "68.1,6.5,97.5,35.7",
};
export const DEFAULT_CENTER = {
  name: "Bengaluru",
  center: { latitude: 12.955, longitude: 77.63 },
};
const GEOCODER = "https://photon.komoot.io/api/";
const REVERSE_GEOCODER = "https://photon.komoot.io/reverse";

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    type?: string;
    city?: string;
    county?: string;
    state?: string;
    countrycode?: string;
    extent?: [number, number, number, number];
  };
};

/**
 * Localities matching `text`. With `near`, the geocoder ranks matches by
 * distance from that point, so "Na" near JP Nagar gives Nagarabhavi, not Nagpur.
 */
export async function searchLocalities(
  text: string,
  signal?: AbortSignal,
  near?: Point,
): Promise<Area[]> {
  const params = new URLSearchParams({
    q: text,
    // Ask for extra: some results are dropped as duplicates or outside India.
    limit: "15",
    lang: "en",
    bbox: REGION.bbox,
  });
  if (near) {
    params.set("lat", near.latitude.toFixed(4));
    params.set("lon", near.longitude.toFixed(4));
  }
  for (const layer of ["locality", "district", "city"])
    params.append("layer", layer);
  const response = await fetch(`${GEOCODER}?${params}`, { signal });
  if (!response.ok) throw new Error("Locality search is unavailable.");
  const body: { features: PhotonFeature[] } = await response.json();
  return toAreas(body.features).slice(0, 8);
}

/**
 * Neighbourhoods around a point, nearest first, for the empty search box.
 * The "district" layer holds neighbourhoods; "locality" is mostly apartment
 * complexes, so it is left out here.
 */
export async function nearbyLocalities(
  near: Point,
  signal?: AbortSignal,
): Promise<Area[]> {
  const params = new URLSearchParams({
    lat: near.latitude.toFixed(4),
    lon: near.longitude.toFixed(4),
    limit: "10",
    radius: "5",
    lang: "en",
    layer: "district",
  });
  const response = await fetch(`${REVERSE_GEOCODER}?${params}`, { signal });
  if (!response.ok) throw new Error("Nearby areas are unavailable.");
  const body: { features: PhotonFeature[] } = await response.json();
  return toAreas(body.features).slice(0, 6);
}

function toAreas(features: PhotonFeature[]): Area[] {
  const areas: Area[] = [];
  for (const { geometry, properties: p } of features) {
    if (!p.name) continue;
    // The bounding box also covers parts of neighbouring countries.
    if (p.countrycode && p.countrycode !== REGION.countryCode) continue;
    const [longitude, latitude] = geometry.coordinates;
    const center = { latitude, longitude };
    // OpenStreetMap often lists one locality twice, e.g. as a suburb and as
    // an administrative district a short distance apart.
    if (
      areas.some(
        (a) =>
          a.name.toLowerCase() === p.name!.toLowerCase() &&
          Math.abs(a.center.latitude - latitude) < 0.03 &&
          Math.abs(a.center.longitude - longitude) < 0.03,
      )
    )
      continue;
    const detail = [p.city || p.county, p.state]
      .filter((x) => x && x !== p.name)
      .join(", ");
    const e = p.extent;
    areas.push({
      name: p.name,
      detail,
      center,
      bounds: e
        ? { west: e[0], north: e[1], east: e[2], south: e[3] }
        : undefined,
      zoom: p.type === "city" ? 12 : 15,
    });
  }
  return areas;
}

export default function LocalitySearch({
  onArea,
  onBrowseAll,
  compact = false,
  near,
  nearLabel = "Areas nearby",
}: {
  onArea: (area: Area) => void;
  onBrowseAll: () => void;
  /** Suggestions favour areas around this point (your location or the map's). */
  near?: Point;
  /** Heading for the nearby list shown before anything is typed. */
  nearLabel?: string;
  /** Slim version for the app bar, without the extra links. */
  compact?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [areas, setAreas] = useState<Area[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [locating, setLocating] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const term = text.trim();
  // Read when a request starts, so moving the map doesn't restart typing.
  const nearRef = useRef(near);
  nearRef.current = near;
  useEffect(() => {
    setAreas([]);
    setError("");
    if (term.length < 2) return;
    const controller = new AbortController();
    // Wait for a pause in typing before asking the geocoder.
    const timer = setTimeout(() => {
      setBusy(true);
      searchLocalities(term, controller.signal, nearRef.current)
        .then(setAreas)
        .catch((e) => {
          if (e.name !== "AbortError")
            setError("Locality suggestions are unavailable right now.");
        })
        .finally(() => setBusy(false));
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term]);
  // Before anything is typed, suggest the neighbourhoods around `near`.
  // Rounded to ~1 km so panning the map doesn't refetch on every move.
  const nearKey = near
    ? `${near.latitude.toFixed(2)},${near.longitude.toFixed(2)}`
    : "";
  const [nearby, setNearby] = useState<Area[]>([]);
  useEffect(() => {
    setNearby([]);
    if (!open || !nearRef.current) return;
    const controller = new AbortController();
    nearbyLocalities(nearRef.current, controller.signal)
      .then(setNearby)
      .catch(() => {
        // Typing still searches; the nearby list is a convenience.
      });
    return () => controller.abort();
  }, [nearKey, open]);
  // Suggestions are localities only; buildings are found on the map.
  const showingNearby = term.length < 2;
  const options = showingNearby ? nearby : areas;
  useEffect(() => setActive(-1), [term, options.length]);
  useEffect(() => {
    if (active >= 0)
      document
        .getElementById(optionId(active))
        ?.scrollIntoView({ block: "nearest" });
  }, [active]);
  function choose(area: Area) {
    setOpen(false);
    onArea(area);
  }
  function useMyLocation() {
    if (!navigator.geolocation) {
      setError("Your browser can’t share your location.");
      return;
    }
    setLocating(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        onArea({
          name: "Near you",
          center: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          },
          zoom: 15,
        });
      },
      () => {
        setLocating(false);
        setError(
          "We couldn’t get your location. Search for a locality instead.",
        );
      },
      { timeout: 10000, maximumAge: 300000 },
    );
  }
  const showList = open && (term.length >= 2 || nearby.length > 0);
  const optionId = (i: number) => `${id}-option-${i}`;
  return (
    <div className={`locality-search ${compact ? "compact" : ""}`}>
      {/* The suggestion list hangs directly under the input, over the page. */}
      <div className="locality-field">
        <form
          className="search-form"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            const pick = options[active >= 0 ? active : 0];
            if (pick) choose(pick);
            else setOpen(true);
          }}
        >
          <Icon name="search" size={21} />
          <input
            ref={input}
            id="locality-search"
            type="search"
            role="combobox"
            autoComplete="off"
            aria-label="Search for a locality or neighbourhood"
            aria-expanded={showList}
            aria-controls={`${id}-list`}
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            placeholder="Search a locality"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setOpen(true);
                if (!options.length) return;
                const step = e.key === "ArrowDown" ? 1 : -1;
                setActive((i) => (i + step + options.length) % options.length);
              } else if (e.key === "Escape") setOpen(false);
            }}
          />
          <button
            className="button"
            type="submit"
            aria-label={compact ? "Search" : undefined}
          >
            {compact ? (
              <Icon name="search" size={18} />
            ) : (
              <>
                Explore <Icon name="arrow" size={18} />
              </>
            )}
          </button>
        </form>
        {showList && (
          <ul
            className="locality-options"
            id={`${id}-list`}
            role="listbox"
            aria-label={showingNearby ? nearLabel : "Matching localities"}
          >
            {showingNearby && (
              <li className="locality-heading" role="presentation">
                {nearLabel}
              </li>
            )}
            {options.map((area, i) => (
              <li
                key={`${area.name}-${i}`}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                className={i === active ? "active" : ""}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(area)}
              >
                <Icon name="pin" size={16} />
                <span>
                  {area.name}
                  <small>{area.detail}</small>
                </span>
              </li>
            ))}
            {busy && (
              <li className="locality-status" role="status">
                Finding localities…
              </li>
            )}
            {!showingNearby && !busy && !error && !options.length && (
              <li className="locality-status" role="status">
                No localities in {REGION.name} match “{term}”.
              </li>
            )}
          </ul>
        )}
      </div>
      {!compact && (
        <div className="locality-actions">
          <button
            type="button"
            className="text-button"
            onClick={useMyLocation}
            disabled={locating}
          >
            {locating ? "Finding you…" : "Use my location"}
          </button>
          <span aria-hidden="true">·</span>
          <button type="button" className="text-button" onClick={onBrowseAll}>
            Browse places on the map
          </button>
        </div>
      )}
      {error && (
        <p className="locality-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
