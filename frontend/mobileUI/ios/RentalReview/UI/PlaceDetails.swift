import SwiftUI

/// A selected place: its flats, then the chosen flat's Tenant Reviews and
/// Interactions tabs, with sharing and editing for signed-in visitors.
struct PlaceDetails: View {
    @Environment(AppModel.self) private var model
    @State private var form: FeedbackTab?
    @State private var editing: Review?
    @State private var addingFlat = false

    var body: some View {
        @Bindable var model = model
        if let place = model.selected {
            NavigationStack {
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
                                FeedbackCard(review: r, own: model.ownReviews[r.id]) { editing = $0 }
                            }
                        } else {
                            if model.interactions.isEmpty { empty("No interactions yet") }
                            ForEach(model.interactions) { FeedbackCard(interaction: $0) }
                        }
                    }
                    .listRowSeparator(.hidden)
                }
                .navigationTitle("").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { model.closePlace() } } }
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
