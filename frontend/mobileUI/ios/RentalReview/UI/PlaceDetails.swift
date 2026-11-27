import MapKit
import SwiftUI

/// A3: a place's details over whatever screen opened it. No map here: an ink
/// band heads the page, and Directions hands off to Apple Maps.
struct PlaceDetails: View {
    @EnvironmentObject private var model: AppModel
    @State private var form: FeedbackTab?
    @State private var editing: Review?
    @State private var addingFlat = false
    @State private var editingPlace = false
    /// A review or interaction opened on its own page.
    @State private var post: PostRef?

    var body: some View {
        CompatNavigation {
            main
                .navigationBarHidden(true)
                // A post opens as its own page; the back button returns to the building.
                .pushes(isPresented: Binding(get: { post != nil }, set: { if !$0 { post = nil } })) {
                    if let post { PostPage(ref: post, onEdit: { editing = $0 }).navigationBarHidden(false) }
                }
        }
        .modifier(AppChrome(active: form == nil && editing == nil && !addingFlat && !editingPlace, toastBottom: 110))
        .sheet(item: $form) { FeedbackForm(tab: $0).environmentObject(model) }
        .sheet(item: $editing) { FeedbackForm(tab: .tenant, editing: $0).environmentObject(model) }
        .sheet(isPresented: $addingFlat) {
            TextPrompt(title: "Add your flat to \(model.selected?.title ?? "this building")", label: "Flat (e.g. A-204)",
                       action: "Add", maxLength: 100) { await model.addFlat($0) }
        }
        .sheet(isPresented: $editingPlace) { EditPlaceForm().environmentObject(model) }
        .onAppear(perform: openAutoForm)
        .onChange(of: model.autoForm != nil && model.flat != nil && !model.detailLoading) { _ in openAutoForm() }
        .onChange(of: addingFlat) { open in if !open { openAutoForm() } }
    }

    /// After adding a place or a flat, the review form opens straight away.
    private func openAutoForm() {
        guard let next = model.autoForm, model.flat != nil, !model.detailLoading, form == nil, !addingFlat else { return }
        model.autoForm = nil
        // Let a closing sheet finish before opening the form.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { form = next }
    }

    @ViewBuilder private var main: some View {
        if let place = model.selected {
            VStack(spacing: 0) {
                ZStack(alignment: .top) {
                    ZStack { Brand.ink; BuildingLines() }
                        .frame(height: 150).frame(maxHeight: .infinity, alignment: .top)
                        .ignoresSafeArea(edges: .top)
                    ScrollView {
                        VStack(spacing: 0) {
                            Color.clear.frame(height: 96)
                            panel(place)
                                .padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 24)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(TopRounded(radius: 26).fill(Brand.goldWash))
                        }
                        .background(VStack(spacing: 0) { Color.clear.frame(height: 140); Brand.goldWash })
                    }
                    HStack {
                        CircleButton(systemImage: "chevron.left", label: "Back", size: 44) { model.closePlace() }
                        Spacer()
                        CircleButton(systemImage: "square.and.arrow.up", label: "Share this place", size: 44) { share(place) }
                    }
                    .padding(.horizontal, 16).padding(.top, 4)
                }
                bottomBar(place)
            }
            .background(Brand.goldWash.ignoresSafeArea())
        }
    }

    private func panel(_ place: Location) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text(place.title).font(.system(size: 26, weight: .heavy)).foregroundColor(Brand.ink)
                    .fixedSize(horizontal: false, vertical: true).accessibilityAddTraits(.isHeader)
                HStack(alignment: .center, spacing: 10) {
                    Text(place.address).font(.system(size: 14)).foregroundColor(Brand.muted)
                        .frame(maxWidth: .infinity, alignment: .leading).fixedSize(horizontal: false, vertical: true)
                    Button { directions(place) } label: {
                        Label("Directions", systemImage: "arrow.triangle.turn.up.right.diamond")
                            .font(.system(size: 13, weight: .bold)).foregroundColor(Brand.ink)
                            .padding(.horizontal, 12).frame(height: 36)
                            .background(.white, in: Capsule()).overlay(Capsule().stroke(Brand.line))
                            .frame(minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Opens Apple Maps")
                }
            }
            tiles(place.summary ?? Summary())
            if canEdit {
                Button { editingPlace = true } label: {
                    Label("Edit what you added", systemImage: "pencil").frame(maxWidth: .infinity)
                }
                .buttonStyle(OutlineButtonStyle(height: 44))
            }
            flats
            SegmentedTabs(items: [(FeedbackTab.tenant, "Tenant reviews · \(model.flat?.summary.tenant_review_count ?? model.reviews.count)"),
                                  (FeedbackTab.interaction, "Interactions · \(model.flat?.summary.interaction_review_count ?? model.interactions.count)")],
                          selection: $model.tab)
            feedback
        }
    }

    private var canEdit: Bool {
        guard let p = model.permissions else { return false }
        return p.can_edit_location || model.flat.map { p.editable_flat_ids.contains($0.id) } == true
    }

    private func tiles(_ s: Summary) -> some View {
        HStack(spacing: 8) {
            tile(s.average_rating.map { String(format: "%.1f", $0) } ?? "–", "Rating",
                 fill: s.average_rating.map(ratingColor) ?? .white)
            tile("\(s.tenant_review_count)", "Reviews")
            tile("\(s.interaction_review_count)", "Interactions")
        }
    }

    private func tile(_ value: String, _ label: String, fill: Color = .white) -> some View {
        let dark = fill != .white
        return VStack(alignment: .leading, spacing: 0) {
            Text(value).font(.system(size: 22, weight: .heavy))
            Text(label).font(.system(size: 12, weight: .medium)).foregroundColor(dark ? .white : Brand.muted)
        }
        .foregroundColor(dark ? .white : Brand.ink)
        .padding(.horizontal, 12).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(fill, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(dark ? .clear : Brand.line))
        .accessibilityElement(children: .combine)
    }

    private var flats: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("FLAT").font(.system(size: 13, weight: .bold)).foregroundColor(Brand.muted)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(model.flats) { f in
                        let on = f.id == model.flat?.id
                        Button { model.chooseFlat(f) } label: {
                            Text(f.label).font(.system(size: 14, weight: on ? .bold : .semibold))
                                .foregroundColor(on ? .white : Brand.ink)
                                .padding(.horizontal, 14).frame(height: 38)
                                .background(on ? Brand.ink : .white, in: RoundedRectangle(cornerRadius: 12))
                                .overlay(RoundedRectangle(cornerRadius: 12).stroke(on ? Brand.ink : Brand.line, lineWidth: on ? 2 : 1))
                                .frame(minHeight: 44)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Flat \(f.label)")
                        .accessibilityAddTraits(on ? .isSelected : [])
                    }
                    Button {
                        model.requireSignIn(detail: "Sign in to add your flat to \(model.selected?.title ?? "this building"), then review it.") {
                            addingFlat = true
                        }
                    } label: {
                        Text("+ Add flat").font(.system(size: 14, weight: .semibold)).foregroundColor(Brand.fair)
                            .padding(.horizontal, 12).frame(height: 38)
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Brand.fair, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
                            .frame(minHeight: 44)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 1)
            }
        }
    }

    @ViewBuilder private var feedback: some View {
        if model.detailLoading {
            ProgressView().frame(maxWidth: .infinity).padding(.vertical, 24)
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

    private func empty(_ title: String) -> some View {
        VStack(spacing: 4) {
            Text(title).font(.system(size: 15, weight: .bold)).foregroundColor(Brand.ink)
            Text("Be the first to share your experience with this flat.").font(.system(size: 14)).foregroundColor(Brand.muted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 20)
    }

    private func bottomBar(_ place: Location) -> some View {
        let flatName = model.flat.map { ", Flat \($0.label)" } ?? ""
        return HStack(spacing: 10) {
            Button("Share a review") {
                model.requireSignIn(detail: "You’ll come straight back to your review of \(place.title)\(flatName).") { form = .tenant }
            }
            .buttonStyle(PrimaryButtonStyle(height: 52))
            Button("Interaction") {
                model.requireSignIn(detail: "You’ll come straight back to share your interaction with \(place.title)\(flatName).") {
                    form = .interaction
                }
            }
            .buttonStyle(OutlineButtonStyle(height: 52, strong: true, radius: 16))
            .font(.system(size: 15, weight: .bold))
            .accessibilityLabel("Share an interaction")
        }
        .disabled(model.flat == nil)
        .padding(.horizontal, 20).padding(.top, 14).padding(.bottom, 8)
        .background(Color.white.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { Rectangle().fill(Brand.line).frame(height: 1) }
    }

    private func directions(_ place: Location) {
        let item = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: place.latitude, longitude: place.longitude)))
        item.name = place.title
        item.openInMaps(launchOptions: [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDefault])
    }

    private func share(_ place: Location) {
        var link = URLComponents(string: AppConfig.siteURL + "/")!
        link.queryItems = [URLQueryItem(name: "at", value: String(format: "%.5f,%.5f,17", place.latitude, place.longitude)),
                           URLQueryItem(name: "place", value: place.id)]
        if let flat = model.flat { link.queryItems?.append(URLQueryItem(name: "flat", value: flat.id)) }
        let text = "\(place.title), \(place.address) on Rental Review"
        let sheet = UIActivityViewController(activityItems: [text, link.url as Any].compactMap { $0 }, applicationActivities: nil)
        guard var top = UIApplication.shared.connectedScenes.compactMap({ ($0 as? UIWindowScene)?.keyWindow?.rootViewController }).first
        else { return }
        while let presented = top.presentedViewController { top = presented }
        sheet.popoverPresentationController?.sourceView = top.view
        top.present(sheet, animated: true)
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
                        Text(place.title).font(.title2.bold()).foregroundColor(Brand.ink)
                        Text(place.address).foregroundColor(Brand.muted)
                    }
                }
                .listRowBackground(Brand.goldWash)
            }
            if review != nil || interaction != nil {
                Section {
                    FeedbackCard(review: review, interaction: interaction,
                                 own: review.flatMap { model.ownReviews[$0.id] }, onEdit: onEdit)
                    Discussion(onReview: ref.onReview, subjectId: ref.id,
                               initialCount: review?.comment_count ?? interaction?.comment_count ?? 0)
                }
                .listRowSeparator(.hidden)
                .listRowBackground(Brand.goldWash)
            }
        }
        .listStyle(.plain)
        .background(Brand.goldWash.ignoresSafeArea())
        .navigationTitle(ref.onReview ? "Tenant review" : "Interaction")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: review == nil && interaction == nil) { gone in
            // Deleted, or another flat chosen: back to the building.
            if gone { dismiss() }
        }
    }
}
