import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  api,
  allPages,
  downloadFile,
  message,
  post,
  setToken,
  upload,
} from "./api";
import type {
  Account,
  Attachment,
  Deletion,
  Flat,
  Interaction,
  Review,
} from "./api";

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
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
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

export function ErrorNotice({ error }: { error: string }) {
  return error ? (
    <p className="error" role="alert">
      {error}
    </p>
  ) : null;
}

type AuthResult = { account: Account; session: { token: string } };
type Verification = AuthResult & { outcome: string; completion_token: string };

export function SignIn({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: (account: Account) => void;
}) {
  const [phone, setPhone] = useState("+91");
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState("");
  const [reactivation, setReactivation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  function signedIn(result: AuthResult) {
    setToken(result.session.token);
    onSuccess(result.account);
  }
  async function requestCode() {
    setError("");
    setBusy(true);
    try {
      const result = await post<{
        data: {
          challenge_id: string;
          development_code?: string;
          resend_available_at: string;
        };
      }>("/auth/otp/challenges", { mobile_number: phone });
      setChallenge(result.data.challenge_id);
      setDevCode(result.data.development_code || "");
      setCooldown(
        Math.max(
          0,
          Math.ceil(
            (new Date(result.data.resend_available_at).getTime() - Date.now()) /
              1000,
          ),
        ),
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!challenge) {
      await requestCode();
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (reactivation) {
        signedIn(
          (
            await post<{ data: AuthResult }>("/auth/reactivations", {
              completion_token: reactivation,
              confirm: true,
            })
          ).data,
        );
      } else {
        const result = (
          await post<{ data: Verification }>("/auth/otp/verifications", {
            challenge_id: challenge,
            code,
          })
        ).data;
        if (result.outcome === "signed_in") signedIn(result);
        else if (result.outcome === "registration_required") {
          signedIn(
            (
              await post<{ data: AuthResult }>("/auth/registrations", {
                completion_token: result.completion_token,
              })
            ).data,
          );
        } else setReactivation(result.completion_token);
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
      <p className="muted">
        Sign in or create an account with your mobile number. Your number stays
        private.
      </p>
      <form onSubmit={submit} className="form-stack">
        {!reactivation && (
          <label>
            Mobile number
            <input
              type="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98765 43210"
              required
              disabled={!!challenge}
            />
          </label>
        )}
        {challenge && !reactivation && (
          <>
            {devCode ? (
              <div className="dev-notice">
                Development SMS mode · Your code is <strong>{devCode}</strong>
              </div>
            ) : (
              <p>Enter the 6-digit code sent to your number.</p>
            )}
            <label>
              Verification code
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
            </label>
            <button
              type="button"
              className="text-button"
              disabled={busy || cooldown > 0}
              onClick={requestCode}
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
            </button>
          </>
        )}
        {reactivation && (
          <p>
            Your account is inactive. Reactivating restores your account and
            existing reviews. Original editing deadlines still apply.
          </p>
        )}
        <ErrorNotice error={error} />
        <button className="button" disabled={busy}>
          {busy
            ? "Please wait…"
            : reactivation
              ? "Reactivate my account"
              : challenge
                ? "Verify & continue"
                : "Send verification code"}
          <Icon name="arrow" size={18} />
        </button>
        {challenge && !reactivation && (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setChallenge("");
              setCode("");
              setError("");
            }}
          >
            Use a different number
          </button>
        )}
      </form>
      <p className="fine-print">
        <Icon name="shield" size={15} /> Your phone number is never shown with a
        review.
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
  const [proofRequired, setProofRequired] = useState(false);
  const [policyLoaded, setPolicyLoaded] = useState(
    kind === "interaction" || !!review,
  );
  useEffect(() => {
    if (kind === "tenant" && !review)
      api<{ data: { proof_required: boolean } }>("/review-submission-policy")
        .then((r) => {
          setProofRequired(r.data.proof_required);
          setPolicyLoaded(true);
        })
        .catch((e) => setError(message(e)));
  }, [kind, review]);
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
        const file = form.get("file") as File | null;
        const ids = file?.size
          ? [
              await upload(
                file,
                kind === "tenant" ? "tenancy_proof" : "interaction_support",
              ),
            ]
          : [];
        const common = { owner_name: form.get("owner_name") };
        const body =
          kind === "tenant"
            ? {
                ...common,
                rating,
                feedback: form.get("feedback"),
                tenancy_start_date: form.get("start"),
                tenancy_end_date: form.get("end"),
                proof_file_ids: ids,
              }
            : {
                ...common,
                description: form.get("feedback"),
                interaction_date: form.get("date"),
                supporting_file_ids: ids,
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
          : `Owner: ${review?.owner_name}`}
      </p>
      <form className="form-stack" onSubmit={submit}>
        {!review && (
          <label>
            Owner’s name
            <input
              name="owner_name"
              required
              maxLength={200}
              placeholder="The name of the owner you dealt with"
            />
          </label>
        )}
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
            placeholder="Helpful details make a difference. Share what went well and what could be better."
          />
        </label>
        {!review && (
          <label>
            {kind === "tenant"
              ? `Proof of tenancy (${proofRequired ? "required" : "optional"})`
              : "Supporting file (optional)"}
            <input
              type="file"
              name="file"
              accept="application/pdf,image/png,image/jpeg"
              required={kind === "tenant" && proofRequired}
            />
            <small>
              PDF, PNG, or JPEG · Up to 5 MB · Only you can access this file
            </small>
          </label>
        )}
        <ErrorNotice error={error} />
        <button className="button" disabled={busy || !policyLoaded}>
          {busy ? "Saving…" : review ? "Save changes" : "Publish review"}
          <Icon name="arrow" size={18} />
        </button>
        <p className="fine-print">
          {kind === "tenant"
            ? "Reviews are published immediately. Ratings and feedback can be edited for 30 days; tenancy dates stay fixed."
            : "One interaction review per person, per flat. Your review is public; supporting files stay private."}
        </p>
      </form>
    </Modal>
  );
}

export function AccountPanel({
  account,
  onClose,
  onLogout,
  onChanged,
}: {
  account: Account;
  onClose: () => void;
  onLogout: () => void;
  onChanged: () => void;
}) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [requests, setRequests] = useState<Deletion[]>([]);
  const [adminRequests, setAdminRequests] = useState<Deletion[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [editing, setEditing] = useState<Review | null>(null);
  const [requesting, setRequesting] = useState<Review | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  async function refresh() {
    setError("");
    try {
      const [own, ints, reqs, admin] = await Promise.all([
        allPages<Review>("/me/tenant-reviews"),
        allPages<Interaction>("/me/interactions"),
        allPages<Deletion>("/me/deletion-requests"),
        account.role === "admin"
          ? allPages<Deletion>("/admin/deletion-requests")
          : Promise.resolve([]),
      ]);
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
  async function loadAttachments(id: string) {
    setError("");
    try {
      setAttachments(
        await allPages<Attachment>(`/interactions/${id}/attachments`),
      );
      setExpanded(id);
    } catch (e) {
      setError(message(e));
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
        <span>{account.mobile_number}</span>
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
          <h3>Your tenant reviews</h3>
          {loaded && !reviews.length && (
            <p className="muted">Your rental experiences will appear here.</p>
          )}
          {reviews.map((review) => (
            <article key={review.id} className="account-record">
              <strong>
                {review.owner_name} · {"★".repeat(review.rating)}
              </strong>
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
              <strong>{interaction.owner_name}</strong>
              <p>{interaction.description}</p>
              <button
                className="text-button"
                onClick={() => void loadAttachments(interaction.id)}
              >
                Manage supporting files
              </button>
              {expanded === interaction.id && (
                <div className="attachment-list">
                  {attachments.map((attachment) => (
                    <div key={attachment.id}>
                      <button
                        className="text-button"
                        onClick={() =>
                          void run(() =>
                            downloadFile(
                              attachment.file.id,
                              attachment.file.original_filename,
                            ),
                          )
                        }
                      >
                        {attachment.file.original_filename}
                      </button>
                      <button
                        disabled={busy}
                        className="text-button danger-text"
                        onClick={() =>
                          void run(async () => {
                            await api(
                              `/interactions/${interaction.id}/attachments/${attachment.id}`,
                              { method: "DELETE" },
                            );
                            await loadAttachments(interaction.id);
                          })
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <label>
                    Add a private supporting file
                    <input
                      type="file"
                      accept="application/pdf,image/png,image/jpeg"
                      disabled={busy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file)
                          void run(async () => {
                            const file_id = await upload(
                              file,
                              "interaction_support",
                            );
                            await post(
                              `/interactions/${interaction.id}/attachments`,
                              { file_id },
                            );
                            await loadAttachments(interaction.id);
                          });
                      }}
                    />
                  </label>
                </div>
              )}
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
                  <strong>{request.review?.owner_name}</strong>
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
                  verifying your mobile number.
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
