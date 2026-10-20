import { useEffect, useRef, useState } from "react";
import {
  AccountPanel,
  ErrorNotice,
  Icon,
  Modal,
  ReviewForm,
  SignIn,
} from "./components";
import PropertyMap from "./Map";
import { api, allPages, hasToken, message, setToken } from "./api";
import type { Account, Flat, Interaction, Location, Review } from "./api";

export default function App() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Location | null>(null);
  const [flats, setFlats] = useState<Flat[]>([]);
  const [flat, setFlat] = useState<Flat | null>(null);
  const [tab, setTab] = useState<"tenant" | "interaction">("tenant");
  const [reviews, setReviews] = useState<Review[]>([]);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [dialog, setDialog] = useState<
    "signin" | "account" | "review" | "about" | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState("");
  const detailRef = useRef<HTMLElement>(null);
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
    allPages<Location>(
      `/locations?reviewed_only=false${query ? `&q=${encodeURIComponent(query)}` : ""}`,
    )
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
  }, [query, version]);
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
          setFlat(rows[0] || null);
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
  }, [selected?.id]);
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
    setSelected(location);
    setTimeout(
      () =>
        detailRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        }),
      50,
    );
  }
  function writeReview() {
    setDialog(account ? "review" : "signin");
  }
  function logout() {
    setToken(null);
    setAccount(null);
    setDialog(null);
    setNotice("You have been signed out.");
  }
  const totalReviews = locations.reduce(
    (sum, location) =>
      sum +
      location.summary.tenant_review_count +
      location.summary.interaction_review_count,
    0,
  );
  const items = tab === "tenant" ? reviews : interactions;
  return (
    <>
      <header className="site-header">
        <a href="/" className="brand" aria-label="Rental Review home">
          <span className="brand-icon">
            <Icon name="home" size={25} />
          </span>
          <span>
            rental<span className="brand-light">review</span>
            <span className="brand-dot">.</span>
          </span>
        </a>
        <nav aria-label="Main navigation">
          <a className="nav-active" href="#explore">
            Explore rentals
          </a>
          <button className="nav-link" onClick={() => setDialog("about")}>
            How it works
          </button>
        </nav>
        <button
          className="button outline header-signin"
          onClick={() => setDialog(account ? "account" : "signin")}
        >
          <Icon name="user" size={17} />
          {account ? "Your account" : "Sign in"}
        </button>
      </header>
      <main>
        <section className="hero">
          <div className="hero-content">
            <span className="eyebrow">
              <span className="status-dot" /> A BETTER MOVE STARTS HERE
            </span>
            <h1>
              Know the place.
              <br />
              <span>Trust your next move.</span>
            </h1>
            <p>
              Honest experiences from people who’ve been there.
              <br className="desktop-break" /> Get to know the owner before you
              call it home.
            </p>
            <form
              className="search-form"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                setQuery(search.trim());
                setSelected(null);
              }}
            >
              <Icon name="search" size={21} />
              <input
                type="search"
                aria-label="Search by neighbourhood, address, or building"
                placeholder="Try Indiranagar, Koramangala, or a building…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button className="button" type="submit">
                Explore <Icon name="arrow" size={17} />
              </button>
            </form>
            <div className="hero-footnote">
              <Icon name="shield" size={16} />
              <span>
                Real experiences. Public reviews. Private personal details.
              </span>
            </div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="art-circle" />
            <div className="art-building building-back">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="art-building building-front">
              <div className="building-roof" />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <div className="building-door" />
            </div>
            <div className="art-tree tree-one">
              <span />
            </div>
            <div className="art-tree tree-two">
              <span />
            </div>
            <div className="art-ground" />
            <div className="art-note">
              <span className="mini-avatar">S</span>
              <div>
                <strong>A place that feels like home</strong>
                <span>
                  ★★★★★ <small>Real tenant experiences</small>
                </span>
              </div>
            </div>
            <span className="art-spark spark-one">✧</span>
            <span className="art-spark spark-two">✧</span>
          </div>
        </section>
        <section className="explore-section" id="explore">
          <div className="section-heading">
            <div>
              <span className="eyebrow">ON THE NEIGHBOURHOOD MAP</span>
              <h2>A little local knowledge goes a long way.</h2>
            </div>
            <span className="city-label">
              <Icon name="pin" size={16} /> Bengaluru demo
            </span>
          </div>
          <div className="explore-toolbar">
            <div className="view-label">
              <Icon name="pin" size={17} />
              <strong>Explore properties</strong>
              <span>
                {loading
                  ? "Loading…"
                  : `${locations.length} places · ${totalReviews} experiences`}
              </span>
            </div>
            <span className="demo-label">Fictional demo properties</span>
          </div>
          <div className="explore-grid">
            <aside
              className="property-list"
              aria-label="Properties, accessible alternative to the map"
            >
              {query && (
                <div className="search-summary">
                  Results for “{query}”
                  <button
                    className="text-button"
                    onClick={() => {
                      setQuery("");
                      setSearch("");
                    }}
                  >
                    Clear
                  </button>
                </div>
              )}
              <ErrorNotice error={error} />
              {error && (
                <button
                  className="button outline"
                  onClick={() => setVersion((v) => v + 1)}
                >
                  Try again
                </button>
              )}
              {loading && (
                <p className="empty-state" role="status">
                  Finding places and experiences…
                </p>
              )}
              {!loading && !error && !locations.length && (
                <div className="empty-state">
                  <Icon name="search" size={30} />
                  <h3>No places found</h3>
                  <p>Try a different building or neighbourhood.</p>
                </div>
              )}
              {!loading &&
                locations.map((location, index) => (
                  <button
                    key={location.id}
                    className={`property-card ${selected?.id === location.id ? "selected" : ""}`}
                    onClick={() => selectLocation(location)}
                    aria-pressed={selected?.id === location.id}
                  >
                    <div
                      className={`property-thumbnail tone-${index % 4}`}
                      aria-hidden="true"
                    >
                      <Icon name="home" size={31} />
                      <span>{String(index + 1).padStart(2, "0")}</span>
                    </div>
                    <div className="property-card-content">
                      <div className="property-card-top">
                        <span className="property-category">RESIDENTIAL</span>
                        <Icon name="arrow" size={16} />
                      </div>
                      <h3>{location.building_name || "Rental property"}</h3>
                      <p>
                        <Icon name="pin" size={12} />
                        {location.address}
                      </p>
                      <div className="property-meta">
                        {location.summary.average_rating !== null ? (
                          <span className="rating-chip">
                            ★ {location.summary.average_rating.toFixed(1)}
                          </span>
                        ) : (
                          <span className="new-chip">No tenant rating yet</span>
                        )}
                        <span>
                          {location.summary.tenant_review_count} tenant{" "}
                          {location.summary.tenant_review_count === 1
                            ? "review"
                            : "reviews"}{" "}
                          · {location.summary.interaction_review_count}{" "}
                          {location.summary.interaction_review_count === 1
                            ? "interaction"
                            : "interactions"}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              <div className="list-footer">
                <Icon name="chat" size={20} />
                <p>
                  Every experience adds a little clarity.
                  <br />
                  <strong>Yours could help someone find home.</strong>
                </p>
              </div>
            </aside>
            <div className="map-panel">
              <PropertyMap
                locations={locations}
                selected={selected?.id || null}
                onSelect={selectLocation}
              />
              <div className="map-caption">
                <span className="status-dot" /> Select a pin to hear from the
                neighbourhood
              </div>
            </div>
          </div>
        </section>
        {selected && (
          <section
            className="detail-section"
            ref={detailRef}
            aria-label="Selected property details"
          >
            <div className="detail-heading">
              <div>
                <span className="eyebrow">GET TO KNOW THE PLACE</span>
                <h2>{selected.building_name || "Rental property"}</h2>
                <p className="muted">{selected.address}</p>
              </div>
              <button
                className="icon-button"
                aria-label="Close property details"
                onClick={() => {
                  setSelected(null);
                  setFlat(null);
                }}
              >
                <Icon name="close" />
              </button>
            </div>
            {flats.length > 0 && (
              <label className="flat-picker">
                Select a flat
                <select
                  value={flat?.id || ""}
                  onChange={(e) =>
                    setFlat(flats.find((f) => f.id === e.target.value) || null)
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
            <div className="detail-toolbar">
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
                    <span>
                      {kind === "tenant" ? reviews.length : interactions.length}
                    </span>
                  </button>
                ))}
              </div>
              <button
                className="button small"
                disabled={!flat || detailLoading}
                onClick={writeReview}
              >
                Share {tab === "tenant" ? "a review" : "an interaction"}{" "}
                <Icon name="arrow" size={16} />
              </button>
            </div>
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
                <p className="empty-state" role="status">
                  Loading experiences…
                </p>
              ) : (
                !detailError && (
                  <>
                    {!items.length && (
                      <div className="empty-state">
                        <Icon name="chat" size={30} />
                        <h3>
                          No{" "}
                          {tab === "tenant" ? "tenant reviews" : "interactions"}{" "}
                          yet
                        </h3>
                        <p>
                          Be the first to share your experience with this flat.
                        </p>
                      </div>
                    )}
                    <div className="review-grid">
                      {items.map((item) => (
                        <article className="review-card" key={item.id}>
                          <div className="review-card-heading">
                            <span className="review-avatar">
                              <Icon
                                name={tab === "tenant" ? "home" : "chat"}
                                size={20}
                              />
                            </span>
                            <div>
                              <strong>Owner: {item.owner_name}</strong>
                              <span>
                                {"rating" in item
                                  ? `Tenancy · ${formatDate(item.tenancy_start_date)} – ${formatDate(item.tenancy_end_date)}`
                                  : `Interaction · ${formatDate(item.interaction_date)}`}
                              </span>
                            </div>
                            {"rating" in item && (
                              <span
                                className="review-stars"
                                aria-label={`${item.rating} out of 5 stars`}
                              >
                                {"★".repeat(item.rating)}
                                <span>{"★".repeat(5 - item.rating)}</span>
                              </span>
                            )}
                          </div>
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
        <section className="values-strip">
          <div>
            <Icon name="chat" size={24} />
            <div>
              <h3>From people, for people.</h3>
              <p>Tenant stories and everyday interactions.</p>
            </div>
          </div>
          <div>
            <Icon name="shield" size={24} />
            <div>
              <h3>Your experience. Your privacy.</h3>
              <p>Personal details and documents stay private.</p>
            </div>
          </div>
          <div>
            <Icon name="home" size={24} />
            <div>
              <h3>A more informed next chapter.</h3>
              <p>A little knowledge before a big decision.</p>
            </div>
          </div>
        </section>
      </main>
      <footer className="site-footer">
        <a className="brand" href="/">
          <Icon name="home" size={20} />
          <span>
            rental<span className="brand-light">review</span>.
          </span>
        </a>
        <span>Good neighbours start with shared experiences.</span>
        <a href="/api/docs" target="_blank" rel="noreferrer">
          API documentation ↗
        </a>
      </footer>
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      {dialog === "signin" && (
        <SignIn
          onClose={() => setDialog(null)}
          onSuccess={(a) => {
            setAccount(a);
            setDialog(null);
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
                flat to see its experiences.
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

function formatDate(value: string) {
  return new Date(
    value.length === 10 ? `${value}T00:00:00` : value,
  ).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
    day: "numeric",
  });
}
