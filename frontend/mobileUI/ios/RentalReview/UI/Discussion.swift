import SwiftUI

private let maxComment = 2000

/// The public discussion under one tenant review or interaction: comments oldest
/// first. Collapsed until opened, so a flat's page loads no comments it does not show.
/// Buttons are borderless because the card sits in a List row, where bordered
/// buttons would all fire on any tap in the row.
struct Discussion: View {
    @EnvironmentObject private var model: AppModel
    let onReview: Bool
    let subjectId: String
    let initialCount: Int

    @State private var open = false
    @State private var count: Int?
    @State private var comments: [Comment]?
    @State private var draft = ""
    @State private var busy = false
    @State private var editing: Comment?
    @State private var reporting: Comment?
    @State private var deleting: Comment?

    private var shownCount: Int { count ?? initialCount }
    private var authorLabel: String { onReview ? "Wrote this review" : "Shared this interaction" }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Divider().padding(.top, 4)
            Button {
                open.toggle()
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "bubble.left.and.bubble.right")
                    Text(shownCount > 0
                         ? "Discussion · \(shownCount) \(shownCount == 1 ? "comment" : "comments")"
                         : "Discuss").font(.subheadline.weight(.semibold))
                    Image(systemName: open ? "chevron.up" : "chevron.down").font(.caption)
                }
                .foregroundColor(Brand.ink)
            }
            .buttonStyle(.borderless)
            .accessibilityHint(open ? "Hides the discussion" : "Shows the discussion")

            if open { content }
        }
        .task(id: "\(open)-\(model.account?.id ?? "")") {
            // Reload when opened, and when the visitor signs in or out ("mine" changes).
            if open { await reload() }
        }
        .sheet(item: $editing) { c in
            TextPrompt(title: "Edit your comment", label: "Comment", action: "Save", maxLength: maxComment,
                       initial: c.body) { body in
                await change { await model.editComment(c, body: body) }
            }
        }
        .sheet(item: $reporting) { c in
            TextPrompt(title: "Report this comment", label: "Why should an admin review it?",
                       action: "Send", maxLength: maxComment) { reason in
                await change { await model.reportComment(c, reason: reason) }
            }
        }
        .alert("Delete your comment?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
            Button("Delete", role: .destructive) {
                if let c = deleting { Task { await change { await model.deleteComment(c) } } }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("It is removed from the discussion for everyone.")
        }
    }

    @ViewBuilder private var content: some View {
        if let comments {
            if comments.isEmpty {
                Text("No comments yet. Ask a question or add context.").font(.footnote).foregroundStyle(Brand.muted)
            }
            ForEach(comments) { c in row(c) }
        } else {
            Text("Loading the discussion…").font(.footnote).foregroundStyle(Brand.muted)
        }
        if model.account != nil {
            MultilineField(placeholder: "Ask a question or add context.", text: $draft, minLines: 2, maxLines: 6)
                .padding(8)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Brand.line))
                .onChange(of: draft) { if $0.count > maxComment { draft = String($0.prefix(maxComment)) } }
            Text("Comments are public. Stick to facts, and don’t name people or share contact details.")
                .font(.caption).foregroundStyle(Brand.muted)
            Button(busy ? "Posting…" : "Post comment") {
                let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
                Task {
                    if await change({ await model.postComment(onReview: onReview, subjectId: subjectId, body: body) }) {
                        draft = ""
                    }
                }
            }
            .buttonStyle(.borderless)
            .font(.subheadline.bold())
            .disabled(busy || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        } else {
            Button("Sign in to join the discussion") { model.signIn() }
                .buttonStyle(.borderless).font(.subheadline.bold())
        }
    }

    private func row(_ c: Comment) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                if c.by_subject_author == true { pill(authorLabel, Color(red: 0.11, green: 0.31, blue: 0.85)) }
                if c.mine == true { pill("You", Brand.fair) }
                Text(shortDate(c.submitted_at) + (c.edited == true ? " · edited" : ""))
                    .font(.caption).foregroundStyle(Brand.muted)
            }
            Text(c.body).font(.subheadline)
            HStack(spacing: 16) {
                if c.can_edit == true { Button("Edit") { editing = c } }
                if c.mine == true { Button("Delete", role: .destructive) { deleting = c }.disabled(busy) }
                if model.account != nil && c.mine != true { Button("Report") { reporting = c } }
            }
            .buttonStyle(.borderless).font(.caption)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(c.mine == true ? Brand.goldWash : Color(red: 0.97, green: 0.96, blue: 0.94),
                    in: RoundedRectangle(cornerRadius: 10))
    }

    private func pill(_ text: String, _ color: Color) -> some View {
        Text(text).font(.caption2.bold()).foregroundColor(.white)
            .padding(.horizontal, 8).padding(.vertical, 2).background(color, in: Capsule())
    }

    private func reload() async {
        if let rows = await model.comments(onReview: onReview, subjectId: subjectId) {
            comments = rows
            count = rows.count
        }
    }

    /// Runs a change, then reloads the discussion; returns whether it worked.
    @discardableResult
    private func change(_ action: () async -> Bool) async -> Bool {
        busy = true
        defer { busy = false }
        guard await action() else { return false }
        await reload()
        return true
    }
}
