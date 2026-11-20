import { useEffect, useRef, useState } from "react";
import {
  AccountPanel,
  AddFlatForm,
  AddPlaceForm,
  ErrorNotice,
  Icon,
  Modal,
  ReviewForm,
  SignIn,
} from "./components";
import PropertyMap from "./Map";
import LocalitySearch, { DEFAULT_CENTER } from "./LocalitySearch";
import type { Area } from "./LocalitySearch";
import type { Bounds, Focus, MapView, Point } from "./Map";
import { api, allPages, hasToken, message, setToken, somePages } from "./api";
import type {
  Account,
  Flat,
  Interaction,
  Location,
  Review,
  Stats,
} from "./api";
import { formatAtLeast, formatCount, plural } from "./format";

export default function App() {
  // Only the places inside the visible map area: the full catalogue is far
  // too large (crores of buildings) to download.
  const [locations, setLocations] = useState<Location[]>([]);
  const [more, setMore] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsError, setStatsError] = useState(false);
  // The map stays hidden until the visitor picks a locality to look at.
  const [area, setArea] = useState<Area | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [selected, setSelected] = useState<Location | null>(null);
  const [flats, setFlats] = useState<Flat[]>([]);
  const [flat, setFlat] = useState<Flat | null>(null);
  const [tab, setTab] = useState<"tenant" | "interaction">("tenant");
  const [reviews, setReviews] = useState<Review[]>([]);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [draft, setDraft] = useState<Point | null>(null);
  const [view, setView] = useState<MapView | null>(null);
  const [zoomOut, setZoomOut] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("nearest");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [flatsVersion, setFlatsVersion] = useState(0);
  // On wide screens the results card floats over the map's left side.
  const [inset, setInset] = useState(floatingInset);
  useEffect(() => {
    const update = () => setInset(floatingInset());
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  // Flat to open after a reload, and the dialog to resume after signing in.
  const wantFlat = useRef<string | null>(null);
  const afterSignIn = useRef<Dialog | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function sessionEnded() {
      setAccount(null);
      setDialog("signin");
      setNotice("Your session has ended. Please sign in again.");
    }
    window.addEventListener("rental-session-ended", sessionEnded);
    return () =>
      window.removeEventListener("rental-session-ended", sessionEnded);
  }, []);
  useEffect(() => {
    if (hasToken())
      api<{ data: Account }>("/me")
        .then((r) => setAccount(r.data))
        .catch(() => setToken(null));
  }, []);
  useEffect(() => {
    let live = true;
    setStatsError(false);
    api<{ data: Stats }>("/stats")
      .then((r) => {
        if (live) setStats(r.data);
      })
      .catch(() => {
        if (live) setStatsError(true);
      });
    return () => {
      live = false;
    };
  }, [version]);
  // Until the map reports its view, use the area the visitor picked.
  const queryBounds = view?.bounds ?? (area ? areaBounds(area) : null);
  const bbox = queryBounds
    ? [queryBounds.west, queryBounds.south, queryBounds.east, queryBounds.north]
        .map((n) => n.toFixed(5))
        .join(",")
    : null;
  useEffect(() => {
    if (!bbox) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    // Wait for panning to settle so a drag doesn't fire a request per frame.
    const timer = setTimeout(() => {
      somePages<Location>(
        `/locations?reviewed_only=false&bbox=${bbox}`,
        MAX_PAGES,
        controller.signal,
      )
        .then(({ rows, more }) => {
          setLocations(rows);
          setMore(more);
        })
        .catch((e) => {
          if (e.name !== "AbortError") setError(message(e));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [bbox, version]);
  useEffect(() => {
    if (!selected) return;
    let live = true;
    setDetailLoading(true);
    setDetailError("");
    setFlat(null);
    setFlats([]);
    allPages<Flat>(`/locations/${selected.id}/flats`)
      .then((rows) => {
        if (live) {
          setFlats(rows);
          setFlat(
            rows.find((f) => f.id === wantFlat.current) || rows[0] || null,
          );
          wantFlat.current = null;
          if (!rows.length) setDetailLoading(false);
        }
      })
      .catch((e) => {
        if (live) {
          setDetailError(message(e));
          setDetailLoading(false);
        }
      });
    return () => {
      live = false;
    };
  }, [selected?.id, flatsVersion]);
  useEffect(() => {
    if (!flat) return;
    let live = true;
    setDetailLoading(true);
    setDetailError("");
    setReviews([]);
    setInteractions([]);
    Promise.all([
      allPages<Review>(`/flats/${flat.id}/tenant-reviews`),
      allPages<Interaction>(`/flats/${flat.id}/interactions`),
    ])
      .then(([r, i]) => {
        if (live) {
          setReviews(r);
          setInteractions(i);
        }
      })
      .catch((e) => {
        if (live) setDetailError(message(e));
      })
      .finally(() => {
        if (live) setDetailLoading(false);
      });
    return () => {
      live = false;
    };
  }, [flat?.id, version]);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(""), 7000);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  function selectLocation(location: Location) {
    setDraft(null);
    setSelected(location);
    // Details replace the list in the side panel; start them from the top.
    if (panelRef.current) panelRef.current.scrollTop = 0;
  }
  function openArea(next: Area) {
    setArea(next);
    setSelected(null);
    setDraft(null);
    setFocus((f) => ({ ...next, key: (f?.key ?? 0) + 1 }));
    window.scrollTo({ top: 0 });
  }
  function openPlace(location: Location) {
    openArea({
      name: location.building_name || "Rental property",
      detail: location.address,
      center: location,
      zoom: 17,
    });
    selectLocation(location);
  }
  function browseAll() {
    openArea({
      name: DEFAULT_CENTER.name,
      detail: "Move the map to explore anywhere in India",
      center: DEFAULT_CENTER.center,
      zoom: 13,
    });
  }
  function changeArea() {
    document.getElementById("locality-search")?.focus();
  }
  function requireAccount(next: Dialog) {
    if (account) setDialog(next);
    else {
      afterSignIn.current = next;
      setDialog("signin");
    }
  }
  function writeReview() {
    requireAccount("review");
  }
  function openReviewFor(created: Flat) {
    wantFlat.current = created.id;
    setVersion((v) => v + 1);
    setDialog("review");
  }
  function placeCreated(created: Flat) {
    setDraft(null);
    if (selected?.id === created.location.id) setFlatsVersion((v) => v + 1);
    selectLocation({ ...created.location, summary: created.summary });
    openReviewFor(created);
  }
  function flatCreated(created: Flat) {
    setFlatsVersion((v) => v + 1);
    openReviewFor(created);
  }
  const nearby = draft
    ? locations
        .map((l) => ({ l, d: distanceMetres(draft, l) }))
        .filter((x) => x.d <= 100)
        .sort((a, b) => a.d - b.d)
        .slice(0, 3)
        .map((x) => x.l)
    : [];
  function logout() {
    setToken(null);
    setAccount(null);
    setDialog(null);
    setNotice("You have been signed out.");
  }
  // The list mirrors the map: only places inside the visible area are listed.
  const visible = view
    ? locations.filter((l) => l.id === selected?.id || inBounds(view.bounds, l))
    : locations;
  // Keep the open place on the map even after panning away from it.
  const pins =
    selected && !locations.some((l) => l.id === selected.id)
      ? [...locations, selected]
      : locations;
  const sorted = sortLocations(visible, sort, view?.center);
  const listed = sorted.slice(0, shown);
  // A new map area or sort starts again from the top of the list.
  const areaKey = view
    ? `${view.bounds.west},${view.bounds.south},${view.bounds.east},${view.bounds.north}`
    : "";
  useEffect(() => setShown(PAGE_SIZE), [areaKey, sort]);
  const totalReviews = visible.reduce(
    (sum, location) =>
      sum +
      location.summary.tenant_review_count +
      location.summary.interaction_review_count,
    0,
  );
  const items = tab === "tenant" ? reviews : interactions;
  const topRated = stats?.top_rated ?? [];
  const closeDetails = () => {
    setSelected(null);
    setFlat(null);
  };
  return (
    <>
      <a className="skip-link" href={area ? "#panel" : "#main"}>
        Skip to content
      </a>
      <header className={`topbar ${area ? "is-app" : ""}`}>
        <a href="/" className="brand" aria-label="Rental Review home">
          <span className="brand-mark" aria-hidden="true">
            <Icon name="home" size={18} />
          </span>
          <span className="brand-name">
            rental<b>review</b>
          </span>
        </a>
        {area && (
          <div className="topbar-search">
            <LocalitySearch
              compact
              onArea={openArea}
              onPlace={openPlace}
              onBrowseAll={browseAll}
            />
          </div>
        )}
        <nav className="topbar-nav" aria-label="Main navigation">
          <button className="nav-link" onClick={() => setDialog("about")}>
            How it works
          </button>
          <button
            className="button secondary"
            onClick={() => setDialog(account ? "account" : "signin")}
          >
            <Icon name="user" size={18} />
            <span>{account ? "Your account" : "Sign in"}</span>
          </button>
        </nav>
      </header>
      {!area ? (
        <main id="main" className="landing">
          <section className="hero">
            <div className="hero-copy">
              <p className="eyebrow">
                <Icon name="shield" size={16} /> India’s rental ratings,
                building by building
              </p>
              <h1>Rent with your eyes open.</h1>
              <p className="lead">
                {stats && stats.location_count > 0
                  ? `${formatAtLeast(stats.location_count)} buildings across India, rated by the people who lived there.`
                  : "Buildings across India, rated by the people who lived there."}{" "}
                See what past tenants say about an owner — deposits, repairs,
                rent hikes — before you sign anything.
              </p>
              <LocalitySearch
                onArea={openArea}
                onPlace={openPlace}
                onBrowseAll={browseAll}
              />
            </div>
            <RatingSummary stats={stats} failed={statsError} />
          </section>
          <section className="scale" aria-label="Rental Review in numbers">
            <ul className="scale-grid">
              {SCALE_FIGURES.map(([key, label]) => (
                <li key={key}>
                  <strong>{stats ? formatCount(stats[key]) : "—"}</strong>
                  <span>{label}</span>
                </li>
              ))}
            </ul>
          </section>
          {topRated.length > 0 && (
            <section className="block" aria-labelledby="top-title">
              <div className="block-head">
                <h2 id="top-title">Top-rated buildings in India</h2>
                <button className="text-button" onClick={browseAll}>
                  See all on the map <Icon name="arrow" size={16} />
                </button>
              </div>
              <ul className="top-grid">
                {topRated.map((location) => (
                  <li key={location.id}>
                    <button
                      className="top-card"
                      onClick={() => openPlace(location)}
                    >
                      <span className="top-score">
                        <Icon name="star" size={18} />
                        {location.summary.average_rating!.toFixed(1)}
                      </span>
                      <strong>
                        {location.building_name || "Rental property"}
                      </strong>{" "}
                      <span className="top-address">{location.address}</span>{" "}
                      <span className="top-meta">
                        {plural(
                          location.summary.tenant_review_count,
                          "tenant review",
                        )}{" "}
                        ·{" "}
                        {plural(
                          location.summary.interaction_review_count,
                          "interaction",
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="block" aria-labelledby="kinds-title">
            <div className="block-head">
              <h2 id="kinds-title">Two kinds of experience, one flat</h2>
            </div>
            <div className="kinds">
              <article className="kind tenant">
                <span className="kind-icon">
                  <Icon name="home" size={24} />
                </span>
                <h3>Tenant reviews</h3>
                <p>
                  From people who lived there. A star rating, the tenancy dates
                  and how the owner handled deposits, repairs and renewals.
                </p>
              </article>
              <article className="kind interaction">
                <span className="kind-icon">
                  <Icon name="chat" size={24} />
                </span>
                <h3>Interactions</h3>
                <p>
                  From people who only met the owner — viewings, enquiries and
                  negotiations. Useful red flags before you ever move in.
                </p>
              </article>
            </div>
          </section>
          <section className="cta" aria-labelledby="cta-title">
            <div>
              <h2 id="cta-title">Rented before? Help the next tenant.</h2>
              <p>
                It takes two minutes. Your review is public; your phone number
                and documents never are.
              </p>
            </div>
            <div className="cta-actions">
              <button
                className="button gold"
                onClick={() => {
                  browseAll();
                  setDraft(DEFAULT_CENTER.center);
                }}
              >
                <Icon name="plus" size={18} /> Add your place
              </button>
              <button className="button on-dark" onClick={browseAll}>
                Browse the map
              </button>
            </div>
          </section>
          <footer className="site-footer">
            <span className="brand-name">
              rental<b>review</b>
            </span>
            <span>Good neighbours start with shared experiences.</span>
            <a href="/api/docs" target="_blank" rel="noreferrer">
              API documentation
            </a>
          </footer>
        </main>
      ) : (
        <main className="explore">
          <div className="panel" id="panel" ref={panelRef}>
            {!selected ? (
              <section
                className="results"
                aria-label="Properties, accessible alternative to the map"
              >
                <div className="panel-head">
                  <div className="area-chip">
                    <span className="area-icon" aria-hidden="true">
                      <Icon name="pin" size={18} />
                    </span>
                    <span>
                      <strong>{area.name}</strong>
                      {area.detail && <small>{area.detail}</small>}
                    </span>
                    <button className="text-button" onClick={changeArea}>
                      Change
                    </button>
                  </div>
                  <p className="panel-count" aria-live="polite">
                    {loading
                      ? "Loading…"
                      : `${plural(visible.length, "place")}${more ? "+" : ""} in this area · ${plural(totalReviews, "experience")}`}
                  </p>
                  <div className="panel-tools">
                    {!loading && visible.length > 1 ? (
                      <label className="list-sort">
                        <span className="sr-only">Sort by</span>
                        <select
                          value={sort}
                          onChange={(e) => setSort(e.target.value as Sort)}
                        >
                          <option value="nearest">Nearest to map centre</option>
                          <option value="reviews">Most reviewed</option>
                          <option value="rating">Highest rated</option>
                        </select>
                      </label>
                    ) : (
                      <span />
                    )}
                    <button
                      className="button secondary small"
                      onClick={() => {
                        setSelected(null);
                        setDraft(view?.center || DEFAULT_CENTER.center);
                      }}
                    >
                      <Icon name="plus" size={16} /> Add a place
                    </button>
                  </div>
                </div>
                <div className="results-body">
                  <ErrorNotice error={error} />
                  {error && (
                    <button
                      className="button secondary"
                      onClick={() => setVersion((v) => v + 1)}
                    >
                      Try again
                    </button>
                  )}
                  {loading && (
                    <ul className="skeleton-list" aria-hidden="true">
                      <li />
                      <li />
                      <li />
                    </ul>
                  )}
                  {!loading && !error && !visible.length && (
                    <div className="empty-state">
                      <Icon name="pin" size={28} />
                      <h3>No places in this area</h3>
                      <p>
                        Move or zoom out the map, or tap the map to add a place
                        here.
                      </p>
                      <button
                        className="button secondary small"
                        onClick={() => setZoomOut((n) => n + 1)}
                      >
                        Zoom out
                      </button>
                    </div>
                  )}
                  {!loading && more && (
                    <p className="area-summary">
                      Showing the first {formatCount(locations.length)} places
                      here. Zoom in to see every building.
                    </p>
                  )}
                  {!loading && listed.length > 0 && (
                    <ul className="property-list">
                      {listed.map((location) => {
                        const rating = location.summary.average_rating;
                        const tenant = location.summary.tenant_review_count;
                        const other = location.summary.interaction_review_count;
                        return (
                          <li key={location.id}>
                            <button
                              className={`property-card ${hovered === location.id ? "hovered" : ""}`}
                              onClick={() => selectLocation(location)}
                              onMouseEnter={() => setHovered(location.id)}
                              onMouseLeave={() => setHovered(null)}
                              onFocus={() => setHovered(location.id)}
                              onBlur={() => setHovered(null)}
                            >
                              <span
                                className={`score ${rating == null ? "none" : rating >= 4 ? "good" : rating >= 3 ? "fair" : "poor"}`}
                                aria-hidden="true"
                              >
                                {rating == null ? (
                                  <small>New</small>
                                ) : (
                                  <>
                                    {rating.toFixed(1)}
                                    <Icon name="star" size={12} />
                                  </>
                                )}
                              </span>
                              <span className="property-body">
                                <strong>
                                  {location.building_name || "Rental property"}
                                </strong>{" "}
                                <span className="property-address">
                                  {location.address}
                                </span>{" "}
                                <span className="property-meta">
                                  {rating == null && (
                                    <span className="sr-only">
                                      No tenant rating yet.{" "}
                                    </span>
                                  )}
                                  {rating != null && (
                                    <span className="sr-only">
                                      Rated {rating.toFixed(1)} of 5.{" "}
                                    </span>
                                  )}
                                  {tenant} tenant{" "}
                                  {tenant === 1 ? "review" : "reviews"} ·{" "}
                                  {other}{" "}
                                  {other === 1 ? "interaction" : "interactions"}
                                </span>
                              </span>
                              <Icon name="chevron" size={18} />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {!loading && sorted.length > listed.length && (
                    <button
                      className="button secondary show-more"
                      onClick={() => setShown((n) => n + PAGE_SIZE)}
                    >
                      Show {Math.min(PAGE_SIZE, sorted.length - listed.length)}{" "}
                      more
                      <span>
                        {formatCount(listed.length)} of{" "}
                        {formatCount(sorted.length)} shown
                      </span>
                    </button>
                  )}
                </div>
              </section>
            ) : (
              <section
                className="detail"
                aria-label="Selected property details"
              >
                <button className="back-link" onClick={closeDetails}>
                  <Icon name="back" size={18} /> Back to results
                </button>
                <header className="detail-head">
                  <h2>{selected.building_name || "Rental property"}</h2>
                  <p>
                    <Icon name="pin" size={16} /> {selected.address}
                  </p>
                </header>
                <dl className="detail-stats">
                  <div>
                    <dt>Rating</dt>
                    <dd>
                      {selected.summary.average_rating == null ? (
                        "—"
                      ) : (
                        <>
                          {selected.summary.average_rating.toFixed(1)}
                          <Icon name="star" size={16} />
                        </>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Reviews</dt>
                    <dd>{formatCount(selected.summary.tenant_review_count)}</dd>
                  </div>
                  <div>
                    <dt>Interactions</dt>
                    <dd>
                      {formatCount(selected.summary.interaction_review_count)}
                    </dd>
                  </div>
                </dl>
                <div className="flat-row">
                  {flats.length > 0 && (
                    <label className="flat-picker">
                      Select a flat
                      <select
                        value={flat?.id || ""}
                        onChange={(e) =>
                          setFlat(
                            flats.find((f) => f.id === e.target.value) || null,
                          )
                        }
                      >
                        {flats.map((f) => (
                          <option key={f.id} value={f.id}>
                            Flat {f.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {!detailLoading && !detailError && (
                    <button
                      className="text-button"
                      onClick={() => requireAccount("flat")}
                    >
                      {flats.length
                        ? "Your flat isn’t listed? Add it"
                        : "Add your flat to review it"}
                    </button>
                  )}
                </div>
                <div className="tabs" role="tablist" aria-label="Feedback type">
                  {(["tenant", "interaction"] as const).map((kind, index) => (
                    <button
                      key={kind}
                      id={`${kind}-tab`}
                      role="tab"
                      aria-selected={tab === kind}
                      aria-controls="feedback-panel"
                      tabIndex={tab === kind ? 0 : -1}
                      onClick={() => setTab(kind)}
                      onKeyDown={(e) => {
                        if (
                          ["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                            e.key,
                          )
                        ) {
                          e.preventDefault();
                          const next =
                            e.key === "Home"
                              ? "tenant"
                              : e.key === "End"
                                ? "interaction"
                                : index === 0
                                  ? "interaction"
                                  : "tenant";
                          setTab(next);
                          document.getElementById(`${next}-tab`)?.focus();
                        }
                      }}
                    >
                      {kind === "tenant" ? "Tenant Reviews" : "Interactions"}
                      <span className="count">
                        {kind === "tenant"
                          ? reviews.length
                          : interactions.length}
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  className="button block"
                  disabled={!flat || detailLoading}
                  onClick={writeReview}
                >
                  <Icon name="plus" size={18} />
                  Share {tab === "tenant" ? "a review" : "an interaction"}
                </button>
                <div
                  id="feedback-panel"
                  role="tabpanel"
                  aria-labelledby={`${tab}-tab`}
                >
                  <ErrorNotice error={detailError} />
                  {detailError && (
                    <button
                      className="text-button"
                      onClick={() => setVersion((v) => v + 1)}
                    >
                      Retry
                    </button>
                  )}
                  {detailLoading ? (
                    <ul className="skeleton-list" aria-hidden="true">
                      <li />
                      <li />
                    </ul>
                  ) : (
                    !detailError && (
                      <>
                        {!items.length && (
                          <div className="empty-state">
                            <Icon name="chat" size={28} />
                            <h3>
                              No{" "}
                              {tab === "tenant"
                                ? "tenant reviews"
                                : "interactions"}{" "}
                              yet
                            </h3>
                            <p>
                              Be the first to share your experience with this
                              flat.
                            </p>
                          </div>
                        )}
                        <div className="review-list">
                          {items.map((item) => (
                            <article className="review-card" key={item.id}>
                              <header>
                                <span className="avatar" aria-hidden="true">
                                  {item.owner_name
                                    .trim()
                                    .charAt(0)
                                    .toUpperCase()}
                                </span>
                                <span className="review-who">
                                  <strong>Owner: {item.owner_name}</strong>
                                  <span>
                                    {"rating" in item
                                      ? `Tenancy · ${formatDate(item.tenancy_start_date)} – ${formatDate(item.tenancy_end_date)}`
                                      : `Interaction · ${formatDate(item.interaction_date)}`}
                                  </span>
                                </span>
                                {"rating" in item && (
                                  <span
                                    className="stars"
                                    role="img"
                                    aria-label={`${item.rating} out of 5 stars`}
                                  >
                                    {[1, 2, 3, 4, 5].map((n) => (
                                      <span
                                        key={n}
                                        className={n <= item.rating ? "on" : ""}
                                      >
                                        <Icon name="star" size={14} />
                                      </span>
                                    ))}
                                  </span>
                                )}
                              </header>
                              <p>
                                {"feedback" in item
                                  ? item.feedback
                                  : item.description}
                              </p>
                              <small>
                                Shared {formatDate(item.submitted_at)}
                                {"editing_deadline" in item &&
                                  ` · Editing closes ${formatDate(item.editing_deadline)}`}
                              </small>
                            </article>
                          ))}
                        </div>
                      </>
                    )
                  )}
                </div>
              </section>
            )}
          </div>
          <div className="map-pane">
            <PropertyMap
              locations={pins}
              selected={selected?.id || null}
              onSelect={selectLocation}
              draft={draft}
              onPick={(point) => {
                setSelected(null);
                setDraft(point);
              }}
              onViewChange={setView}
              zoomOut={zoomOut}
              insetLeft={inset}
              focus={focus}
              highlighted={hovered}
              onHover={setHovered}
            />
            {!draft && (
              <p className="map-hint">
                <Icon name="pin" size={14} /> Tap a pin to read reviews · tap
                anywhere to add a place
              </p>
            )}
            {draft && (
              <div className="draft-card" role="group" aria-label="New place">
                <div>
                  <strong>Add a new place here?</strong>
                  <span>Drag the pin onto the exact building.</span>
                </div>
                <div className="draft-actions">
                  <button
                    className="button ghost small"
                    onClick={() => setDraft(null)}
                  >
                    Cancel
                  </button>
                  <button
                    className="button small"
                    onClick={() => requireAccount("place")}
                  >
                    Continue <Icon name="arrow" size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>
      )}
      {notice && (
        <div className="toast" role="status">
          <Icon name="check" size={18} />
          {notice}
        </div>
      )}
      {dialog === "signin" && (
        <SignIn
          onClose={() => {
            afterSignIn.current = null;
            setDialog(null);
          }}
          onSuccess={(a) => {
            setAccount(a);
            const next = afterSignIn.current;
            afterSignIn.current = null;
            setDialog(next);
            if (!next)
              setNotice(
                "You’re signed in. Select a flat to share your experience.",
              );
          }}
        />
      )}
      {dialog === "account" && account && (
        <AccountPanel
          account={account}
          onClose={() => setDialog(null)}
          onLogout={logout}
          onChanged={() => setVersion((v) => v + 1)}
        />
      )}
      {dialog === "review" && flat && (
        <ReviewForm
          flat={flat}
          kind={tab}
          onClose={() => setDialog(null)}
          onSuccess={() => {
            setDialog(null);
            setVersion((v) => v + 1);
            setNotice("Thanks for sharing. Your experience is now public.");
          }}
        />
      )}
      {dialog === "place" && draft && (
        <AddPlaceForm
          point={draft}
          nearby={nearby}
          onClose={() => setDialog(null)}
          onUseExisting={(location) => {
            setDialog(null);
            selectLocation(location);
          }}
          onCreated={placeCreated}
        />
      )}
      {dialog === "flat" && selected && (
        <AddFlatForm
          location={selected}
          onClose={() => setDialog(null)}
          onCreated={flatCreated}
        />
      )}
      {dialog === "about" && (
        <Modal
          title="A little clarity before you move"
          onClose={() => setDialog(null)}
        >
          <ol className="how-it-works">
            <li>
              <strong>Explore a neighbourhood.</strong>
              <p>
                Search for a building or pick a location on the map. Select a
                flat to see its experiences. Can’t find your place? Tap the map
                where it is to add it.
              </p>
            </li>
            <li>
              <strong>Hear both sides of the experience.</strong>
              <p>
                Tenant Reviews cover a tenancy, with ratings and dates.
                Interactions cover viewings, inquiries, and other conversations.
              </p>
            </li>
            <li>
              <strong>Add your own perspective.</strong>
              <p>
                Sign in with your mobile number to share. Reviews are public,
                while your number and supporting documents stay private.
              </p>
            </li>
          </ol>
          <p className="dev-notice">
            This working model includes fictional properties in Bengaluru. Only
            the buildings in view are loaded, so the map stays fast at any
            scale. Map tiles are provided by OpenStreetMap and need an internet
            connection.
          </p>
        </Modal>
      )}
    </>
  );
}

const PAGE_SIZE = 20;
/** Up to 500 pins per view; denser views ask the visitor to zoom in. */
const MAX_PAGES = 5;
const SCALE_FIGURES = [
  ["location_count", "Buildings mapped"],
  ["rated_location_count", "Buildings rated"],
  ["tenant_review_count", "Tenant reviews"],
  ["interaction_review_count", "Owner interactions"],
] as const;

/** A first map query for an area, before the map has reported its view. */
function areaBounds(area: Area): Bounds {
  if (area.bounds) return area.bounds;
  // Roughly the visible span at the area's zoom level on a laptop screen.
  const span = 360 / 2 ** (area.zoom ?? 15);
  return {
    west: area.center.longitude - span,
    east: area.center.longitude + span,
    south: Math.max(-90, area.center.latitude - span / 2),
    north: Math.min(90, area.center.latitude + span / 2),
  };
}
/** Must match the floating panel width + gap in styles.css. */
function floatingInset() {
  return window.matchMedia?.("(min-width: 861px)").matches ? 440 : 0;
}
type Sort = "nearest" | "reviews" | "rating";

function sortLocations(list: Location[], sort: Sort, center?: Point) {
  const reviews = (l: Location) =>
    l.summary.tenant_review_count + l.summary.interaction_review_count;
  const by: Record<Sort, (a: Location, b: Location) => number> = {
    nearest: (a, b) =>
      center ? distanceMetres(center, a) - distanceMetres(center, b) : 0,
    reviews: (a, b) => reviews(b) - reviews(a),
    // Unrated places go last; ties go to the place with more reviews.
    rating: (a, b) =>
      (b.summary.average_rating ?? -1) - (a.summary.average_rating ?? -1) ||
      reviews(b) - reviews(a),
  };
  return [...list].sort(by[sort]);
}

type Dialog = "signin" | "account" | "review" | "place" | "flat" | "about";

function inBounds(b: Bounds, p: Point) {
  const inLongitude =
    b.west <= b.east
      ? p.longitude >= b.west && p.longitude <= b.east
      : p.longitude >= b.west || p.longitude <= b.east;
  return inLongitude && p.latitude >= b.south && p.latitude <= b.north;
}

function distanceMetres(a: Point, b: Point) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) *
      Math.cos(b.latitude * rad) *
      Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

function formatDate(value: string) {
  return new Date(
    value.length === 10 ? `${value}T00:00:00` : value,
  ).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
    day: "numeric",
  });
}

/** National rating summary for the landing page, from server-side totals. */
function RatingSummary({
  stats,
  failed,
}: {
  stats: Stats | null;
  failed: boolean;
}) {
  if (!stats)
    return (
      <aside className="summary" aria-label="Ratings across India">
        <div className="summary-loading" role="status">
          {failed ? "Ratings are unavailable right now." : "Loading ratings…"}
        </div>
      </aside>
    );
  const average = stats.average_rating;
  const rated = Math.max(1, stats.rated_location_count);
  const most = Math.max(1, ...stats.rating_bands.map((b) => b.count));
  return (
    <aside className="summary" aria-label="Ratings across India">
      <p className="summary-label">
        Across {plural(stats.rated_location_count, "rated building")} in India
      </p>
      <div className="summary-score">
        <strong>{average == null ? "—" : average.toFixed(1)}</strong>
        <span
          className="stars"
          role="img"
          aria-label={
            average == null
              ? "No ratings yet"
              : `Average ${average.toFixed(1)} out of 5`
          }
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <span
              key={n}
              className={
                average != null && n <= Math.round(average) ? "on" : ""
              }
            >
              <Icon name="star" size={20} />
            </span>
          ))}
        </span>
      </div>
      <p className="summary-sub">
        From {plural(stats.tenant_review_count, "tenant review")}
      </p>
      <ul className="bands" aria-label="Share of buildings by tenant rating">
        {stats.rating_bands.map((b) => (
          <li key={b.stars}>
            <span>{b.stars} ★</span>
            <span className="bar">
              <span
                className={`fill s${b.stars}`}
                style={{ width: `${(b.count / most) * 100}%` }}
              />
            </span>
            <span
              className="band-count"
              title={`${formatCount(b.count)} buildings`}
            >
              {Math.round((b.count / rated) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
