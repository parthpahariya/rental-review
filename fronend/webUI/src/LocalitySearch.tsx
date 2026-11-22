import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./components";
import { api, type List, type Location } from "./api";
import {
  coordinatesArea,
  looksLikeCoordinates,
  parseCoordinates,
} from "./maps/coordinates";
import { loadMapProvider } from "./maps/provider";
import { REGION } from "./maps/region";
import type { Area, PlaceSearch, Point, Suggestion } from "./maps/types";

export type { Area, Suggestion } from "./maps/types";
export { DEFAULT_CENTER, REGION } from "./maps/region";

/** Search waits for this many letters; shorter text rarely finds anything. */
export const MIN_SEARCH = 4;
/** Pause in typing (ms) before searching, so each keystroke isn't a request. */
const TYPING_PAUSE = 400;
/** The map provider's search is skipped when this many listed buildings match. */
const ENOUGH_LISTED = 3;

/** Buildings already on Rental Review whose name or address matches: free. */
export async function searchListed(text: string): Promise<Suggestion[]> {
  const params = new URLSearchParams({
    q: text,
    reviewed_only: "false",
    limit: "5",
  });
  const { data } = await api<List<Location>>(`/locations?${params}`);
  return data.map((l) => {
    const name = l.building_name || l.address;
    const area: Area = {
      name,
      center: { latitude: l.latitude, longitude: l.longitude },
      zoom: 18,
    };
    return {
      name,
      detail: l.building_name
        ? `On Rental Review · ${l.address}`
        : "On Rental Review",
      kind: "listed",
      resolve: () => Promise.resolve(area),
    };
  });
}

export default function LocalitySearch({
  onArea,
  onBrowseAll,
  compact = false,
  near,
}: {
  onArea: (area: Area) => void;
  onBrowseAll: () => void;
  /** Suggestions favour areas around this point (your location or the map's). */
  near?: Point;
  /** Slim version for the app bar, without the extra links. */
  compact?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [areas, setAreas] = useState<Suggestion[]>([]);
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
  // The map provider's search (Google or OpenStreetMap), made on first use.
  const search = useRef<PlaceSearch | null>(null);
  const [attribution, setAttribution] = useState("");
  useEffect(() => {
    setAreas([]);
    setError("");
    if (term.length < MIN_SEARCH) return;
    // Typed coordinates go straight to that spot; two numbers are never sent
    // to a provider (Mapbox rejects them, others return noise).
    if (looksLikeCoordinates(term)) {
      const point = parseCoordinates(term);
      const area = point && coordinatesArea(point);
      setAreas(
        area
          ? [
              {
                name: area.name,
                detail: "Go to these coordinates",
                kind: "building",
                resolve: () => Promise.resolve(area),
              },
            ]
          : [],
      );
      return;
    }
    // Results for text the visitor has since changed are dropped.
    let live = true;
    // Show "Finding places…" during the typing pause too, not "No places".
    setBusy(true);
    // Wait for a pause in typing, then look in Rental Review first (free) and
    // ask the map provider (Google is billed) only when too few listed
    // buildings match.
    const timer = setTimeout(async () => {
      const listed = await searchListed(term).catch(() => []);
      if (!live) return;
      setAreas(listed);
      try {
        if (listed.length >= ENOUGH_LISTED) return;
        const provider = await loadMapProvider();
        search.current ??= provider.createSearch();
        const found = await search.current.search(term, nearRef.current);
        if (!live) return;
        setAttribution(provider.searchAttribution);
        const names = new Set(listed.map((l) => l.name.toLowerCase()));
        setAreas([
          ...listed,
          ...found.filter((f) => !names.has(f.name.toLowerCase())),
        ]);
      } catch {
        if (live && !listed.length)
          setError("Place suggestions are unavailable right now.");
      } finally {
        if (live) setBusy(false);
      }
    }, TYPING_PAUSE);
    return () => {
      live = false;
      clearTimeout(timer);
      setBusy(false);
    };
  }, [term]);
  // Nothing is suggested until something is typed: a list of nearby areas
  // would cost a paid Google lookup every time the box is opened.
  const options = term.length < MIN_SEARCH ? [] : areas;
  useEffect(() => setActive(-1), [term, options.length]);
  useEffect(() => {
    if (active >= 0)
      document
        .getElementById(optionId(active))
        ?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const [opening, setOpening] = useState(false);
  function choose(option: Suggestion) {
    setOpen(false);
    setOpening(true);
    setError("");
    option
      .resolve()
      .then(onArea)
      .catch(() => setError("We couldn’t open that place. Try another."))
      .finally(() => {
        setOpening(false);
        // The pick ends the provider's search session (Google bills by it).
        search.current?.finish();
      });
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
  const showList = open && term.length >= MIN_SEARCH;
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
            aria-label="Search for a locality or building"
            aria-busy={opening}
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
          <ul
            className="locality-options"
            id={`${id}-list`}
            role="listbox"
            aria-label="Matching places"
          >
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
                <Icon
                  name={
                    area.kind === "listed"
                      ? "star"
                      : area.kind === "building"
                        ? "home"
                        : "pin"
                  }
                  size={16}
                />
                <span>
                  {area.name}
                  <small>{area.detail}</small>
                </span>
              </li>
            ))}
            {busy && (
              <li className="locality-status" role="status">
                Finding places…
              </li>
            )}
            {!busy && error && !options.length && (
              <li className="locality-status error" role="alert">
                {error}
              </li>
            )}
            {!busy && !error && !options.length && (
              <li className="locality-status" role="status">
                No places in {REGION.name} match “{term}”.
              </li>
            )}
            {attribution && options.some((o) => o.kind !== "listed") && (
              <li className="locality-attribution" role="presentation">
                {attribution}
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
      {/* Errors from searching show inside the open list; this one is for
          the rest (opening a pick, location access), also when compact. */}
      {error && !showList && (
        <p className="locality-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
