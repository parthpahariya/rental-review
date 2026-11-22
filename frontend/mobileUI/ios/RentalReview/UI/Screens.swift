import CoreLocation
import SwiftUI

private func openWeb(_ path: String) {
    if let url = URL(string: AppConfig.siteURL + path) { UIApplication.shared.open(url) }
}

/// "Use my location": one location fix, after asking permission.
@MainActor
final class Locator: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var completion: ((CLLocation?) -> Void)?

    func locate(_ completion: @escaping (CLLocation?) -> Void) {
        self.completion = completion
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        if manager.authorizationStatus == .notDetermined { manager.requestWhenInUseAuthorization() }
        else { manager.requestLocation() }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            switch manager.authorizationStatus {
            case .authorizedWhenInUse, .authorizedAlways: manager.requestLocation()
            case .denied, .restricted: finish(nil)
            default: break
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let last = locations.last
        Task { @MainActor in finish(last) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in finish(nil) }
    }

    private func finish(_ location: CLLocation?) {
        completion?(location)
        completion = nil
    }
}

struct HomeView: View {
    @EnvironmentObject private var model: AppModel
    @State private var locator = Locator()

    var body: some View {
        VStack(spacing: 0) {
            TopBar()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Building by building").bold().foregroundStyle(Brand.fair)
                    Text("Rent with your eyes open.").font(.largeTitle.weight(.heavy)).foregroundStyle(Brand.ink)
                    Text("Buildings across India, rated by the people who lived there. See what past tenants say about deposits, repairs and rent hikes before you sign anything.")
                        .foregroundStyle(Brand.muted)
                    SearchBox(near: Region.defaultCenter)
                    HStack {
                        Button("Use my location") {
                            locator.locate { location in
                                if let location {
                                    model.openArea(Area(name: "Near you", center: GeoPoint(latitude: location.coordinate.latitude,
                                                                                         longitude: location.coordinate.longitude), zoom: 15))
                                } else {
                                    model.message = "We couldn’t get your location. Search for a locality instead."
                                }
                            }
                        }
                        .buttonStyle(.bordered)
                        Button("Browse the map", action: model.browseAll).buttonStyle(.borderedProminent).tint(Brand.ink)
                    }
                    explainer("Tenant reviews", "From people who rented the flat: a rating, what living there was like, and their tenancy dates.")
                    explainer("Interactions", "From people who only viewed or enquired: useful red flags before you ever move in.")
                    Divider()
                    HStack(spacing: 20) {
                        Button("Privacy Policy") { openWeb("/privacy") }
                        Button("Delete your data") { openWeb("/delete-data") }
                    }
                    .tint(Brand.ink)
                }
                .padding(20)
            }
        }
        .background(Brand.goldWash)
    }

    private func explainer(_ title: String, _ body: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.headline)
            Text(body).foregroundStyle(Brand.muted)
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(.white, in: RoundedRectangle(cornerRadius: 16))
    }
}

struct ExploreView: View {
    @EnvironmentObject private var model: AppModel
    @State private var listOpen = false
    @State private var addMode = false
    @State private var addingAt: GeoPoint?
    @State private var center = Region.defaultCenter

    var body: some View {
        VStack(spacing: 0) {
            TopBar(back: true)
            ZStack(alignment: .top) {
                if let provider = model.provider {
                    MapPane(provider: provider, addMode: addMode, center: $center)
                } else {
                    Color(white: 0.93)
                }
                SearchBox(near: center).padding(12)
                VStack {
                    Spacer()
                    if addMode {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Move the map so the + is on the building.").bold()
                            HStack {
                                Button("Add a place here") { addingAt = center }.buttonStyle(.borderedProminent).tint(Brand.ink)
                                Button("Cancel") { addMode = false }
                            }
                        }
                        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
                        .background(.white, in: RoundedRectangle(cornerRadius: 16)).padding(16)
                    } else {
                        HStack(spacing: 10) {
                            Button {
                                listOpen = true
                            } label: {
                                Label("Show list · \(model.locations.count) \(model.locations.count == 1 ? "place" : "places")\(model.partial ? "+" : "")",
                                      systemImage: "list.bullet").font(.body.bold())
                            }
                            .buttonStyle(.borderedProminent).tint(.white).foregroundStyle(Brand.ink)
                            Button {
                                if model.account == nil { model.signIn() } else { addMode = true }
                            } label: { Label("Add", systemImage: "plus").font(.body.bold()) }
                                .buttonStyle(.borderedProminent).tint(Brand.gold).foregroundStyle(Brand.ink)
                        }
                        .padding(.bottom, 24)
                    }
                }
            }
        }
        .sheet(isPresented: $listOpen) {
            CompatNavigation {
                List {
                    if model.nearestFirst.isEmpty && !model.loadingPlaces {
                        Text("No places in this area. Move the map, or add a place here.").foregroundStyle(Brand.muted)
                    }
                    ForEach(model.nearestFirst) { l in
                        Button { listOpen = false; model.select(l) } label: { PlaceRow(location: l) }
                    }
                }
                .navigationTitle(model.loadingPlaces ? "Loading places…" : "Nearest to map centre")
                .navigationBarTitleDisplayMode(.inline)
            }
            .sheetSizes([.medium, .large])
        }
        .sheet(isPresented: Binding(get: { model.selected != nil }, set: { if !$0 { model.closePlace() } })) {
            PlaceDetails().sheetSizes([.large])
        }
        .sheet(item: Binding(get: { addingAt.map { IdentifiedPoint(point: $0) } }, set: { addingAt = $0?.point })) { item in
            AddPlaceForm(at: item.point) { addMode = false }
        }
    }
}

private struct IdentifiedPoint: Identifiable {
    let point: GeoPoint
    var id: String { "\(point.latitude),\(point.longitude)" }
}

struct NotebookView: View {
    @EnvironmentObject private var model: AppModel
    @State private var name = ""
    @State private var deactivating = false
    @State private var requesting: Review?
    @State private var editing: Review?

    var body: some View {
        VStack(spacing: 0) {
            TopBar(back: true)
            if let account = model.account {
                List {
                    Section {
                        TextField("Your name", text: $name)
                        Text("Only you see this. It never appears with your reviews.").font(.footnote).foregroundStyle(Brand.muted)
                        HStack {
                            Button("Save name") { Task { await model.setName(name.isEmpty ? nil : String(name.prefix(200))) } }
                            if account.name_is_custom == true {
                                Button("Use my Google name") {
                                    Task { if await model.setName(nil) { name = model.account?.name ?? "" } }
                                }
                            }
                        }
                        .buttonStyle(.borderless)
                    } header: { Text("Your rental notebook").font(.title2.bold()).foregroundStyle(Brand.ink).textCase(nil) }

                    if model.notebookLoading { ProgressView() }

                    Section("Places you added") {
                        if model.notebook.flats.isEmpty { Text("You haven’t added a place yet.").foregroundStyle(Brand.muted) }
                        ForEach(model.notebook.flats) { f in
                            record("\(f.location.title) · Flat \(f.label)", f.added_place ? "You added this building" : "You added a flat here") {
                                Button("Open") { model.openOwn(locationId: f.location.id, flatId: f.id, tab: .tenant) }
                            }
                        }
                    }

                    Section("Your tenant reviews") {
                        if model.notebook.reviews.isEmpty { Text("No tenant reviews yet.").foregroundStyle(Brand.muted) }
                        ForEach(model.notebook.reviews) { r in
                            record(placeTitle(r.place, "Tenant review"),
                                   String(repeating: "★", count: r.rating) + " · " + (r.deleted_at != nil ? "Deleted after admin approval" : "Editing closes \(shortDate(r.editing_deadline))"),
                                   r.feedback) {
                                if let locationId = r.location_id {
                                    Button("Open") { model.openOwn(locationId: locationId, flatId: r.flat_id, tab: .tenant) }
                                }
                                if r.can_edit == true { Button("Edit") { editing = r } }
                                if r.can_request_deletion == true { Button("Request deletion") { requesting = r } }
                            }
                        }
                    }

                    Section("Your interactions") {
                        if model.notebook.interactions.isEmpty { Text("No interactions shared yet.").foregroundStyle(Brand.muted) }
                        ForEach(model.notebook.interactions) { i in
                            record(placeTitle(i.place, "Interaction"), "On \(shortDate(i.interaction_date))", i.description) {
                                if let locationId = i.location_id {
                                    Button("Open") { model.openOwn(locationId: locationId, flatId: i.flat_id, tab: .interaction) }
                                }
                            }
                        }
                    }

                    if !model.notebook.requests.isEmpty {
                        Section("Deletion requests") {
                            ForEach(model.notebook.requests) { d in
                                record(d.reason, d.decision_note.map { "Admin: \($0)" }) {
                                    Text(d.status).font(.caption.bold()).foregroundStyle(.white)
                                        .padding(.horizontal, 10).padding(.vertical, 3)
                                        .background(d.status == "approved" ? Brand.good : d.status == "rejected" ? Brand.poor : Brand.muted, in: Capsule())
                                }
                            }
                        }
                    }

                    if account.isAdmin {
                        Section("Admin · Pending deletion requests") {
                            if model.notebook.adminRequests.isEmpty { Text("You’re all caught up.").foregroundStyle(Brand.muted) }
                            ForEach(model.notebook.adminRequests) { d in
                                record(d.review.map { String(repeating: "★", count: $0.rating) } ?? "Tenant review", "Reason: \(d.reason)", d.review?.feedback) {
                                    Button("Approve") { model.decide(d, approve: true) }.buttonStyle(.borderedProminent).tint(Brand.ink)
                                    Button("Reject") { model.decide(d, approve: false) }.buttonStyle(.bordered)
                                }
                            }
                        }
                    }

                    Section {
                        Button("Sign out", action: model.signOut)
                        if deactivating {
                            Text("Deactivating ends all your sessions. Your tenant reviews and interactions remain visible.")
                            Button("Confirm deactivation", role: .destructive, action: model.deactivate)
                            Button("Cancel") { deactivating = false }
                        } else {
                            Button("Deactivate account", role: .destructive) { deactivating = true }
                        }
                    }
                }
                .onAppear { name = account.name ?? "" }
            }
        }
        .sheet(item: $requesting) { r in
            TextPrompt(title: "Request deletion", label: "Why should this review be deleted?", action: "Send", maxLength: 10_000) {
                await model.requestDeletion(r, reason: $0)
            }
        }
        .sheet(item: $editing) { FeedbackForm(tab: .tenant, editing: $0) }
    }

    private func placeTitle(_ place: Place?, _ fallback: String) -> String {
        place.map { "\($0.building_name ?? "Rental property") · Flat \($0.flat_label)" } ?? fallback
    }

    private func record<Actions: View>(_ title: String, _ subtitle: String?, _ body: String? = nil,
                                       @ViewBuilder actions: () -> Actions) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).bold()
            if let subtitle { Text(subtitle).font(.footnote).foregroundStyle(Brand.muted) }
            if let body { Text(body) }
            HStack { actions() }.buttonStyle(.borderless)
        }
    }
}
