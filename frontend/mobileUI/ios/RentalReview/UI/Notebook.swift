import SwiftUI

private enum NotebookTab: Hashable { case reviews, interactions, places }

/// A7: the visitor's rental notebook: name, their reviews, interactions and
/// places, deletion requests, comments, admin queues, sign out and deactivate.
struct NotebookView: View {
    @EnvironmentObject private var model: AppModel
    @State private var tab = NotebookTab.reviews
    @State private var deactivating = false
    @State private var editingName = false
    @State private var requesting: Review?
    @State private var editing: Review?

    var body: some View {
        VStack(spacing: 0) {
            if let account = model.account {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        header(account)
                        SegmentedTabs(items: [(NotebookTab.reviews, "Reviews · \(model.notebook.reviews.count)"),
                                              (NotebookTab.interactions, "Interactions · \(model.notebook.interactions.count)"),
                                              (NotebookTab.places, "Places · \(model.notebook.flats.count)")],
                                      selection: $tab)
                        if model.notebookLoading { ProgressView().frame(maxWidth: .infinity) }
                        switch tab {
                        case .reviews: reviews
                        case .interactions: interactions
                        case .places: places
                        }
                        requests
                        comments
                        if account.isAdmin { admin }
                        accountActions
                    }
                    .padding(.horizontal, 20).padding(.top, 16).padding(.bottom, 24)
                }
                .refreshable { await model.loadNotebook() }
            } else {
                signedOut
            }
            TabBar(current: .notebook)
        }
        .background(Brand.goldWash.ignoresSafeArea())
        .sheet(item: $requesting) { r in
            TextPrompt(title: "Request deletion", label: "Why should this review be deleted?", action: "Send", maxLength: 10_000) {
                await model.requestDeletion(r, reason: $0)
            }
        }
        .sheet(item: $editing) { FeedbackForm(tab: .tenant, editing: $0).environmentObject(model) }
        .sheet(isPresented: $editingName) { NameSheet().environmentObject(model) }
    }

    private var signedOut: some View {
        VStack(spacing: 14) {
            Spacer()
            Image(systemName: "book.closed").font(.system(size: 40)).foregroundColor(Brand.fair).accessibilityHidden(true)
            Text("Your notebook").font(.system(size: 22, weight: .heavy)).foregroundColor(Brand.ink)
            Text("Sign in to keep the places you added, your reviews and your interactions in one place.")
                .font(.system(size: 15)).foregroundColor(Brand.muted).multilineTextAlignment(.center)
            Button("Sign in") { model.openNotebook() }.buttonStyle(PrimaryButtonStyle()).padding(.top, 6)
            Spacer()
        }
        .padding(.horizontal, 32)
    }

    private func header(_ account: Account) -> some View {
        HStack(spacing: 14) {
            Text(initial(account)).font(.system(size: 24, weight: .heavy)).foregroundColor(Brand.ink)
                .frame(width: 60, height: 60).background(Brand.gold, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("Your notebook").font(.system(size: 22, weight: .heavy)).foregroundColor(Brand.ink)
                    .accessibilityAddTraits(.isHeader)
                Text("Private — never shown on reviews").font(.system(size: 14)).foregroundColor(Brand.muted)
                Text([account.name, account.email].compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 13, weight: .medium)).foregroundColor(Brand.ink).lineLimit(1)
            }
            Spacer(minLength: 0)
            Button(account.name_is_custom == true ? "Edit name" : "Add your name") { editingName = true }
                .buttonStyle(OutlineButtonStyle(height: 40))
        }
    }

    // MARK: Tabs

    @ViewBuilder private var reviews: some View {
        if model.notebook.reviews.isEmpty && !model.notebookLoading { none("No tenant reviews yet.") }
        ForEach(model.notebook.reviews) { r in
            let pending = model.notebook.requests.contains { $0.tenant_review_id == r.id && $0.status == "pending" }
            VStack(alignment: .leading, spacing: 10) {
                Button {
                    if let id = r.location_id { model.openOwn(locationId: id, flatId: r.flat_id, tab: .tenant) }
                } label: {
                    HStack(spacing: 10) {
                        Text("\(r.rating)").font(.system(size: 14, weight: .heavy)).foregroundColor(.white)
                            .frame(minWidth: 30, minHeight: 30).padding(.horizontal, 2)
                            .background(ratingColor(Double(r.rating)), in: RoundedRectangle(cornerRadius: 9))
                            .accessibilityLabel("Rated \(r.rating) of 5")
                        VStack(alignment: .leading, spacing: 2) {
                            Text(placeTitle(r.place, "Tenant review")).font(.system(size: 15, weight: .bold)).foregroundColor(Brand.ink)
                            Text("\(monthYear(r.tenancy_start_date)) – \(monthYear(r.tenancy_end_date))")
                                .font(.system(size: 13)).foregroundColor(Brand.muted)
                        }
                        Spacer(minLength: 0)
                        if pending {
                            Text("Deletion pending").font(.system(size: 12, weight: .bold)).foregroundColor(Brand.pendingText)
                                .padding(.horizontal, 10).frame(height: 26).background(Brand.pendingFill, in: Capsule())
                        } else if r.location_id != nil {
                            Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundColor(Brand.muted)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityHint(r.location_id != nil ? "Opens the place" : "")
                Text(r.feedback).font(.system(size: 14)).foregroundColor(Brand.ink).lineLimit(3)
                if r.deleted_at != nil {
                    Text("Deleted after admin approval.").font(.system(size: 13)).foregroundColor(Brand.muted)
                } else if pending {
                    Text("Stays public until an admin approves your request.").font(.system(size: 13)).foregroundColor(Brand.muted)
                } else if r.can_edit == true {
                    Label("Editable until \(shortDate(r.editing_deadline))", systemImage: "calendar")
                        .font(.system(size: 13, weight: .semibold)).foregroundColor(Brand.fair)
                }
                if r.deleted_at == nil && !pending && (r.can_edit == true || r.can_request_deletion == true) {
                    HStack(spacing: 8) {
                        if r.can_edit == true {
                            Button("Edit review") { editing = r }.buttonStyle(InkButtonStyle(height: 40)).frame(maxWidth: .infinity)
                        }
                        if r.can_request_deletion == true {
                            Button("Request deletion") { requesting = r }.buttonStyle(OutlineButtonStyle(height: 40))
                                .frame(maxWidth: .infinity)
                        }
                    }
                }
            }
            .padding(14).frame(maxWidth: .infinity, alignment: .leading).card()
        }
    }

    @ViewBuilder private var interactions: some View {
        if model.notebook.interactions.isEmpty && !model.notebookLoading { none("No interactions shared yet.") }
        ForEach(model.notebook.interactions) { i in
            Button {
                if let id = i.location_id { model.openOwn(locationId: id, flatId: i.flat_id, tab: .interaction) }
            } label: {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(placeTitle(i.place, "Interaction")).font(.system(size: 15, weight: .bold)).foregroundColor(Brand.ink)
                            Text("On \(shortDate(i.interaction_date))").font(.system(size: 13)).foregroundColor(Brand.muted)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundColor(Brand.muted)
                    }
                    Text(i.description).font(.system(size: 14)).foregroundColor(Brand.ink).lineLimit(3)
                        .multilineTextAlignment(.leading)
                }
                .padding(14).frame(maxWidth: .infinity, alignment: .leading).card()
            }
            .buttonStyle(.plain)
        }
    }

    @ViewBuilder private var places: some View {
        if model.notebook.flats.isEmpty && !model.notebookLoading { none("You haven’t added a place yet.") }
        ForEach(model.notebook.flats) { f in
            Button { model.openOwn(locationId: f.location.id, flatId: f.id, tab: .tenant) } label: {
                HStack(spacing: 12) {
                    Image(systemName: "building.2").font(.system(size: 18, weight: .semibold)).foregroundColor(Brand.fair)
                        .frame(width: 36, height: 36).background(Brand.goldWash, in: RoundedRectangle(cornerRadius: 10))
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(f.location.title) · Flat \(f.label)").font(.system(size: 15, weight: .bold)).foregroundColor(Brand.ink)
                        Text(f.location.address).font(.system(size: 13)).foregroundColor(Brand.muted).lineLimit(1)
                        Text(f.added_place ? "You added this building" : "You added a flat here")
                            .font(.system(size: 12, weight: .semibold)).foregroundColor(Brand.fair)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundColor(Brand.muted)
                }
                .padding(14).frame(maxWidth: .infinity, alignment: .leading).card()
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: Other records

    @ViewBuilder private var requests: some View {
        let decided = model.notebook.requests.filter { $0.status != "pending" }
        if !decided.isEmpty {
            section("Deletion requests")
            ForEach(decided) { d in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(d.reason).font(.system(size: 14)).foregroundColor(Brand.ink).lineLimit(2)
                        Spacer(minLength: 0)
                        Text(d.status.capitalized).font(.system(size: 12, weight: .bold)).foregroundColor(.white)
                            .padding(.horizontal, 10).frame(height: 24)
                            .background(d.status == "approved" ? Brand.good : Brand.poor, in: Capsule())
                    }
                    if let note = d.decision_note { Text("Admin: \(note)").font(.system(size: 13)).foregroundColor(Brand.muted) }
                }
                .padding(14).frame(maxWidth: .infinity, alignment: .leading).card()
            }
        }
    }

    @ViewBuilder private var comments: some View {
        if !model.notebook.comments.isEmpty {
            section("Your comments")
            ForEach(model.notebook.comments) { c in
                VStack(alignment: .leading, spacing: 6) {
                    Text(c.place.map { "\($0.building_name ?? "Rental property") · Flat \($0.flat_label)" } ?? "Comment")
                        .font(.system(size: 15, weight: .bold)).foregroundColor(Brand.ink)
                    Text((c.onReview ? "On a tenant review" : "On an interaction") + " · \(shortDate(c.submitted_at))"
                         + (c.removed_at != nil ? " · Removed by an admin" : ""))
                        .font(.system(size: 13)).foregroundColor(Brand.muted)
                    Text(c.body).font(.system(size: 14)).foregroundColor(Brand.ink)
                    if c.removed_at == nil {
                        Button("Delete comment", role: .destructive) { model.deleteOwnComment(c) }
                            .font(.system(size: 14, weight: .semibold)).foregroundColor(Brand.poor).frame(minHeight: 44)
                    }
                }
                .padding(14).frame(maxWidth: .infinity, alignment: .leading).card()
            }
        }
    }

    @ViewBuilder private var admin: some View {
        section("Admin · Reported comments")
        if model.notebook.commentReports.isEmpty { none("No reported comments.") }
        ForEach(model.notebook.commentReports) { r in
            VStack(alignment: .leading, spacing: 6) {
                Text("\(r.place.building_name ?? "Rental property") · Flat \(r.place.flat_label)")
                    .font(.system(size: 15, weight: .bold)).foregroundColor(Brand.ink)
                Text((r.comment.onReview ? "On a tenant review: " : "On an interaction: ") + r.subject.text)
                    .font(.system(size: 13)).foregroundColor(Brand.muted).lineLimit(3)
                Text("“\(r.comment.body)”\nReason: \(r.reason)").font(.system(size: 14)).foregroundColor(Brand.ink)
                HStack(spacing: 8) {
                    Button("Remove") { model.decideReport(r, remove: true) }.buttonStyle(InkButtonStyle(height: 40)).frame(maxWidth: .infinity)
                    Button("Keep") { model.decideReport(r, remove: false) }.buttonStyle(OutlineButtonStyle(height: 40)).frame(maxWidth: .infinity)
                }
            }
            .padding(14).frame(maxWidth: .infinity, alignment: .leading).card()
        }
        section("Admin · Pending deletion requests")
        if model.notebook.adminRequests.isEmpty { none("You’re all caught up.") }
        ForEach(model.notebook.adminRequests) { d in
            VStack(alignment: .leading, spacing: 6) {
                if let review = d.review {
                    HStack(spacing: 8) { RatingChip(rating: review.rating); Text("Tenant review").font(.system(size: 15, weight: .bold)) }
                    Text(review.feedback).font(.system(size: 14)).lineLimit(4)
                }
                Text("Reason: \(d.reason)").font(.system(size: 13)).foregroundColor(Brand.muted)
                HStack(spacing: 8) {
                    Button("Approve") { model.decide(d, approve: true) }.buttonStyle(InkButtonStyle(height: 40)).frame(maxWidth: .infinity)
                    Button("Reject") { model.decide(d, approve: false) }.buttonStyle(OutlineButtonStyle(height: 40)).frame(maxWidth: .infinity)
                }
            }
            .foregroundColor(Brand.ink)
            .padding(14).frame(maxWidth: .infinity, alignment: .leading).card()
        }
    }

    @ViewBuilder private var accountActions: some View {
        if deactivating {
            VStack(alignment: .leading, spacing: 10) {
                Text("Deactivating ends all your sessions. Your tenant reviews and interactions remain visible.")
                    .font(.system(size: 14)).foregroundColor(Brand.ink)
                HStack(spacing: 8) {
                    Button("Confirm deactivation", action: model.deactivate)
                        .font(.system(size: 14, weight: .bold)).foregroundColor(.white)
                        .padding(.horizontal, 12).frame(maxWidth: .infinity, minHeight: 44)
                        .background(Brand.poor, in: RoundedRectangle(cornerRadius: 12))
                    Button("Cancel") { deactivating = false }.buttonStyle(OutlineButtonStyle()).frame(maxWidth: .infinity)
                }
            }
            .padding(14).card()
        }
        HStack {
            Button("Sign out", action: model.signOut).foregroundColor(Brand.ink)
            Spacer()
            if !deactivating { Button("Deactivate account") { deactivating = true }.foregroundColor(Brand.poor) }
        }
        .font(.system(size: 15, weight: .semibold)).frame(minHeight: 44).padding(.horizontal, 2)
        HStack(spacing: 20) {
            Button("Privacy Policy") { openWeb("/privacy") }
            Button("Delete your data") { openWeb("/delete-data") }
        }
        .font(.system(size: 13, weight: .semibold)).foregroundColor(Brand.muted).frame(minHeight: 44)
    }

    private func section(_ title: String) -> some View {
        Text(title).font(.system(size: 16, weight: .heavy)).foregroundColor(Brand.ink).padding(.top, 6)
            .accessibilityAddTraits(.isHeader)
    }

    private func none(_ text: String) -> some View {
        Text(text).font(.system(size: 14)).foregroundColor(Brand.muted).frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 8)
    }

    private func placeTitle(_ place: Place?, _ fallback: String) -> String {
        place.map { "\($0.building_name ?? "Rental property") · Flat \($0.flat_label)" } ?? fallback
    }
}

/// Edit name: private, never on reviews; "Use my Google name" resets it.
private struct NameSheet: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var busy = false

    var body: some View {
        CompatNavigation {
            Form {
                Section {
                    TextField("Your name", text: $name)
                } footer: {
                    Text("Only you see this. It never appears with your reviews.")
                }
                if model.account?.name_is_custom == true {
                    Button("Use my Google name") {
                        busy = true
                        Task { if await model.setName(nil) { dismiss() }; busy = false }
                    }
                }
            }
            .navigationTitle("Your name").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        busy = true
                        let value = name.trimmingCharacters(in: .whitespacesAndNewlines)
                        Task {
                            if await model.setName(value.isEmpty ? nil : String(value.prefix(200))) { dismiss() }
                            busy = false
                        }
                    }
                    .disabled(busy)
                }
            }
        }
        .sheetSizes([.medium])
        .onAppear { name = model.account?.name ?? "" }
    }
}
