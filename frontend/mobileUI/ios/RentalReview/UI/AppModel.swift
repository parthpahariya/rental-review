import Foundation
import Combine

enum Screen { case home, explore, notebook }
enum FeedbackTab: Int { case tenant, interaction }

/// A place to move the map to; a new `key` moves it there again.
struct Focus: Equatable { let key: Int; let area: Area }

/// The visitor's own records, shown in the notebook.
struct Notebook {
    var reviews: [Review] = []
    var interactions: [Interaction] = []
    var requests: [Deletion] = []
    var adminRequests: [Deletion] = []
    var flats: [OwnFlat] = []
}

/// All app state and the actions screens trigger (the iOS twin of Android's AppViewModel).
@MainActor
final class AppModel: ObservableObject {
    let api = RentalReviewAPI(sessions: SessionStore())

    // Account
    @Published var account: Account?
    @Published var signingIn = false
    /// Set when a deactivated account must confirm reactivation.
    @Published var reactivationPending = false
    private var pendingCredential: String?

    // Navigation and feedback
    @Published var screen = Screen.home
    @Published var message: String?

    // Map
    @Published var provider: MapProvider?
    @Published var mapUnavailable = false
    @Published var area: Area?
    @Published var focus: Focus?
    /// The searched building, marked on the map.
    @Published var searched: Area?
    @Published var locations: [Location] = []
    @Published var partial = false
    @Published var loadingPlaces = false
    @Published var mapCenter = Region.defaultCenter
    private var viewportTask: Task<Void, Never>?
    private var focusKey = 0

    // Selected place
    @Published var selected: Location?
    @Published var flats: [Flat] = []
    @Published var flat: Flat?
    @Published var tab = FeedbackTab.tenant
    @Published var reviews: [Review] = []
    @Published var interactions: [Interaction] = []
    /// The viewer's own reviews of the selected flat, by id (for Edit).
    @Published var ownReviews: [String: Review] = [:]
    @Published var detailLoading = false

    // Notebook
    @Published var notebook = Notebook()
    @Published var notebookLoading = false

    var search: SearchService {
        SearchService(listed: { [api] in try await api.searchListed($0) },
                      provider: { [provider] in (provider ?? .osm).search })
    }

    init() {
        Task {
            let config = try? await api.mapConfig()
            let p = config.map(MapProvider.init(config:)) ?? .osm
            p.configureNetworking()
            provider = p
        }
        if api.sessions.token != nil {
            Task { account = try? await api.me() }
        }
    }

    private func fail(_ error: Error) {
        message = (error as? LocalizedError)?.errorDescription ?? "Something went wrong. Please try again."
    }

    /// Runs `action`, reporting failure; returns whether it succeeded.
    @discardableResult
    private func attempt(_ action: () async throws -> Void) async -> Bool {
        do { try await action(); return true } catch { fail(error); return false }
    }

    // MARK: Areas and the map

    func openArea(_ next: Area) {
        area = next
        searched = next.exact ? next : nil
        selected = nil
        focusKey += 1
        focus = Focus(key: focusKey, area: next)
        screen = .explore
    }

    func browseAll() {
        openArea(Area(name: Region.defaultName, center: Region.defaultCenter, zoom: 12))
    }

    func goHome() {
        screen = .home
        selected = nil
    }

    /// The visible map area changed: load its places after the camera settles.
    func onViewport(_ bounds: GeoBounds, center: GeoPoint) {
        mapCenter = center
        viewportTask?.cancel()
        viewportTask = Task {
            try? await pause(milliseconds: 250)
            if Task.isCancelled { return }
            loadingPlaces = true
            do {
                let (rows, more) = try await api.locations(west: bounds.west, south: bounds.south, east: bounds.east, north: bounds.north)
                if !Task.isCancelled { locations = rows; partial = more }
            } catch {
                if !Task.isCancelled { fail(error) }
            }
            loadingPlaces = false
        }
    }

    /// Places in view, nearest to the map centre first.
    var nearestFirst: [Location] {
        let c = mapCenter
        let scale = cos(c.latitude * .pi / 180)
        return locations.sorted {
            let a = pow($0.latitude - c.latitude, 2) + pow(($0.longitude - c.longitude) * scale, 2)
            let b = pow($1.latitude - c.latitude, 2) + pow(($1.longitude - c.longitude) * scale, 2)
            return a < b
        }
    }

    // MARK: A place, its flats and their reviews

    func select(_ location: Location, flatId: String? = nil, tab: FeedbackTab? = nil) {
        selected = location
        flats = []
        flat = nil
        if let tab { self.tab = tab }
        Task {
            detailLoading = true
            await attempt {
                flats = try await api.flats(location.id)
                if let first = flats.first(where: { $0.id == flatId }) ?? flats.first { await loadFlat(first) }
            }
            detailLoading = false
        }
    }

    func closePlace() { selected = nil }

    func chooseFlat(_ next: Flat) { Task { await loadFlat(next) } }

    private func loadFlat(_ next: Flat) async {
        flat = next
        detailLoading = true
        await attempt {
            reviews = try await api.tenantReviews(flatId: next.id)
            interactions = try await api.interactions(flatId: next.id)
            ownReviews = account == nil ? [:]
                : Dictionary(uniqueKeysWithValues: try await api.ownReviews(flatId: next.id).map { ($0.id, $0) })
        }
        detailLoading = false
    }

    private func refreshPlace() async {
        if let flat { await loadFlat(flat) }
        if let s = selected, let fresh = try? await api.location(s.id) {
            selected = fresh
            locations = locations.map { $0.id == fresh.id ? fresh : $0 }
        }
    }

    // MARK: Writing

    func postReview(rating: Int, feedback: String, start: String, end: String) async -> Bool {
        guard let flat else { return false }
        return await attempt {
            try await api.postReview(flatId: flat.id, rating: rating, feedback: feedback, start: start, end: end)
            message = "Thanks for sharing. Your experience is now public."
            await refreshPlace()
        }
    }

    func editReview(_ review: Review, rating: Int, feedback: String) async -> Bool {
        await attempt {
            try await api.editReview(id: review.id, rating: rating, feedback: feedback)
            message = "Your review was updated."
            await refreshPlace()
            if screen == .notebook { await loadNotebook() }
        }
    }

    func postInteraction(description: String, date: String) async -> Bool {
        guard let flat else { return false }
        return await attempt {
            try await api.postInteraction(flatId: flat.id, description: description, date: date)
            message = "Thanks for sharing. Your interaction is now public."
            await refreshPlace()
        }
    }

    func addFlat(_ label: String) async -> Bool {
        guard let place = selected else { return false }
        return await attempt {
            let created = try await api.addFlat(locationId: place.id, label: label)
            flats = try await api.flats(place.id)
            await loadFlat(flats.first { $0.id == created.id } ?? created)
            message = "Flat \(created.label) added. You can review it now."
        }
    }

    func addPlace(address: String, buildingName: String?, at: GeoPoint, flatLabel: String) async -> Bool {
        await attempt {
            let created = try await api.addPlace(address: address, buildingName: buildingName,
                                                 latitude: at.latitude, longitude: at.longitude, flatLabel: flatLabel)
            message = "Added. Share your experience of flat \(created.label)."
            select(created.location, flatId: created.id)
        }
    }

    func requestDeletion(_ review: Review, reason: String) async -> Bool {
        await attempt {
            try await api.requestDeletion(reviewId: review.id, reason: reason)
            message = "Deletion requested. An admin will decide."
            await loadNotebook()
        }
    }

    func decide(_ request: Deletion, approve: Bool) {
        Task { if await attempt({ try await api.decide(requestId: request.id, approve: approve) }) { await loadNotebook() } }
    }

    func setName(_ name: String?) async -> Bool {
        await attempt { account = try await api.setName(name) }
    }

    // MARK: Signing in and out

    func signIn() {
        Task {
            signingIn = true
            defer { signingIn = false }
            await attempt {
                guard (try await api.authProviders()).google_client_id != nil else {
                    message = "Google sign-in isn’t available right now. Please try again later."
                    return
                }
                guard let token = try await GoogleAuth.idToken() else { return }
                try await finishSignIn(token, reactivate: false)
            }
        }
    }

    private func finishSignIn(_ credential: String, reactivate: Bool) async throws {
        let result = try await api.signInWithGoogle(credential: credential, reactivate: reactivate)
        if result.outcome == "reactivation_required" {
            pendingCredential = credential
            reactivationPending = true
            return
        }
        api.sessions.token = result.session?.token
        account = result.account
        reactivationPending = false
        pendingCredential = nil
        message = result.outcome == "reactivated" ? "Welcome back. Your account is active again." : "You’re signed in."
        if let flat { await loadFlat(flat) }
    }

    func confirmReactivation(_ confirm: Bool) {
        let credential = pendingCredential
        reactivationPending = false
        pendingCredential = nil
        guard confirm, let credential else { return }
        Task { await attempt { try await finishSignIn(credential, reactivate: true) } }
    }

    private func clearSession() {
        GoogleAuth.signOut()
        api.sessions.token = nil
        account = nil
        ownReviews = [:]
        notebook = Notebook()
    }

    func signOut() {
        Task {
            try? await api.signOut()
            clearSession()
            if screen == .notebook { screen = .home }
            message = "You’re signed out."
        }
    }

    func deactivate() {
        Task {
            if await attempt({ try await api.deactivate() }) {
                clearSession()
                screen = .home
                message = "Your account is deactivated. Your reviews stay public."
            }
        }
    }

    // MARK: Notebook

    func openNotebook() {
        screen = .notebook
        Task { await loadNotebook() }
    }

    func loadNotebook() async {
        notebookLoading = true
        await attempt {
            notebook = Notebook(
                reviews: try await api.ownReviews(),
                interactions: try await api.ownInteractions(),
                requests: try await api.ownDeletionRequests(),
                adminRequests: account?.isAdmin == true ? try await api.pendingDeletionRequests() : [],
                flats: try await api.ownFlats())
        }
        notebookLoading = false
    }

    /// Opens one of the visitor's own records on the map.
    func openOwn(locationId: String, flatId: String, tab: FeedbackTab) {
        Task {
            await attempt {
                let location = try await api.location(locationId)
                openArea(Area(name: location.title, detail: location.address,
                              center: GeoPoint(latitude: location.latitude, longitude: location.longitude), zoom: 17))
                select(location, flatId: flatId, tab: tab)
            }
        }
    }
}
