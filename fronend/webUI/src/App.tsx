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
import { api, allPages, hasToken, message, setToken } from "./api";
import type { Account, Flat, Interaction, Location, Review } from "./api";

export default function App() {
  const [locations, setLocations] = useState<Location[]>([]);
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
  const [fitAll, setFitAll] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("nearest");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [flatsVersion, setFlatsVersion] = useState(0);
  // Flat to open after a reload, and the dialog to resume after signing in.
  const wantFlat = useRef<string | null>(null);
  const afterSignIn = useRef<Dialog | null>(null);
  const [loading, setLoading] = useState(true);
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
    setLoading(true);
    setError("");
    allPages<Location>("/locations?reviewed_only=false")
      .then((rows) => {
        if (live) setLocations(rows);
      })
      .catch((e) => {
        if (live) setError(message(e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [version]);
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
      name: "All places",
      center: DEFAULT_CENTER.center,
      zoom: 12,
      bounds: locations.length
        ? {
            west: Math.min(...locations.map((l) => l.longitude)),
            east: Math.max(...locations.map((l) => l.longitude)),
            south: Math.min(...locations.map((l) => l.latitude)),
            north: Math.max(...locations.map((l) => l.latitude)),
          }
        : undefined,
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
  const hiddenCount = locations.length - visible.length;
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
              locations={locations}
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
                <Icon name="shield" size={16} /> Honest reviews from tenants
              </p>
              <h1>
                Know your landlord <span>before you sign.</span>
              </h1>
              <p className="lead">
                Read what tenants say about the owner of a flat, from viewing to
                move-out, then share your own experience.
              </p>
              <LocalitySearch
                locations={locations}
                onArea={openArea}
                onPlace={openPlace}
                onBrowseAll={browseAll}
              />
              <ul className="hero-points">
                <li>
                  <Icon name="check" size={16} /> Free to read, no sign-up
                </li>
                <li>
                  <Icon name="check" size={16} /> Reviews tied to a specific
                  flat
                </li>
                <li>
                  <Icon name="check" size={16} /> Your phone number stays
                  private
                </li>
              </ul>
            </div>
            <HeroPreview />
          </section>
          <section className="steps" aria-labelledby="steps-title">
            <h2 id="steps-title">How it works</h2>
            <ol>
              <li>
                <span className="step-icon">
                  <Icon name="search" size={22} />
                </span>
                <h3>Find the area</h3>
                <p>
                  Search a locality or building. The map and list show every
                  reviewed place nearby.
                </p>
              </li>
              <li>
                <span className="step-icon">
                  <Icon name="chat" size={22} />
                </span>
                <h3>Hear both sides</h3>
                <p>
                  Tenant reviews cover a whole tenancy. Interactions cover
                  viewings, enquiries and everything before you move in.
                </p>
              </li>
              <li>
                <span className="step-icon">
                  <Icon name="plus" size={22} />
                </span>
                <h3>Add your experience</h3>
                <p>
                  Sign in with your mobile number, pick your flat or pin a new
                  one, and help the next tenant.
                </p>
              </li>
            </ol>
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
                      : `${visible.length} ${visible.length === 1 ? "place" : "places"} in this area · ${totalReviews} experiences`}
                  </p>
                  <div className="panel-tools">
                    {!loading && visible.length > 1 ? (
                      <label className="list-sort">
                        Sort by
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
                  {!loading && !error && !locations.length && (
                    <div className="empty-state">
                      <Icon name="search" size={28} />
                      <h3>No places found</h3>
                      <p>Try a different building or neighbourhood.</p>
                    </div>
                  )}
                  {!loading &&
                    !error &&
                    locations.length > 0 &&
                    !visible.length && (
                      <div className="empty-state">
                        <Icon name="pin" size={28} />
                        <h3>No places in this area</h3>
                        <p>
                          Move or zoom out the map, or tap the map to add a
                          place here.
                        </p>
                        <button
                          className="button secondary small"
                          onClick={() => setFitAll((n) => n + 1)}
                        >
                          Show all {locations.length} places
                        </button>
                      </div>
                    )}
                  {!loading && visible.length > 0 && hiddenCount > 0 && (
                    <p className="area-summary">
                      {hiddenCount} more{" "}
                      {hiddenCount === 1 ? "place" : "places"} outside this area
                      <button
                        className="text-button"
                        onClick={() => setFitAll((n) => n + 1)}
                      >
                        Show all
                      </button>
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
                        {listed.length} of {sorted.length} shown
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
                    <dt>Tenant rating</dt>
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
                    <dt>Tenant reviews</dt>
                    <dd>{selected.summary.tenant_review_count}</dd>
                  </div>
                  <div>
                    <dt>Interactions</dt>
                    <dd>{selected.summary.interaction_review_count}</dd>
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
              locations={locations}
              selected={selected?.id || null}
              onSelect={selectLocation}
              draft={draft}
              onPick={(point) => {
                setSelected(null);
                setDraft(point);
              }}
              onViewChange={setView}
              fitAll={fitAll}
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
            This working model includes fictional properties in Bengaluru. Map
            tiles are provided by OpenStreetMap and need an internet connection.
          </p>
        </Modal>
      )}
    </>
  );
}

const PAGE_SIZE = 20;
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

/** Illustrative preview of the product for the landing page. */
function HeroPreview() {
  return (
    <div className="hero-preview" aria-hidden="true">
      <svg viewBox="0 0 480 400" className="preview-map">
        <rect width="480" height="400" rx="24" className="pm-land" />
        <path
          d="M0 260 C120 230 180 300 300 270 S440 220 480 240 V400 H0Z"
          className="pm-park"
        />
        <circle cx="390" cy="90" r="58" className="pm-water" />
        <path d="M-10 150 L490 110" className="pm-road major" />
        <path d="M140 -10 L190 410" className="pm-road major" />
        <path d="M-10 300 L490 330" className="pm-road" />
        <path d="M330 -10 L300 410" className="pm-road" />
        <path d="M60 -10 L80 410" className="pm-road" />
        <path d="M-10 60 L490 30" className="pm-road" />
        <g className="pm-pin">
          <rect x="196" y="160" width="62" height="30" rx="15" />
          <text x="227" y="180">
            ★ 4.6
          </text>
        </g>
        <g className="pm-pin muted">
          <rect x="66" y="210" width="62" height="30" rx="15" />
          <text x="97" y="230">
            ★ 3.9
          </text>
        </g>
        <g className="pm-pin muted">
          <rect x="300" y="250" width="62" height="30" rx="15" />
          <text x="331" y="270">
            ★ 4.2
          </text>
        </g>
        <g className="pm-cluster">
          <circle cx="300" cy="150" r="20" />
          <text x="300" y="155">
            7
          </text>
        </g>
      </svg>
      <div className="preview-card">
        <div className="preview-card-head">
          <span className="avatar">A</span>
          <span>
            <strong>Owner: Anita R.</strong>
            <small>Tenancy · 2 years</small>
          </span>
          <span className="stars on" aria-hidden="true">
            ★★★★★
          </span>
        </div>
        <p>
          “Repairs were sorted within a day and the deposit came back in full.”
        </p>
      </div>
    </div>
  );
}
