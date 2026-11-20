import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./components";
import { api } from "./api";
import type { List, Location } from "./api";
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

export async function searchLocalities(
  text: string,
  signal?: AbortSignal,
): Promise<Area[]> {
  const params = new URLSearchParams({
    q: text,
    // Ask for extra: some results are dropped as duplicates or outside India.
    limit: "15",
    lang: "en",
    bbox: REGION.bbox,
  });
  for (const layer of ["locality", "district", "city"])
    params.append("layer", layer);
  const response = await fetch(`${GEOCODER}?${params}`, { signal });
  if (!response.ok) throw new Error("Locality search is unavailable.");
  const body: { features: PhotonFeature[] } = await response.json();
  const areas: Area[] = [];
  for (const { geometry, properties: p } of body.features) {
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
  return areas.slice(0, 8);
}

type Option =
  { kind: "place"; location: Location } | { kind: "area"; area: Area };

export default function LocalitySearch({
  onArea,
  onPlace,
  onBrowseAll,
  compact = false,
}: {
  onArea: (area: Area) => void;
  onPlace: (location: Location) => void;
  onBrowseAll: () => void;
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
  useEffect(() => {
    setAreas([]);
    setError("");
    if (term.length < 2) return;
    const controller = new AbortController();
    // Wait for a pause in typing before asking the geocoder.
    const timer = setTimeout(() => {
      setBusy(true);
      searchLocalities(term, controller.signal)
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
  // Buildings are searched on the server: the catalogue is far too big to
  // hold in the browser.
  const [places, setPlaces] = useState<Location[]>([]);
  useEffect(() => {
    setPlaces([]);
    if (term.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api<List<Location>>(
        `/locations?reviewed_only=false&limit=3&q=${encodeURIComponent(term)}`,
        { signal: controller.signal },
      )
        .then((r) => setPlaces(r.data.slice(0, 3)))
        .catch(() => {
          // Locality suggestions still work without building matches.
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term]);
  const options: Option[] = [
    ...places.map((location) => ({ kind: "place" as const, location })),
    ...areas.map((area) => ({ kind: "area" as const, area })),
  ];
  useEffect(() => setActive(-1), [term, areas.length, places.length]);
  useEffect(() => {
    if (active >= 0)
      document
        .getElementById(optionId(active))
        ?.scrollIntoView({ block: "nearest" });
  }, [active]);
  function choose(option: Option) {
    setOpen(false);
    if (option.kind === "place") onPlace(option.location);
    else onArea(option.area);
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
  const showList = open && term.length >= 2;
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
            aria-label="Search for a locality, neighbourhood, or building"
            aria-expanded={showList}
            aria-controls={`${id}-list`}
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            placeholder="Search a locality or building"
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
          <ul className="locality-options" id={`${id}-list`} role="listbox">
            {options.map((option, i) => (
              <li
                key={
                  option.kind === "place"
                    ? option.location.id
                    : `${option.area.name}-${i}`
                }
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                className={i === active ? "active" : ""}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(option)}
              >
                <Icon
                  name={option.kind === "place" ? "home" : "pin"}
                  size={16}
                />
                <span>
                  {option.kind === "place"
                    ? option.location.building_name || "Rental property"
                    : option.area.name}
                  <small>
                    {option.kind === "place"
                      ? option.location.address
                      : option.area.detail}
                  </small>
                </span>
                {option.kind === "place" && <em>Reviewed place</em>}
              </li>
            ))}
            {busy && (
              <li className="locality-status" role="status">
                Finding localities…
              </li>
            )}
            {!busy && !error && !options.length && (
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
