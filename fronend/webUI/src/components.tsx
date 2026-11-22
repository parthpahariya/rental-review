import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { api, allPages, message, patch, post, setToken } from "./api";
import type {
  Account,
  Deletion,
  Flat,
  Interaction,
  Location,
  OwnFlat,
  Place,
  Review,
} from "./api";
import type { Point } from "./Map";
import GoogleButton from "./GoogleButton";
import { PATHS } from "./legal/site";

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    home: (
      <>
        <path d="m3 10 9-7 9 7" />
        <path d="M5 9v12h14V9M9 21v-8h6v8" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    pin: (
      <>
        <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
    arrow: (
      <>
        <path d="M4 12h16m-6-6 6 6-6 6" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    chat: (
      <>
        <path d="M21 11a8 8 0 0 1-8 8H7l-5 3 2-6a8 8 0 1 1 17-5Z" />
        <path d="M8 10h8m-8 4h5" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3 3 7v5c0 5 9 10 9 10s9-5 9-10V7Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 22v-3a8 8 0 0 1 16 0v3" />
      </>
    ),
    back: <path d="M15 5l-7 7 7 7" />,
    edit: (
      <>
        <path d="M4 20h4L19 9l-4-4L4 16Z" />
        <path d="m14 6 4 4" />
      </>
    ),
    chevron: <path d="m9 5 7 7-7 7" />,
    list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
    plus: <path d="M12 5v14M5 12h14" />,
    check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
    star: (
      <path
        d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z"
        fill="currentColor"
        stroke="none"
      />
    ),
    locate: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.home}
    </svg>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="dialog-title"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-heading">
        <h2 id="dialog-title">{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}

const shortDate = (value: string) =>
  new Date(
    value.length === 10 ? `${value}T00:00:00` : value,
  ).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/**
 * One tenant review or interaction on a flat's page:
 *
 *   (L)  OWNER                                    [Edit]
 *        Lakshmi Rao
 *   ★★★★★ 5.0   ( Tenancy  Feb 12, 2024 – Mar 11, 2025 )
 *   Feedback text…
 *   ─────────────────────────────────────────────────────
 *   Shared Nov 20, 2026     Your review · editable until Dec 20, 2026
 */
export function FeedbackCard({
  item,
  own,
  onEdit,
}: {
  item: Review | Interaction;
  /** The viewer's own copy of this review, when they wrote it. */
  own?: Review;
  onEdit: (review: Review) => void;
}) {
  const isReview = "rating" in item;
  return (
    <article
      className={`review-card ${isReview ? "" : "is-interaction"} ${own ? "is-own" : ""}`}
    >
      <header className="review-card-head">
        <span className="avatar" aria-hidden="true">
          <Icon name={isReview ? "home" : "chat"} size={16} />
        </span>
        <span className="review-who">
          <strong>{isReview ? "Tenant review" : "Interaction"}</strong>
        </span>
        {own?.can_edit && (
          <button
            className="edit-review"
            onClick={() => onEdit(own)}
            aria-label="Edit your review"
          >
            <Icon name="edit" size={14} /> Edit
          </button>
        )}
      </header>
      <div className="review-meta">
        {isReview && (
          <span
            className="review-rating"
            role="img"
            aria-label={`${item.rating} out of 5 stars`}
          >
            <span className="stars" aria-hidden="true">
              {[1, 2, 3, 4, 5].map((n) => (
                <span key={n} className={n <= item.rating ? "on" : ""}>
                  <Icon name="star" size={14} />
                </span>
              ))}
            </span>
            <b aria-hidden="true">{item.rating}.0</b>
          </span>
        )}
        <span className="review-chip">
          {isReview ? (
            <>
              <span className="review-chip-label">Tenancy</span>
              <span className="nowrap">
                {shortDate(item.tenancy_start_date)}
              </span>
              {" – "}
              <span className="nowrap">{shortDate(item.tenancy_end_date)}</span>
            </>
          ) : (
            <>
              <span className="review-chip-label">Interaction</span>
              <span className="nowrap">{shortDate(item.interaction_date)}</span>
            </>
          )}
        </span>
      </div>
      <p className="review-body">
        {"feedback" in item ? item.feedback : item.description}
      </p>
      <footer className="review-card-foot">
        <span className="nowrap">Shared {shortDate(item.submitted_at)}</span>
        {own && (
          <span className="yours">
            Your review
            {own.can_edit && (
              <span className="nowrap">
                {" "}
                · editable until {shortDate(own.editing_deadline)}
              </span>
            )}
          </span>
        )}
      </footer>
    </article>
  );
}

export function ErrorNotice({ error }: { error: string }) {
  return error ? (
    <p className="error" role="alert">
      {error}
    </p>
  ) : null;
}

type AuthResult = { account: Account; session: { token: string } };

export function SignIn({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: (account: Account) => void;
}) {
  /** Google credential held while an inactive account confirms reactivation. */
  const [reactivation, setReactivation] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function google(credential: string, reactivate = false) {
    setError("");
    setBusy(true);
    try {
      const result = (
        await post<{ data: Partial<AuthResult> & { outcome: string } }>(
          "/auth/google",
          { credential, reactivate },
        )
      ).data;
      if (result.outcome === "reactivation_required")
        setReactivation(credential);
      else {
        setToken(result.session!.token);
        onSuccess(result.account!);
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={reactivation ? "Welcome back" : "A little trust starts with you"}
      onClose={onClose}
    >
      {reactivation ? (
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void google(reactivation, true);
          }}
        >
          <p>
            Your account is inactive. Reactivating restores your account and
            existing reviews. Original editing deadlines still apply.
          </p>
          <ErrorNotice error={error} />
          <button className="button" disabled={busy}>
            {busy ? "Please wait…" : "Reactivate my account"}
            <Icon name="arrow" size={18} />
          </button>
        </form>
      ) : (
        <>
          <p className="muted">
            Sign in or create an account with your Google account. It takes one
            tap, and your email stays private.
          </p>
          {unavailable ? (
            <p className="error" role="alert">
              Google sign-in isn’t available right now. Please try again later.
            </p>
          ) : (
            <GoogleButton
              onCredential={(c) => void google(c)}
              onUnavailable={() => setUnavailable(true)}
              disabled={busy}
            />
          )}
          {busy && (
            <p className="muted" role="status">
              Signing you in…
            </p>
          )}
          <ErrorNotice error={error} />
        </>
      )}
      <p className="fine-print">
        <Icon name="shield" size={15} /> Your email is never shown with a
        review. By continuing you agree to our{" "}
        <a href={PATHS.privacy} target="_blank" rel="noreferrer">
          Privacy Policy
        </a>
        .
      </p>
    </Modal>
  );
}

export function ReviewForm({
  flat,
  kind,
  onClose,
  onSuccess,
  review,
}: {
  flat?: Flat;
  kind: "tenant" | "interaction";
  onClose: () => void;
  onSuccess: () => void;
  review?: Review;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rating, setRating] = useState(review?.rating || 5);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      if (review) {
        await api(`/tenant-reviews/${review.id}`, {
          method: "PATCH",
          body: JSON.stringify({ rating, feedback: form.get("feedback") }),
        });
      } else {
        const body =
          kind === "tenant"
            ? {
                rating,
                feedback: form.get("feedback"),
                tenancy_start_date: form.get("start"),
                tenancy_end_date: form.get("end"),
              }
            : {
                description: form.get("feedback"),
                interaction_date: form.get("date"),
              };
        await post(
          `/flats/${flat!.id}/${kind === "tenant" ? "tenant-reviews" : "interactions"}`,
          body,
        );
      }
      onSuccess();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        review
          ? "Edit your review"
          : kind === "tenant"
            ? "Share your rental experience"
            : "Share an interaction"
      }
      onClose={onClose}
    >
      <p className="muted">
        {flat
          ? `${flat.location.building_name || flat.location.address} · Flat ${flat.label}`
          : "Change your rating or what you wrote."}
      </p>
      <form className="form-stack" onSubmit={submit}>
        {kind === "tenant" && (
          <>
            <fieldset className="rating-input">
              <legend>Your rating</legend>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  type="button"
                  key={n}
                  aria-label={`${n} ${n === 1 ? "star" : "stars"}`}
                  aria-pressed={rating === n}
                  className={n <= rating ? "filled" : ""}
                  onClick={() => setRating(n)}
                >
                  ★
                </button>
              ))}
            </fieldset>
            {!review && (
              <div className="form-row">
                <label>
                  Tenancy start
                  <input type="date" name="start" required />
                </label>
                <label>
                  Tenancy end
                  <input type="date" name="end" required />
                </label>
              </div>
            )}
          </>
        )}
        {kind === "interaction" && (
          <label>
            Interaction date
            <input type="date" name="date" required />
          </label>
        )}
        <label>
          {kind === "tenant" ? "Your experience" : "What happened?"}
          <textarea
            name="feedback"
            rows={5}
            required
            maxLength={10000}
            defaultValue={review?.feedback}
            placeholder="Describe your own experience of the flat: repairs, deposit, communication. Stick to facts, and don’t name people or share contact details."
          />
        </label>
        <ErrorNotice error={error} />
        <button className="button" disabled={busy}>
          {busy ? "Saving…" : review ? "Save changes" : "Publish review"}
          <Icon name="arrow" size={18} />
        </button>
        <p className="fine-print">
          {kind === "tenant"
            ? "Reviews are published immediately. Ratings and feedback can be edited for 30 days; tenancy dates stay fixed."
            : "One interaction review per person, per flat. It is published for everyone to read."}
        </p>
      </form>
    </Modal>
  );
}

/** "Lakeview Residency · Flat 3B", opening that place on the map when clicked. */
function PlaceLink({ place, onOpen }: { place: Place; onOpen: () => void }) {
  return (
    <button className="place-link" onClick={onOpen}>
      <Icon name="pin" size={15} />
      <span>
        <strong>
          {place.building_name || "Rental property"} · Flat {place.flat_label}
        </strong>
        <small>{place.address}</small>
      </span>
      <Icon name="chevron" size={16} />
    </button>
  );
}

export function AccountPanel({
  account,
  onClose,
  onLogout,
  onChanged,
  onOpen,
  onAccount,
}: {
  account: Account;
  onClose: () => void;
  onLogout: () => void;
  onChanged: () => void;
  /** Called with the updated account after the user renames themselves. */
  onAccount: (account: Account) => void;
  /** Shows a place on the map with the given flat (and tab) selected. */
  onOpen: (
    locationId: string,
    flatId: string,
    tab: "tenant" | "interaction",
  ) => void;
}) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [added, setAdded] = useState<OwnFlat[]>([]);
  const [renaming, setRenaming] = useState(false);
  async function saveName(name: string | null) {
    setBusy(true);
    setError("");
    try {
      onAccount((await patch<{ data: Account }>("/me", { name })).data);
      setRenaming(false);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [requests, setRequests] = useState<Deletion[]>([]);
  const [adminRequests, setAdminRequests] = useState<Deletion[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [editing, setEditing] = useState<Review | null>(null);
  const [requesting, setRequesting] = useState<Review | null>(null);
  async function refresh() {
    setError("");
    try {
      const [own, ints, reqs, admin, flats] = await Promise.all([
        allPages<Review>("/me/tenant-reviews"),
        allPages<Interaction>("/me/interactions"),
        allPages<Deletion>("/me/deletion-requests"),
        account.role === "admin"
          ? allPages<Deletion>("/admin/deletion-requests")
          : Promise.resolve([]),
        allPages<OwnFlat>("/me/flats"),
      ]);
      setAdded(flats);
      setReviews(own);
      setInteractions(ints);
      setRequests(reqs);
      setAdminRequests(admin);
      setLoaded(true);
    } catch (e) {
      setError(message(e));
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  async function run(action: () => Promise<unknown>, endsSession = false) {
    setBusy(true);
    setError("");
    try {
      await action();
      if (endsSession) {
        onLogout();
        return;
      }
      await refresh();
      onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  if (editing)
    return (
      <ReviewForm
        kind="tenant"
        review={editing}
        onClose={() => setEditing(null)}
        onSuccess={() => {
          setEditing(null);
          void refresh();
          onChanged();
        }}
      />
    );
  return (
    <Modal title="Your rental notebook" onClose={onClose}>
      <div className="account-bar">
        {renaming ? (
          <form
            className="form-stack name-form"
            onSubmit={(e) => {
              e.preventDefault();
              const name = String(
                new FormData(e.currentTarget).get("name") || "",
              ).trim();
              void saveName(name || null);
            }}
          >
            <label>
              Your name
              <input
                name="name"
                maxLength={200}
                autoFocus
                defaultValue={account.name || ""}
                placeholder="How you’d like to be called"
              />
            </label>
            <small>
              Only you see this. It never appears with your reviews.
            </small>
            <div className="inline-actions">
              <button className="button small" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => setRenaming(false)}
              >
                Cancel
              </button>
              {account.name_is_custom && (
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => void saveName(null)}
                >
                  Use my Google name
                </button>
              )}
            </div>
          </form>
        ) : (
          <span className="account-who">
            {account.name && <strong>{account.name}</strong>}
            <span>{account.email}</span>
            <button
              type="button"
              className="text-button edit-name"
              onClick={() => setRenaming(true)}
            >
              <Icon name="edit" size={14} />{" "}
              {account.name ? "Edit name" : "Add your name"}
            </button>
          </span>
        )}
        <button
          disabled={busy}
          className="text-button"
          onClick={() =>
            run(async () => {
              await api("/auth/session", { method: "DELETE" });
            }, true)
          }
        >
          Sign out
        </button>
      </div>
      <ErrorNotice error={error} />
      {!loaded && !error && <p role="status">Loading your reviews…</p>}
      {requesting ? (
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            const reason = new FormData(e.currentTarget).get("reason");
            void run(async () => {
              await post(`/tenant-reviews/${requesting.id}/deletion-requests`, {
                reason,
              });
              setRequesting(null);
            });
          }}
        >
          <h3>Request review deletion</h3>
          <p>The review stays visible until an admin approves your request.</p>
          <label>
            Reason
            <textarea name="reason" required rows={3} maxLength={10000} />
          </label>
          <button className="button" disabled={busy}>
            Send request
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => setRequesting(null)}
          >
            Cancel
          </button>
        </form>
      ) : (
        <>
          {added.length > 0 && (
            <>
              <h3>Places you added</h3>
              {groupByLocation(added).map(([location, flats]) => (
                <article key={location.id} className="account-record">
                  <span className="badge sentence">
                    {flats.some((f) => f.added_place)
                      ? "You added this building"
                      : "You added a flat here"}
                  </span>
                  {flats.map((f) => (
                    <PlaceLink
                      key={f.id}
                      place={{
                        building_name: location.building_name,
                        address: location.address,
                        flat_label: f.label,
                      }}
                      onOpen={() => onOpen(location.id, f.id, "tenant")}
                    />
                  ))}
                </article>
              ))}
            </>
          )}
          <h3>Your tenant reviews</h3>
          {loaded && !reviews.length && (
            <p className="muted">Your rental experiences will appear here.</p>
          )}
          {reviews.map((review) => (
            <article key={review.id} className="account-record">
              {review.place && review.location_id && (
                <PlaceLink
                  place={review.place}
                  onOpen={() =>
                    onOpen(review.location_id!, review.flat_id, "tenant")
                  }
                />
              )}
              <strong>{"★".repeat(review.rating)}</strong>
              <p>{review.feedback}</p>
              <small>
                {review.deleted_at
                  ? "Deleted after admin approval"
                  : `Editing closes ${new Date(review.editing_deadline).toLocaleDateString()}`}
              </small>
              <div className="inline-actions">
                {review.can_edit && (
                  <button
                    className="text-button"
                    onClick={() => setEditing(review)}
                  >
                    Edit review
                  </button>
                )}
                {review.can_request_deletion && (
                  <button
                    className="text-button"
                    onClick={() => setRequesting(review)}
                  >
                    Request deletion
                  </button>
                )}
              </div>
            </article>
          ))}
          <h3>Your interactions</h3>
          {loaded && !interactions.length && (
            <p className="muted">No interactions shared yet.</p>
          )}
          {interactions.map((interaction) => (
            <article key={interaction.id} className="account-record">
              {interaction.place && interaction.location_id && (
                <PlaceLink
                  place={interaction.place}
                  onOpen={() =>
                    onOpen(
                      interaction.location_id!,
                      interaction.flat_id,
                      "interaction",
                    )
                  }
                />
              )}
              <p>{interaction.description}</p>
            </article>
          ))}
          {requests.length > 0 && (
            <>
              <h3>Deletion requests</h3>
              {requests.map((request) => (
                <article className="account-record" key={request.id}>
                  <span className="badge">{request.status}</span>
                  <p>{request.reason}</p>
                  {request.decision_note && (
                    <small>Admin: {request.decision_note}</small>
                  )}
                </article>
              ))}
            </>
          )}
          {account.role === "admin" && (
            <>
              <h3>Admin · Pending deletion requests</h3>
              {!adminRequests.length && loaded && (
                <p className="muted">You’re all caught up.</p>
              )}
              {adminRequests.map((request) => (
                <article className="account-record" key={request.id}>
                  <strong>
                    {request.review && "★".repeat(request.review.rating)}
                  </strong>
                  <p>{request.review?.feedback}</p>
                  <p>Reason: {request.reason}</p>
                  <div className="inline-actions">
                    {["approved", "rejected"].map((decision) => (
                      <button
                        key={decision}
                        disabled={busy}
                        className="button small"
                        onClick={() =>
                          void run(() =>
                            post(
                              `/admin/deletion-requests/${request.id}/decision`,
                              { decision },
                            ),
                          )
                        }
                      >
                        {decision === "approved"
                          ? "Approve deletion"
                          : "Reject request"}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </>
          )}
          <div className="deactivation-box">
            {deactivating ? (
              <>
                <p>
                  Deactivating ends all your sessions. Your tenant reviews and
                  interaction reviews remain public. You can reactivate by
                  signing in with Google again.
                </p>
                <div className="inline-actions">
                  <button
                    className="button danger"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await post("/me/deactivation", { confirm: true });
                      }, true)
                    }
                  >
                    Confirm deactivation
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setDeactivating(false)}
                  >
                    Keep account
                  </button>
                </div>
              </>
            ) : (
              <button
                className="text-button danger-text"
                onClick={() => setDeactivating(true)}
              >
                Deactivate account
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

export function AddPlaceForm({
  point,
  nearby,
  onClose,
  onUseExisting,
  onCreated,
}: {
  point: Point;
  nearby: Location[];
  onClose: () => void;
  onUseExisting: (location: Location) => void;
  onCreated: (flat: Flat) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const building = String(form.get("building_name") || "").trim();
    try {
      const result = await post<{ data: Flat }>("/locations", {
        address: form.get("address"),
        building_name: building || null,
        flat_label: form.get("flat_label"),
        latitude: point.latitude,
        longitude: point.longitude,
      });
      onCreated(result.data);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Add a new place" onClose={onClose}>
      <p className="muted">
        Pinned at {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}.
        Close this to drag the pin if it isn’t quite right.
      </p>
      {nearby.length > 0 && (
        <div className="nearby-places">
          <strong>Already on the map nearby</strong>
          {nearby.map((location) => (
            <button
              key={location.id}
              type="button"
              className="nearby-place"
              onClick={() => onUseExisting(location)}
            >
              <span>
                {location.building_name || "Rental property"}
                <small>{location.address}</small>
              </span>
              <span className="text-button">Review this place</span>
            </button>
          ))}
        </div>
      )}
      <form className="form-stack" onSubmit={submit}>
        <label>
          Building name{nearby.length > 0 ? "" : " (optional)"}
          <input
            name="building_name"
            maxLength={200}
            placeholder="e.g. Lakeview Residency"
            required={nearby.length > 0}
            aria-describedby={
              nearby.length > 0 ? "building-name-hint" : undefined
            }
          />
        </label>
        {nearby.length > 0 && (
          <p className="muted fine-print" id="building-name-hint">
            Not one of the places above? Give your building its name so it can
            be added next to them.
          </p>
        )}
        <label>
          Address
          <input
            name="address"
            required
            maxLength={500}
            placeholder="Street, area and city"
          />
        </label>
        <label>
          Flat
          <input
            name="flat_label"
            required
            maxLength={100}
            placeholder="e.g. 3B, 204, Ground floor"
          />
          <small>Reviews are kept separately for each flat.</small>
        </label>
        <ErrorNotice error={error} />
        <button className="button" disabled={busy}>
          {busy ? "Adding…" : "Add place and write a review"}
          <Icon name="arrow" size={18} />
        </button>
      </form>
    </Modal>
  );
}

/** Lets the person who added a place fix its details and their flat's number. */
function groupByLocation(flats: OwnFlat[]): [Location, OwnFlat[]][] {
  const groups = new Map<string, [Location, OwnFlat[]]>();
  for (const f of flats) {
    const group = groups.get(f.location.id) ?? [f.location, []];
    group[1].push(f);
    groups.set(f.location.id, group);
  }
  return [...groups.values()];
}

export function EditPlaceForm({
  location,
  flat,
  canEditLocation,
  canEditFlat,
  onClose,
  onSaved,
  onMovePin,
}: {
  location: Location;
  flat: Flat | null;
  canEditLocation: boolean;
  canEditFlat: boolean;
  onClose: () => void;
  onSaved: (location: Location | null, flat: Flat | null) => void;
  onMovePin: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      let savedLocation: Location | null = null;
      let savedFlat: Flat | null = null;
      if (canEditLocation) {
        const name = String(form.get("building_name") || "").trim() || null;
        const address = String(form.get("address") || "").trim();
        const changes: Record<string, string | null> = {};
        if (name !== (location.building_name || null))
          changes.building_name = name;
        if (address !== location.address) changes.address = address;
        if (Object.keys(changes).length)
          savedLocation = (
            await patch<{ data: Location }>(
              `/locations/${location.id}`,
              changes,
            )
          ).data;
      }
      if (canEditFlat && flat) {
        const label = String(form.get("flat_label") || "").trim();
        if (label !== flat.label)
          savedFlat = (
            await patch<{ data: Flat }>(`/flats/${flat.id}`, { label })
          ).data;
      }
      onSaved(savedLocation, savedFlat);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Edit your place" onClose={onClose}>
      <p className="muted">
        You can change what you added until someone else reviews it.
      </p>
      <form className="form-stack" onSubmit={submit}>
        {canEditLocation && (
          <>
            <label>
              Building name (optional)
              <input
                name="building_name"
                maxLength={200}
                defaultValue={location.building_name || ""}
                placeholder="e.g. Lakeview Residency"
              />
            </label>
            <label>
              Address
              <input
                name="address"
                required
                maxLength={500}
                defaultValue={location.address}
              />
            </label>
          </>
        )}
        {canEditFlat && flat && (
          <label>
            Flat
            <input
              name="flat_label"
              required
              maxLength={100}
              defaultValue={flat.label}
            />
          </label>
        )}
        <ErrorNotice error={error} />
        <button className="button" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
          <Icon name="check" size={18} />
        </button>
        {canEditLocation && (
          <button type="button" className="text-button" onClick={onMovePin}>
            <Icon name="pin" size={16} /> Move the pin on the map
          </button>
        )}
      </form>
    </Modal>
  );
}

export function AddFlatForm({
  location,
  onClose,
  onCreated,
}: {
  location: Location;
  onClose: () => void;
  onCreated: (flat: Flat) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await post<{ data: Flat }>(
        `/locations/${location.id}/flats`,
        { label: new FormData(e.currentTarget).get("label") },
      );
      onCreated(result.data);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Add your flat" onClose={onClose}>
      <p className="muted">{location.building_name || location.address}</p>
      <form className="form-stack" onSubmit={submit}>
        <label>
          Flat
          <input
            name="label"
            required
            maxLength={100}
            placeholder="e.g. 3B, 204, Ground floor"
          />
        </label>
        <ErrorNotice error={error} />
        <button className="button" disabled={busy}>
          {busy ? "Adding…" : "Add flat and write a review"}
          <Icon name="arrow" size={18} />
        </button>
      </form>
    </Modal>
  );
}
