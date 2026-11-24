import { useEffect, useRef, useState } from "react";
import {
  AccountPanel,
  AddFlatForm,
  AddPlaceForm,
  EditPlaceForm,
  ErrorNotice,
  FeedbackCard,
  Icon,
  Modal,
  ReviewForm,
  SignIn,
} from "./components";
import PropertyMap from "./Map";
import Discussion, { DiscussionLink } from "./Discussion";
import LocalitySearch, { DEFAULT_CENTER } from "./LocalitySearch";
import type { Area } from "./LocalitySearch";
import type { Bounds, Focus, MapView, Point } from "./Map";
import {
  api,
  allPages,
  hasToken,
  message,
  patch,
  setToken,
  somePages,
} from "./api";
import type {
  Account,
  Flat,
  Interaction,
  Location,
  Permissions,
  Review,
} from "./api";
import { formatCount, plural } from "./format";
import { readUrlState, writeUrlState } from "./urlState";
import { PATHS } from "./legal/site";

export default function App() {
  // Only the places inside the visible map area: the full catalogue is far
  // too large (crores of buildings) to download.
  const [locations, setLocations] = useState<Location[]>([]);
  const [more, setMore] = useState(false);
  // A refresh or shared link reopens the spot saved in the address bar.
  const [restored] = useState(readUrlState);
  // The map stays hidden until the visitor picks a locality to look at.
  const [area, setArea] = useState<Area | null>(() =>
    restored.at
      ? {
          name: restored.area || "This map area",
          center: restored.at,
          zoom: restored.at.zoom,
        }
      : null,
  );
  const [focus, setFocus] = useState<Focus | null>(() =>
    restored.at
      ? { key: 1, center: restored.at, zoom: restored.at.zoom }
      : null,
  );
  const [selected, setSelected] = useState<Location | null>(null);
  const [flats, setFlats] = useState<Flat[]>([]);
  const [flat, setFlat] = useState<Flat | null>(null);
  const [tab, setTab] = useState<"tenant" | "interaction">("tenant");
  const [reviews, setReviews] = useState<Review[]>([]);
  /** The signed-in user's own reviews of the selected flat, by id. */
  const [mine, setMine] = useState<Map<string, Review>>(new Map());
  const [editingReview, setEditingReview] = useState<Review | null>(null);
  /** A review or interaction opened on its own page, with its discussion. */
  const [post, setPost] = useState<Review | Interaction | null>(null);
  function openPost(item: Review | Interaction) {
    setPost(item);
    if (listHidden) toggleList(false);
    if (panelRef.current) panelRef.current.scrollTop = 0;
  }
  function closePost() {
    setPost(null);
    if (panelRef.current) panelRef.current.scrollTop = 0;
  }
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [draft, setDraft] = useState<Point | null>(null);
  const [view, setView] = useState<MapView | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("nearest");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [flatsVersion, setFlatsVersion] = useState(0);
  // On wide screens the results card floats over the map's left side.
  const [inset, setInset] = useState(floatingInset);
  // The visitor can hide the results/details panel to see more map.
  const [listHidden, setListHidden] = useState(() => {
    try {
      return localStorage.getItem("rental-list-hidden") === "1";
    } catch {
      return false;
    }
  });
  function toggleList(hidden: boolean) {
    setListHidden(hidden);
    try {
      localStorage.setItem("rental-list-hidden", hidden ? "1" : "0");
    } catch {
      // Private mode: the choice just isn't remembered.
    }
  }
  useEffect(() => {
    const update = () => setInset(floatingInset());
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  // The visitor's own position, only if they already allowed location access
  // (we never prompt for it just to rank suggestions).
  const [userPoint, setUserPoint] = useState<Point | null>(null);
  useEffect(() => {
    let live = true;
    navigator.permissions
      ?.query({ name: "geolocation" as PermissionName })
      .then((status) => {
        if (status.state !== "granted" || !live) return;
        navigator.geolocation.getCurrentPosition(
          (p) =>
            live &&
            setUserPoint({
              latitude: p.coords.latitude,
              longitude: p.coords.longitude,
            }),
          () => {},
          { timeout: 10000, maximumAge: 600000 },
        );
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  // Flat to open after a reload, and the dialog to resume after signing in.
  const wantFlat = useRef<string | null>(restored.flat);
  const afterSignIn = useRef<Dialog | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [version, setVersion] = useState(0);
  /** What the signed-in user may edit at the selected place, if anything. */
  const [perms, setPerms] = useState<Permissions | null>(null);
  /** True while the place's creator drags its pin to a new spot. */
  const [moving, setMoving] = useState(false);
  const [savingPin, setSavingPin] = useState(false);
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
    // Reopen the place that was open before the refresh.
    if (!restored.place) return;
    let live = true;
    api<{ data: Location }>(`/locations/${restored.place}`)
      .then((r) => {
        if (live) selectLocation(r.data);
      })
      .catch(() => {
        // It may have been removed; the map area still opens.
      });
    return () => {
      live = false;
    };
  }, []);
  // Reopen a post from the address bar (a refresh or shared link).
  useEffect(() => {
    const wanted = restored.post;
    if (!wanted) return;
    let live = true;
    const path =
      wanted.kind === "review"
        ? `/tenant-reviews/${wanted.id}`
        : `/interactions/${wanted.id}`;
    api<{ data: Review | Interaction }>(path)
      .then((r) => {
        if (live) setPost(r.data);
      })
      .catch(() => {
        // Deleted since; the place still opens.
      });
    return () => {
      live = false;
    };
  }, []);
  // A post belongs to one place: leaving that place closes it.
  useEffect(() => {
    if (
      post &&
      selected &&
      post.location_id &&
      post.location_id !== selected.id
    )
      setPost(null);
  }, [selected?.id]);
  useEffect(() => {
    writeUrlState({
      at: !area
        ? null
        : view
          ? { ...view.center, zoom: view.zoom ?? area.zoom ?? 15 }
          : { ...area.center, zoom: area.zoom ?? 15 },
      area: area?.name ?? null,
      place: area ? (selected?.id ?? null) : null,
      flat: flat?.id ?? null,
      post: post
        ? { kind: "rating" in post ? "review" : "interaction", id: post.id }
        : null,
    });
  }, [area, view, selected?.id, flat?.id, post?.id]);
  // Where search suggestions are centred: on the map, its current centre;
  // on the home page, the visitor's position if known, else the default city.
  const searchNear: Point = area
    ? (view?.center ?? area.center)
    : (userPoint ?? DEFAULT_CENTER.center);
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
    setPerms(null);
    if (!selected || !account) return;
    let live = true;
    api<{ data: Permissions }>(`/locations/${selected.id}/permissions`)
      .then((r) => {
        if (live && Array.isArray(r.data?.editable_flat_ids)) setPerms(r.data);
      })
      .catch(() => {
        // Without permissions the place simply shows no edit button.
      });
    return () => {
      live = false;
    };
  }, [selected?.id, account?.id, flatsVersion, version]);
  useEffect(() => {
    setMine(new Map());
    if (!flat || !account) return;
    let live = true;
    allPages<Review>(`/me/tenant-reviews?flat_id=${flat.id}`)
      .then((rows) => {
        if (live) setMine(new Map(rows.map((r) => [r.id, r])));
      })
      .catch(() => {
        // Without this, the reviews simply show no edit buttons.
      });
    return () => {
      live = false;
    };
  }, [flat?.id, account?.id, version]);
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
    setMoving(false);
    setSelected(location);
    // Opening a place always shows its details, even if the list was hidden.
    if (listHidden) toggleList(false);
    // Details replace the list in the side panel; start them from the top.
    if (panelRef.current) panelRef.current.scrollTop = 0;
  }
  function openArea(next: Area) {
    // "Use my location" gives us the visitor's position; keep it for suggestions.
    if (next.name === "Near you") setUserPoint(next.center);
    setArea(next);
    setSelected(null);
    setDraft(null);
    setMoving(false);
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
  /** Opens a place from the notebook with that flat and tab showing. */
  async function openOwn(
    locationId: string,
    flatId: string,
    kind: "tenant" | "interaction",
  ) {
    try {
      const place = (await api<{ data: Location }>(`/locations/${locationId}`))
        .data;
      setDialog(null);
      setTab(kind);
      wantFlat.current = flatId;
      if (selected?.id === place.id) {
        // Same place already open: just switch to the flat.
        setFlat(flats.find((f) => f.id === flatId) || flat);
        wantFlat.current = null;
      } else openPlace(place);
    } catch (e) {
      setNotice(message(e));
    }
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
  /** Sign in and come back to the same view, e.g. to join a discussion. */
  function signInOnly() {
    afterSignIn.current = null;
    setDialog("signin");
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
  // Infinite scroll: list 20 more whenever the end of the list comes near view.
  // Observing against the viewport also covers the panel's own scroll area,
  // since anything scrolled out of it counts as hidden.
  const listEnd = useRef<HTMLDivElement>(null);
  const hasMore = sorted.length > listed.length;
  useEffect(() => {
    const end = listEnd.current;
    if (!end || !hasMore || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting))
          setShown((n) => n + PAGE_SIZE);
      },
      { rootMargin: "0px 0px 400px 0px" },
    );
    observer.observe(end);
    return () => observer.disconnect();
  }, [hasMore, listed.length, loading]);
  const totalReviews = visible.reduce(
    (sum, location) =>
      sum +
      location.summary.tenant_review_count +
      location.summary.interaction_review_count,
    0,
  );
  const items = tab === "tenant" ? reviews : interactions;
  // The open post, kept current as the flat's lists reload (edits, comment counts).
  const shownPost =
    post &&
    (("rating" in post ? reviews : interactions).find(
      (i) => i.id === post.id,
    ) ??
      post);
  const postFlat = post && flats.find((f) => f.id === post.flat_id);
  const closeDetails = () => {
    setPost(null);
    setSelected(null);
    setFlat(null);
    setDraft(null);
    setMoving(false);
  };
  const canEditFlat = !!flat && !!perms?.editable_flat_ids.includes(flat.id);
  const canEdit = !!perms?.can_edit_location || canEditFlat;
  function placeEdited(location: Location | null, edited: Flat | null) {
    setDialog(null);
    if (location && selected)
      setSelected({ ...selected, ...location, summary: selected.summary });
    if (edited) {
      wantFlat.current = edited.id;
      setFlatsVersion((v) => v + 1);
    }
    if (location) setVersion((v) => v + 1); // Refresh pins and the list.
    if (location || edited) setNotice("Your changes are saved.");
  }
  function startMovingPin() {
    if (!selected) return;
    setDialog(null);
    setMoving(true);
    setDraft({ latitude: selected.latitude, longitude: selected.longitude });
  }
  async function savePin() {
    if (!selected || !draft) return;
    setSavingPin(true);
    try {
      const moved = (
        await patch<{ data: Location }>(`/locations/${selected.id}`, {
          latitude: draft.latitude,
          longitude: draft.longitude,
        })
      ).data;
      setMoving(false);
      setDraft(null);
      placeEdited(moved, null);
    } catch (e) {
      setNotice(message(e));
    } finally {
      setSavingPin(false);
    }
  }
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
              onBrowseAll={browseAll}
              near={searchNear}
            />
          </div>
        )}
        <nav className="topbar-nav" aria-label="Main navigation">
          {/* The area being explored lives here, beside the profile; clicking
              it moves to the search box to pick another one. */}
          {area && (
            <button
              className="location-chip"
              onClick={changeArea}
              title={area.detail ? `${area.name}, ${area.detail}` : area.name}
              aria-label={`Area: ${area.name}. Change area`}
            >
              <Icon name="pin" size={16} />
              <span>{area.name}</span>
            </button>
          )}
          {/* The explainer is for first-time visitors on the home page only. */}
          {!area && (
            <button className="nav-link" onClick={() => setDialog("about")}>
              How it works
            </button>
          )}
          {account ? (
            <button
              className="profile-button"
              onClick={() => setDialog("account")}
              aria-label="Your account"
              title={account.name || account.email || "Your account"}
            >
              {initial(account) || <Icon name="user" size={20} />}
            </button>
          ) : (
            <button
              className="button secondary"
              onClick={() => setDialog("signin")}
            >
              <Icon name="user" size={18} />
              <span>Sign in</span>
            </button>
          )}
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
                Buildings across India, rated by the people who lived there. See
                what past tenants say about an owner — deposits, repairs, rent
                hikes — before you sign anything.
              </p>
              <LocalitySearch
                onArea={openArea}
                onBrowseAll={browseAll}
                near={searchNear}
              />
            </div>
          </section>
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
                It takes two minutes. Your review is public; your email and
                documents never are.
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
            <nav className="footer-links" aria-label="About this site">
              <a href={PATHS.privacy}>Privacy Policy</a>
              <a href={PATHS.deleteData}>Delete your data</a>
            </nav>
          </footer>
        </main>
      ) : (
        <main className={`explore ${listHidden ? "list-hidden" : ""}`}>
          <div className="panel" id="panel" ref={panelRef} hidden={listHidden}>
            {!selected ? (
              <section
                className="results"
                aria-label="Properties, accessible alternative to the map"
              >
                <div className="panel-head">
                  <div className="panel-top">
                    {/* Not shown, but announced so screen-reader users hear the
                        list change as the map moves. */}
                    <p className="panel-count sr-only" aria-live="polite">
                      {loading
                        ? "Loading…"
                        : `${plural(visible.length, "place")}${more ? "+" : ""} in this area · ${plural(totalReviews, "experience")}`}
                    </p>
                    {/* Sort on the left, Hide list on the right, one row. */}
                    {!loading && visible.length > 1 && (
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
                    )}
                    <button
                      className="hide-list"
                      onClick={() => toggleList(true)}
                      aria-controls="panel"
                      aria-label="Hide list"
                      title="Hide list"
                    >
                      <Icon name="close" size={18} />
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
                        Move the map to another area, or tap it to add a place
                        here.
                      </p>
                    </div>
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
                  {!loading && hasMore && (
                    <div className="list-end" ref={listEnd} role="status">
                      Loading more places…
                    </div>
                  )}
                </div>
              </section>
            ) : shownPost ? (
              <section
                className="detail post-page"
                aria-label={
                  "rating" in shownPost
                    ? "Tenant review and its discussion"
                    : "Interaction and its discussion"
                }
              >
                <div className="panel-top">
                  <button className="back-link" onClick={closePost}>
                    <Icon name="back" size={18} /> Back to{" "}
                    {selected.building_name || "this property"}
                  </button>
                  <button
                    className="hide-list"
                    onClick={() => toggleList(true)}
                    aria-controls="panel"
                    aria-label="Hide details"
                    title="Hide details"
                  >
                    <Icon name="close" size={18} />
                  </button>
                </div>
                <header className="detail-head">
                  <p className="post-kicker">
                    {"rating" in shownPost ? "Tenant review" : "Interaction"}
                    {postFlat && ` · Flat ${postFlat.label}`}
                  </p>
                  <h2>{selected.building_name || "Rental property"}</h2>
                  <p>
                    <Icon name="pin" size={16} /> {selected.address}
                  </p>
                </header>
                <FeedbackCard
                  item={shownPost}
                  own={mine.get(shownPost.id)}
                  onEdit={setEditingReview}
                />
                <Discussion
                  subject={shownPost}
                  account={account}
                  onSignIn={signInOnly}
                  onChange={() => setVersion((v) => v + 1)}
                />
              </section>
            ) : (
              <section
                className="detail"
                aria-label="Selected property details"
              >
                <div className="panel-top">
                  <button className="back-link" onClick={closeDetails}>
                    <Icon name="back" size={18} /> Back to results
                  </button>
                  <button
                    className="hide-list"
                    onClick={() => toggleList(true)}
                    aria-controls="panel"
                    aria-label="Hide details"
                    title="Hide details"
                  >
                    <Icon name="close" size={18} />
                  </button>
                </div>
                <header className="detail-head">
                  <h2>{selected.building_name || "Rental property"}</h2>
                  <p>
                    <Icon name="pin" size={16} /> {selected.address}
                  </p>
                  {canEdit && (
                    <button
                      className="text-button edit-place"
                      onClick={() => setDialog("edit")}
                    >
                      <Icon name="edit" size={16} /> Edit what you added
                    </button>
                  )}
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
                            <FeedbackCard
                              key={item.id}
                              item={item}
                              own={mine.get(item.id)}
                              onEdit={setEditingReview}
                              onOpen={() => openPost(item)}
                            >
                              <DiscussionLink
                                subject={item}
                                onOpen={() => openPost(item)}
                              />
                            </FeedbackCard>
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
                if (moving) {
                  setDraft(point);
                  return;
                }
                setSelected(null);
                setDraft(point);
              }}
              onViewChange={setView}
              partial={more}
              insetLeft={listHidden ? 0 : inset}
              focus={focus}
              searched={area?.exact ? area.center : null}
              highlighted={hovered}
              onHover={setHovered}
            />
            {listHidden && (
              <button
                className="show-list"
                onClick={() => toggleList(false)}
                aria-controls="panel"
                aria-expanded="false"
              >
                <Icon name="list" size={18} />
                {selected
                  ? "Show details"
                  : `Show list · ${plural(visible.length, "place")}${more ? "+" : ""}`}
              </button>
            )}
            {!draft && (
              <p className="map-hint">
                <Icon name="pin" size={14} /> Tap a pin to read reviews · tap
                anywhere to add a place
              </p>
            )}
            {draft && moving && (
              <div className="draft-card" role="group" aria-label="Move pin">
                <div>
                  <strong>
                    Move {selected?.building_name || "your place"}
                  </strong>
                  <span>Drag the pin, or tap the map, then save.</span>
                </div>
                <div className="draft-actions">
                  <button
                    className="button ghost small"
                    onClick={() => {
                      setMoving(false);
                      setDraft(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="button small"
                    disabled={savingPin}
                    onClick={() => void savePin()}
                  >
                    {savingPin ? "Saving…" : "Save pin"}
                    <Icon name="check" size={16} />
                  </button>
                </div>
              </div>
            )}
            {draft && !moving && (
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
          onOpen={(locationId, flatId, kind) =>
            void openOwn(locationId, flatId, kind)
          }
          onAccount={setAccount}
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
      {editingReview && (
        <ReviewForm
          kind="tenant"
          review={editingReview}
          onClose={() => setEditingReview(null)}
          onSuccess={() => {
            setEditingReview(null);
            setVersion((v) => v + 1);
            setNotice("Your review is updated.");
          }}
        />
      )}
      {dialog === "edit" && selected && (
        <EditPlaceForm
          location={selected}
          flat={flat}
          canEditLocation={!!perms?.can_edit_location}
          canEditFlat={canEditFlat}
          onClose={() => setDialog(null)}
          onSaved={placeEdited}
          onMovePin={startMovingPin}
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
                Sign in with Google to share. Reviews are public, while your
                name and email stay private.
              </p>
            </li>
          </ol>
        </Modal>
      )}
    </>
  );
}

const PAGE_SIZE = 20;
/** Up to 500 pins per view; denser views ask the visitor to zoom in. */
const MAX_PAGES = 5;
/** A first map query for an area, before the map has reported its view. */
/** First letter of the account's name, else of its email ("" if neither). */
function initial(account: Account) {
  const source = (account.name || account.email || "").trim();
  return source ? [...source][0].toLocaleUpperCase() : "";
}

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

type Dialog =
  "signin" | "account" | "review" | "place" | "flat" | "edit" | "about";

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

/** National rating summary for the landing page, from server-side totals. */
