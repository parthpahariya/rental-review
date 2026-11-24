import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { allPages, message, patch, post, remove } from "./api";
import type { Account, Comment, Interaction, Review } from "./api";
import { ErrorNotice, Icon, shortDate } from "./components";

const MAX_COMMENT = 2000;

/**
 * On a flat's page: how many comments a post has, opening the post's own page,
 * where its discussion is.
 */
export function DiscussionLink({
  subject,
  onOpen,
}: {
  subject: Review | Interaction;
  onOpen: () => void;
}) {
  const count = subject.comment_count ?? 0;
  return (
    <button type="button" className="discussion-link" onClick={onOpen}>
      <Icon name="chat" size={15} />
      {count
        ? `Discussion · ${count} ${count === 1 ? "comment" : "comments"}`
        : "Discuss"}
      <Icon name="chevron" size={14} />
    </button>
  );
}

/**
 * The public discussion under one tenant review or interaction, on the post's
 * own page: a flat list of comments, oldest first.
 */
export default function Discussion({
  subject,
  account,
  onSignIn,
  onChange,
}: {
  subject: Review | Interaction;
  account: Account | null;
  onSignIn: () => void;
  /** After a comment is added or deleted, e.g. to refresh counts. */
  onChange?: () => void;
}) {
  const isReview = "rating" in subject;
  const base = `/${isReview ? "tenant-reviews" : "interactions"}/${subject.id}`;
  const [count, setCount] = useState(subject.comment_count ?? 0);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(
    null,
  );
  const [reporting, setReporting] = useState<{
    id: string;
    reason: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(
    () => setCount(subject.comment_count ?? 0),
    [subject.comment_count],
  );

  async function load() {
    setError("");
    try {
      const rows = await allPages<Comment>(`${base}/comments`);
      setComments(rows);
      setCount(rows.length);
    } catch (e) {
      setError(message(e));
    }
  }
  // Reload when the viewer signs in or out: "mine" and editing rights change.
  useEffect(() => {
    void load();
  }, [subject.id, account?.id]);

  async function run(action: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await load();
      onChange?.();
      if (done) setNotice(done);
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    if (await run(() => post(`${base}/comments`, { body }))) setDraft("");
  }

  const authorLabel = isReview
    ? "Wrote this review"
    : "Shared this interaction";

  return (
    <section
      className="discussion"
      aria-labelledby={`discussion-${subject.id}`}
    >
      <h3 className="discussion-title" id={`discussion-${subject.id}`}>
        Discussion
        {count > 0 && <span className="count">{count}</span>}
      </h3>
      <div className="discussion-body">
        {comments === null && !error && (
          <p className="muted">Loading the discussion…</p>
        )}
        {comments?.length === 0 && (
          <p className="muted">
            No comments yet. Ask a question or add context.
          </p>
        )}
        {!!comments?.length && (
          <ol className="comment-list">
            {comments.map((c) => (
              <li key={c.id} className={`comment ${c.mine ? "is-own" : ""}`}>
                <div className="comment-meta">
                  {c.by_subject_author && (
                    <span className="badge comment-badge">{authorLabel}</span>
                  )}
                  {c.mine && <span className="badge">You</span>}
                  <span className="nowrap">{shortDate(c.submitted_at)}</span>
                  {c.edited && <span>· edited</span>}
                </div>
                {editing?.id === c.id ? (
                  <form
                    className="comment-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const body = editing.body.trim();
                      if (body)
                        void run(() =>
                          patch(`/comments/${c.id}`, { body }),
                        ).then((ok) => ok && setEditing(null));
                    }}
                  >
                    <label className="sr-only" htmlFor={`edit-${c.id}`}>
                      Edit your comment
                    </label>
                    <textarea
                      id={`edit-${c.id}`}
                      value={editing.body}
                      maxLength={MAX_COMMENT}
                      rows={3}
                      onChange={(e) =>
                        setEditing({ id: c.id, body: e.target.value })
                      }
                    />
                    <div className="inline-actions">
                      <button
                        className="button small"
                        disabled={busy || !editing.body.trim()}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setEditing(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <p className="comment-body">{c.body}</p>
                )}
                {reporting?.id === c.id && (
                  <form
                    className="comment-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const reason = reporting.reason.trim();
                      if (reason)
                        void run(
                          () => post(`/comments/${c.id}/reports`, { reason }),
                          "Thanks. An admin will review this comment.",
                        ).then((ok) => ok && setReporting(null));
                    }}
                  >
                    <label htmlFor={`report-${c.id}`}>
                      Why should an admin review this comment?
                    </label>
                    <textarea
                      id={`report-${c.id}`}
                      value={reporting.reason}
                      rows={2}
                      maxLength={MAX_COMMENT}
                      onChange={(e) =>
                        setReporting({ id: c.id, reason: e.target.value })
                      }
                    />
                    <div className="inline-actions">
                      <button
                        className="button small"
                        disabled={busy || !reporting.reason.trim()}
                      >
                        Send report
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setReporting(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
                {editing?.id !== c.id && reporting?.id !== c.id && (
                  <div className="comment-actions">
                    {c.can_edit && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => {
                          setReporting(null);
                          setEditing({ id: c.id, body: c.body });
                        }}
                      >
                        Edit
                      </button>
                    )}
                    {c.mine && (
                      <button
                        type="button"
                        className="text-button danger-text"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm("Delete your comment?"))
                            void run(() => remove(`/comments/${c.id}`));
                        }}
                      >
                        Delete
                      </button>
                    )}
                    {account && !c.mine && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => {
                          setEditing(null);
                          setReporting({ id: c.id, reason: "" });
                        }}
                      >
                        Report
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
        {notice && (
          <p className="comment-notice" role="status">
            {notice}
          </p>
        )}
        <ErrorNotice error={error} />
        {account ? (
          <form className="comment-form" onSubmit={submit}>
            <label htmlFor={`comment-${subject.id}`}>Add a comment</label>
            <textarea
              id={`comment-${subject.id}`}
              value={draft}
              rows={2}
              maxLength={MAX_COMMENT}
              placeholder="Ask a question or add context."
              onChange={(e) => setDraft(e.target.value)}
            />
            <small className="muted">
              Comments are public. Stick to facts, and don’t name people or
              share contact details.
            </small>
            <div className="inline-actions">
              <button className="button small" disabled={busy || !draft.trim()}>
                {busy ? "Posting…" : "Post comment"}
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="button small" onClick={onSignIn}>
            Sign in to join the discussion
          </button>
        )}
      </div>
    </section>
  );
}
