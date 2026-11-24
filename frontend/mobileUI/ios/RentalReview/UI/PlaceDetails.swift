import SwiftUI

/// A selected place: its flats, then the chosen flat's Tenant Reviews and
/// Interactions tabs, with sharing and editing for signed-in visitors.
struct PlaceDetails: View {
    @EnvironmentObject private var model: AppModel
    @State private var form: FeedbackTab?
    @State private var editing: Review?
    @State private var addingFlat = false
    /// A review or interaction opened on its own page.
    @State private var post: PostRef?

    var body: some View {
        if let place = model.selected {
            CompatNavigation {
                List {
                    Section {
                        VStack(alignment: .leading) {
                            Text(place.title).font(.title2.bold())
                            Text(place.address).foregroundStyle(Brand.muted)
                        }
                    }
                    Section("Flats") {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack {
                                ForEach(model.flats) { f in
                                    Button("Flat \(f.label)") { model.chooseFlat(f) }
                                        .buttonStyle(.bordered)
                                        .tint(f.id == model.flat?.id ? Brand.gold : Brand.muted)
                                }
                                Button("+ Add flat") { if model.account == nil { model.signIn() } else { addingFlat = true } }
                            }
                        }
                    }
                    Section {
                        Picker("Feedback", selection: $model.tab) {
                            Text("Tenant Reviews (\(model.flat?.summary.tenant_review_count ?? 0))").tag(FeedbackTab.tenant)
                            Text("Interactions (\(model.flat?.summary.interaction_review_count ?? 0))").tag(FeedbackTab.interaction)
                        }
                        .pickerStyle(.segmented)
                        Button(model.tab == .tenant ? "Share a review" : "Share an interaction") {
                            if model.account == nil { model.signIn() } else { form = model.tab }
                        }
                        .buttonStyle(.borderedProminent).tint(Brand.ink).disabled(model.flat == nil)
                    }
                    Section {
                        if model.detailLoading {
                            ProgressView()
                        } else if model.tab == .tenant {
                            if model.reviews.isEmpty { empty("No tenant reviews yet") }
                            ForEach(model.reviews) { r in
                                FeedbackCard(review: r, own: model.ownReviews[r.id], onEdit: { editing = $0 },
                                             onOpen: { post = PostRef(onReview: true, id: r.id) },
                                             footer: AnyView(DiscussionLink(count: r.comment_count ?? 0) {
                                                 post = PostRef(onReview: true, id: r.id)
                                             }))
                            }
                        } else {
                            if model.interactions.isEmpty { empty("No interactions yet") }
                            ForEach(model.interactions) { i in
                                FeedbackCard(interaction: i,
                                             onOpen: { post = PostRef(onReview: false, id: i.id) },
                                             footer: AnyView(DiscussionLink(count: i.comment_count ?? 0) {
                                                 post = PostRef(onReview: false, id: i.id)
                                             }))
                            }
                        }
                    }
                    .listRowSeparator(.hidden)
                }
                .navigationTitle(place.title).navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { model.closePlace() } } }
                // A post opens as its own page, like a building opens from the map;
                // the back button returns to the building.
                .pushes(isPresented: Binding(get: { post != nil }, set: { if !$0 { post = nil } })) {
                    if let post { PostPage(ref: post, onEdit: { editing = $0 }) }
                }
            }
            .sheet(item: $form) { FeedbackForm(tab: $0) }
            .sheet(item: $editing) { FeedbackForm(tab: .tenant, editing: $0) }
            .sheet(isPresented: $addingFlat) {
                TextPrompt(title: "Add a flat to \(place.title)", label: "Flat (e.g. A-204)", action: "Add", maxLength: 100) {
                    await model.addFlat($0)
                }
            }
        }
    }

    private func empty(_ title: String) -> some View {
        VStack(spacing: 4) {
            Text(title).bold()
            Text("Be the first to share your experience with this flat.").foregroundStyle(Brand.muted)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 16)
    }
}

extension FeedbackTab: Identifiable { var id: Int { rawValue } }

/// Which post is open: a review or an interaction, by id.
struct PostRef: Hashable {
    let onReview: Bool
    let id: String
}

/// One review or interaction on its own page, with its discussion.
private struct PostPage: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let ref: PostRef
    let onEdit: (Review) -> Void

    var body: some View {
        // Read from the flat's lists, so edits and comment counts stay current.
        let review = ref.onReview ? model.reviews.first { $0.id == ref.id } : nil
        let interaction = ref.onReview ? nil : model.interactions.first { $0.id == ref.id }
        List {
            if let place = model.selected {
                Section {
                    VStack(alignment: .leading, spacing: 2) {
                        Text((ref.onReview ? "Tenant review" : "Interaction") + (model.flat.map { " · Flat \($0.label)" } ?? ""))
                            .font(.footnote.bold()).foregroundColor(Brand.fair)
                        Text(place.title).font(.title2.bold())
                        Text(place.address).foregroundStyle(Brand.muted)
                    }
                }
            }
            if review != nil || interaction != nil {
                Section {
                    FeedbackCard(review: review, interaction: interaction,
                                 own: review.flatMap { model.ownReviews[$0.id] }, onEdit: onEdit)
                    Discussion(onReview: ref.onReview, subjectId: ref.id,
                               initialCount: review?.comment_count ?? interaction?.comment_count ?? 0)
                }
                .listRowSeparator(.hidden)
            }
        }
        .navigationTitle(ref.onReview ? "Tenant review" : "Interaction")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: review == nil && interaction == nil) { gone in
            // Deleted, or another flat chosen: back to the building.
            if gone { dismiss() }
        }
    }
}
