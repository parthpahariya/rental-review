import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Discussion, { DiscussionLink } from "./Discussion";
import type { Account, Comment, Review } from "./api";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const review: Review = {
  id: "r1",
  flat_id: "f1",
  rating: 3,
  feedback: "Deposit took a while.",
  tenancy_start_date: "2024-01-01",
  tenancy_end_date: "2025-01-01",
  submitted_at: "2026-11-01T00:00:00Z",
  editing_deadline: "2026-12-01T00:00:00Z",
  comment_count: 2,
};
const account: Account = {
  id: "u1",
  email: "me@example.com",
  role: "user",
  status: "active",
};

function comment(changes: Partial<Comment>): Comment {
  return {
    id: "c1",
    subject_type: "tenant_review",
    tenant_review_id: "r1",
    interaction_id: null,
    body: "How long did it take?",
    submitted_at: "2026-11-02T00:00:00Z",
    edited: false,
    editing_deadline: "2026-12-02T00:00:00Z",
    by_subject_author: false,
    ...changes,
  };
}

/** A fake API: GET returns `rows`; other calls are recorded and succeed. */
function serve(rows: Comment[]) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      calls.push({
        method,
        url,
        body: init.body && JSON.parse(String(init.body)),
      });
      const json =
        method === "GET"
          ? { data: rows, page: { next_cursor: null } }
          : { data: comment({ id: "new", mine: true, can_edit: true }) };
      return Promise.resolve(
        new Response(method === "DELETE" ? null : JSON.stringify(json), {
          status: method === "DELETE" ? 204 : method === "POST" ? 201 : 200,
        }),
      );
    }),
  );
  return calls;
}

describe("Discussion", () => {
  it("links from a post with its comment count", async () => {
    const onOpen = vi.fn();
    render(<DiscussionLink subject={review} onOpen={onOpen} />);
    await userEvent.click(
      screen.getByRole("button", { name: /Discussion · 2 comments/ }),
    );
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("lists comments oldest first and asks signed-out visitors to sign in", async () => {
    const calls = serve([
      comment({ id: "c1" }),
      comment({ id: "c2", body: "About six weeks.", by_subject_author: true }),
    ]);
    render(<Discussion subject={review} account={null} onSignIn={() => {}} />);
    expect(
      screen.getByRole("heading", { name: /Discussion/ }),
    ).toBeInTheDocument();
    const items = await screen.findAllByRole("listitem");
    expect(
      items.map((li) => li.querySelector(".comment-body")?.textContent),
    ).toEqual(["How long did it take?", "About six weeks."]);
    expect(screen.getByText("Wrote this review")).toBeInTheDocument();
    expect(calls[0].url).toContain("/api/v1/tenant-reviews/r1/comments");
    // Signed out: no posting, reporting or editing; a sign-in button instead.
    expect(screen.queryByLabelText("Add a comment")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Report" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign in to join the discussion" }),
    ).toBeInTheDocument();
  });

  it("posts a comment, edits and deletes your own, and reports others'", async () => {
    const calls = serve([
      comment({ id: "theirs" }),
      comment({ id: "mine", body: "My note", mine: true, can_edit: true }),
    ]);
    vi.stubGlobal("confirm", () => true);
    const changed = vi.fn();
    render(
      <Discussion
        subject={review}
        account={account}
        onSignIn={() => {}}
        onChange={changed}
      />,
    );
    await screen.findAllByRole("listitem");

    await userEvent.type(
      screen.getByLabelText("Add a comment"),
      "  Was parking included? ",
    );
    await userEvent.click(screen.getByRole("button", { name: "Post comment" }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === "POST")).toMatchObject({
        url: "/api/v1/tenant-reviews/r1/comments",
        body: { body: "Was parking included?" },
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const editBox = screen.getByLabelText("Edit your comment");
    await userEvent.clear(editBox);
    await userEvent.type(editBox, "Updated");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === "PATCH")).toMatchObject({
        url: "/api/v1/comments/mine",
        body: { body: "Updated" },
      }),
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Delete" }),
    );
    await waitFor(() =>
      expect(calls.find((c) => c.method === "DELETE")?.url).toBe(
        "/api/v1/comments/mine",
      ),
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Report" }),
    );
    await userEvent.type(
      screen.getByLabelText("Why should an admin review this comment?"),
      "Names a person",
    );
    await userEvent.click(screen.getByRole("button", { name: "Send report" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "An admin will review",
    );
    expect(changed).toHaveBeenCalled();
    expect(calls.at(-2)).toMatchObject({
      method: "POST",
      url: "/api/v1/comments/theirs/reports",
      body: { reason: "Names a person" },
    });
  });
});
