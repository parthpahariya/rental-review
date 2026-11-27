import Combine
import CoreLocation
import Foundation

/// Top-level screens. Home and Notebook carry the tab bar; the map screen is
/// the one place a map is shown (results, add a place, move a pin).
enum Screen { case home, map, notebook }
enum FeedbackTab: Int { case tenant, interaction }

/// What the map screen is doing: browsing results, placing a new place's pin,
/// or moving the pin of a place the visitor added.
enum MapMode: Equatable {
    case browse, add
    case move(Location)
}

enum SortOrder: String, CaseIterable, Identifiable {
    case nearest = "Nearest", rating = "Highest rated", reviews = "Most reviewed"
    var id: String { rawValue }
}

enum ResultFilter: String, CaseIterable, Identifiable {
    case hasReviews = "Has reviews", fourUp = "4★ and up", hasInteractions = "Has interactions"
    var id: String { rawValue }

    func matches(_ l: Location) -> Bool {
        let s = l.summary ?? Summary()
        switch self {
        case .hasReviews: return s.tenant_review_count > 0
        case .fourUp: return (s.average_rating ?? 0) >= 4
        case .hasInteractions: return s.interaction_review_count > 0
        }
    }
}

/// A place to move the map to; a new `key` moves it there again.
struct Focus: Equatable { let key: Int; let area: Area }

/// A locality on the home page, derived from places that already have reviews.
struct AreaChip: Identifiable, Hashable {
    let name: String
    let count: Int
    let area: Area
    var id: String { name }
}

/// The sign-in sheet, and what to carry on with once signed in.
struct SignInPrompt: Identifiable {
    let id = UUID()
    let title: String
    let detail: String
    let then: (() -> Void)?
}

/// The visitor's own records, shown in the notebook.
struct Notebook {
    var reviews: [Review] = []
    var interactions: [Interaction] = []
    var requests: [Deletion] = []
    var adminRequests: [Deletion] = []
    var flats: [OwnFlat] = []
    var comments: [Comment] = []
    var commentReports: [CommentReport] = []
}

/// All app state and the actions screens trigger (the iOS twin of Android's AppViewModel).
@MainActor
final class AppModel: ObservableObject {
    let api = RentalReviewAPI(sessions: SessionStore())
    /// The session's single map view, created the first time the map is asked for.
    let mapHolder = MapHolder()
    private let locator = Locator()

    // Account
    @Published var account: Account?
    @Published var signingIn = false
    /// Set when a deactivated account must confirm reactivation.
    @Published var reactivationPending = false
    @Published var signInPrompt: SignInPrompt?
    private var pendingCredential: String?

    // Navigation and feedback
    @Published var screen = Screen.home
    @Published var message: String?

    // Home
    @Published var areas: [AreaChip] = []
    @Published var areasLoaded = false

    // Map and results
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
    @Published var mapZoom = 12.0
    @Published var mapMode = MapMode.browse
    /// The results list without the map; remembered between launches.
    @Published var listOnly = UserDefaults.standard.bool(forKey: "listOnly") {
        didSet { UserDefaults.standard.set(listOnly, forKey: "listOnly") }
    }
    @Published var sort = SortOrder.nearest
    @Published var filters: Set<ResultFilter> = []
    /// The place last opened, outlined in the list and on the map.
    @Published var highlighted: String?
    private var viewportTask: Task<Void, Never>?
    private var focusKey = 0
    /// Add mode started from the tab bar returns home when cancelled.
    private var addReturnsHome = false

    // Adding or moving a pin
    @Published var draft: GeoPoint?
    /// Places already within 100 m of the draft pin.
    @Published var nearby: [Location] = []
    private var nearbyTask: Task<Void, Never>?

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
    @Published var permissions: LocationPermissions?
    /// A form to open as soon as the place shows (after adding a place or flat).
    @Published var autoForm: FeedbackTab?

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
        Task { await loadAreas() }
    }

    private func message(for error: Error) -> String {
        (error as? LocalizedError)?.errorDescription ?? "Something went wrong. Please try again."
    }

    private func fail(_ error: Error) { message = message(for: error) }

    /// Runs `action`, reporting failure; returns whether it succeeded.
    @discardableResult
    private func attempt(_ action: () async throws -> Void) async -> Bool {
        do { try await action(); return true } catch { fail(error); return false }
    }

    /// Runs `action`; returns the error to show inline in a form, or nil when it worked.
    private func attemptInline(_ action: () async throws -> Void) async -> String? {
        do { try await action(); return nil } catch { return message(for: error) }
    }

    // MARK: Home: areas with reviews (our own data, no map provider)

    func loadAreas() async {
        let b = Region.bounds
        guard let (rows, _) = try? await api.locations(west: b.west, south: b.south, east: b.east, north: b.north, maxPages: 2)
        else { areasLoaded = true; return }
        var groups: [String: (name: String, members: [Location])] = [:]
        for l in rows {
            guard let name = Self.locality(l.address) else { continue }
            groups[name.lowercased(), default: (name, [])].members.append(l)
        }
        areas = groups.values.sorted { $0.members.count != $1.members.count ? $0.members.count > $1.members.count : $0.name < $1.name }
            .prefix(8).map { name, members in
                let lats = members.map(\.latitude), lngs = members.map(\.longitude)
                let pad = 0.004
                let bounds = GeoBounds(west: lngs.min()! - pad, south: lats.min()! - pad, east: lngs.max()! + pad, north: lats.max()! + pad)
                let center = GeoPoint(latitude: (bounds.south + bounds.north) / 2, longitude: (bounds.west + bounds.east) / 2)
                return AreaChip(name: name, count: members.count, area: Area(name: name, center: center, bounds: bounds, zoom: 14))
            }
        areasLoaded = true
    }

    /// The locality in an address like "16, 1st Cross, HSR Layout, Bengaluru":
    /// the last part before the city, state and PIN, without "6th Phase" etc.
    static func locality(_ address: String) -> String? {
        let places: Set<String> = ["india", "bengaluru", "bangalore", "bengaluru urban", "karnataka", "mumbai", "maharashtra",
                                   "pune", "delhi", "new delhi", "hyderabad", "telangana", "chennai", "tamil nadu", "kolkata",
                                   "west bengal", "gurugram", "gurgaon", "haryana", "noida", "uttar pradesh", "ahmedabad", "gujarat"]
        var parts = address.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        while let last = parts.last, places.contains(last.lowercased())
                || last.range(of: #"\d{6}"#, options: .regularExpression) != nil {
            parts.removeLast()
        }
        guard parts.count >= 2, var name = parts.last else { return nil }
        name = name.replacingOccurrences(of: #"\s+(\d+(st|nd|rd|th)\s+(Phase|Stage|Block|Sector)|(Phase|Stage|Block|Sector)\s+\w+)$"#,
                                         with: "", options: [.regularExpression, .caseInsensitive])
        let street = #"(?i)\b(cross|main|road|rd|street|st|lane)\b"#
        guard let first = name.first, !first.isNumber, name.range(of: street, options: .regularExpression) == nil,
              name.count <= 40 else { return nil }
        return name
    }

    // MARK: Areas and the map

    func openArea(_ next: Area) {
        area = next
        searched = next.exact ? next : nil
        selected = nil
        mapMode = .browse
        moveMap(to: next)
        screen = .map
        if listOnly { loadList(around: next) }
    }

    private func moveMap(to next: Area) {
        focusKey += 1
        focus = Focus(key: focusKey, area: next)
    }

    /// "Open the map": back to the last area, or Bengaluru.
    func openMap() {
        if area != nil { mapMode = .browse; screen = .map } else { browseAll() }
    }

    func browseAll() {
        openArea(Area(name: Region.defaultName, center: Region.defaultCenter, zoom: 12))
    }

    /// "Near me": one location fix, then the map around it.
    func openNearMe() {
        locator.locate { [weak self] location in
            guard let self else { return }
            if let location {
                self.openArea(Area(name: "Near you", center: GeoPoint(latitude: location.coordinate.latitude,
                                                                      longitude: location.coordinate.longitude), zoom: 15))
            } else {
                self.message = "We couldn’t get your location. Search for a locality instead."
            }
        }
    }

    func goHome() {
        screen = .home
        mapMode = .browse
        draft = nil
        selected = nil
    }

    func setListOnly(_ on: Bool) {
        listOnly = on
        if on, locations.isEmpty, let area { loadList(around: area) }
    }

    /// The visible map area changed: load its places after the camera settles.
    func onViewport(_ bounds: GeoBounds, center: GeoPoint, zoom: Double) {
        mapCenter = center
        mapZoom = zoom
        load(bounds)
    }

    /// Without the map: the places in roughly the area a phone's map would show.
    private func loadList(around area: Area) {
        mapCenter = area.center
        let b = area.bounds ?? {
            let lng = 360 * 390 / (512 * pow(2, area.zoom))
            let lat = lng * 1.8 * cos(area.center.latitude * .pi / 180)
            return GeoBounds(west: area.center.longitude - lng / 2, south: area.center.latitude - lat / 2,
                             east: area.center.longitude + lng / 2, north: area.center.latitude + lat / 2)
        }()
        load(b)
    }

    private func load(_ bounds: GeoBounds) {
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
            if !Task.isCancelled { loadingPlaces = false }
        }
    }

    /// The places in view, filtered and sorted, with their distance from the map centre.
    var results: [(location: Location, distance: Double)] {
        let c = mapCenter
        let rows = locations.filter { l in filters.allSatisfy { $0.matches(l) } }.map { ($0, metres(from: c, to: $0.point)) }
        switch sort {
        case .nearest: return rows.sorted { $0.1 < $1.1 }
        case .rating:
            return rows.sorted { ($0.0.summary?.average_rating ?? -1, -$0.1) > ($1.0.summary?.average_rating ?? -1, -$1.1) }
        case .reviews:
            func count(_ l: Location) -> Int { (l.summary?.tenant_review_count ?? 0) + (l.summary?.interaction_review_count ?? 0) }
            return rows.sorted { (count($0.0), -$0.1) > (count($1.0), -$1.1) }
        }
    }

    // MARK: Adding a place, moving a pin (on the same map)

    /// The Add place tab: sign in, then the map around the visitor (or the last area).
    func addFromTab() {
        requireSignIn(detail: "Sign in to put a missing building on the map.") { [weak self] in
            guard let self else { return }
            self.locator.locate(askIfNeeded: true) { [weak self] location in
                guard let self else { return }
                let at = location.map { GeoPoint(latitude: $0.coordinate.latitude, longitude: $0.coordinate.longitude) }
                self.startAdd(at: at ?? self.area?.center ?? Region.defaultCenter, zoom: at != nil ? 17 : 15, returnsHome: true)
            }
        }
    }

    /// The map's "+": a draft pin at the map centre.
    func addFromMap() {
        requireSignIn(detail: "Sign in to put a missing building on the map.") { [weak self] in
            guard let self else { return }
            self.startAdd(at: self.mapCenter, zoom: max(self.mapZoom, 17), returnsHome: false)
        }
    }

    private func startAdd(at point: GeoPoint, zoom: Double, returnsHome: Bool) {
        addReturnsHome = returnsHome
        selected = nil
        searched = nil
        mapMode = .add
        moveMap(to: Area(name: area?.name ?? "New place", center: point, zoom: zoom))
        screen = .map
        moveDraft(to: point)
    }

    func cancelAdd() {
        mapMode = .browse
        draft = nil
        nearby = []
        if addReturnsHome { screen = .home }
    }

    func moveDraft(to point: GeoPoint) {
        draft = point
        guard mapMode == .add else { return }
        nearbyTask?.cancel()
        nearbyTask = Task {
            try? await pause(milliseconds: 300)
            if Task.isCancelled { return }
            let dLat = 0.0011, dLng = 0.0011 / max(0.2, cos(point.latitude * .pi / 180))
            guard let (rows, _) = try? await api.locations(west: point.longitude - dLng, south: point.latitude - dLat,
                                                          east: point.longitude + dLng, north: point.latitude + dLat,
                                                          reviewedOnly: false, maxPages: 1),
                  !Task.isCancelled else { return }
            nearby = rows.filter { metres(from: point, to: $0.point) <= 100 }
                .sorted { metres(from: point, to: $0.point) < metres(from: point, to: $1.point) }
        }
    }

    /// "Review this": an existing place near the draft pin.
    func reviewNearby(_ location: Location) {
        mapMode = .browse
        draft = nil
        nearby = []
        select(location)
    }

    func addPlace(address: String, buildingName: String?, flatLabel: String) async -> String? {
        guard let at = draft else { return "Drag the pin onto the building first." }
        return await attemptInline {
            let created = try await api.addPlace(address: address, buildingName: buildingName,
                                                 latitude: at.latitude, longitude: at.longitude, flatLabel: flatLabel)
            message = "Added. Share your experience of flat \(created.label)."
            mapMode = .browse
            draft = nil
            nearby = []
            if addReturnsHome { area = Area(name: created.location.title, center: created.location.point, zoom: 17) }
            addReturnsHome = false
            autoForm = .tenant
            select(created.location, flatId: created.id, tab: .tenant)
            load(GeoBounds(west: at.longitude - 0.01, south: at.latitude - 0.01, east: at.longitude + 0.01, north: at.latitude + 0.01))
        }
    }

    /// "Move the pin on the map": the details close and the map opens on the place.
    func startMovePin() {
        guard let place = selected else { return }
        selected = nil
        searched = nil
        mapMode = .move(place)
        draft = place.point
        moveMap(to: Area(name: area?.name ?? place.title, center: place.point, zoom: 18))
        screen = .map
    }

    func cancelMove() {
        guard case .move(let place) = mapMode else { return }
        mapMode = .browse
        draft = nil
        select(place, flatId: flat?.id)
    }

    func savePin() async -> String? {
        guard case .move(let place) = mapMode, let at = draft else { return nil }
        return await attemptInline {
            let moved = try await api.editLocation(id: place.id, fields: ["latitude": at.latitude, "longitude": at.longitude])
            message = "The pin was moved."
            mapMode = .browse
            draft = nil
            locations = locations.map { $0.id == moved.id ? moved : $0 }
            select(moved, flatId: flat?.id)
        }
    }

    // MARK: A place, its flats and their reviews

    func select(_ location: Location, flatId: String? = nil, tab: FeedbackTab? = nil) {
        selected = location
        highlighted = location.id
        flats = []
        flat = nil
        reviews = []
        interactions = []
        permissions = nil
        if let tab { self.tab = tab }
        Task {
            detailLoading = true
            await attempt {
                flats = try await api.flats(location.id)
                if let first = flats.first(where: { $0.id == flatId }) ?? flats.first { await loadFlat(first) }
            }
            detailLoading = false
            await loadPermissions()
        }
    }

    private func loadPermissions() async {
        guard account != nil, let place = selected else { permissions = nil; return }
        permissions = try? await api.permissions(locationId: place.id)
    }

    func closePlace() { selected = nil; autoForm = nil }

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

    /// Refreshes the flat's lists (e.g. comment counts) without a loading state.
    func refreshFlatLists() async {
        guard let current = flat else { return }
        if let rows = try? await api.tenantReviews(flatId: current.id) { reviews = rows }
        if let rows = try? await api.interactions(flatId: current.id) { interactions = rows }
    }

    private func refreshPlace() async {
        if let s = selected, let fresh = try? await api.location(s.id) {
            selected = fresh
            locations = locations.map { $0.id == fresh.id ? fresh : $0 }
        }
        if let s = selected, let rows = try? await api.flats(s.id) {
            flats = rows
            if let current = flat { flat = rows.first { $0.id == current.id } ?? current }
        }
        if let flat { await loadFlat(flat) }
        await loadPermissions()
    }

    // MARK: Writing

    func postReview(rating: Int, feedback: String, start: String, end: String) async -> String? {
        guard let flat else { return "Choose a flat first." }
        return await attemptInline {
            try await api.postReview(flatId: flat.id, rating: rating, feedback: feedback, start: start, end: end)
            message = "Thanks for sharing. Your experience is now public."
            await refreshPlace()
        }
    }

    func editReview(_ review: Review, rating: Int, feedback: String) async -> String? {
        await attemptInline {
            try await api.editReview(id: review.id, rating: rating, feedback: feedback)
            message = "Your review was updated."
            if selected != nil { await refreshPlace() }
            if screen == .notebook { await loadNotebook() }
        }
    }

    func postInteraction(description: String, date: String) async -> String? {
        guard let flat else { return "Choose a flat first." }
        return await attemptInline {
            try await api.postInteraction(flatId: flat.id, description: description, date: date)
            message = "Thanks for sharing. Your interaction is now public."
            await refreshPlace()
        }
    }

    /// Adds a flat, then opens the review form for it.
    func addFlat(_ label: String) async -> Bool {
        guard let place = selected else { return false }
        return await attempt {
            let created = try await api.addFlat(locationId: place.id, label: label)
            flats = try await api.flats(place.id)
            await loadFlat(flats.first { $0.id == created.id } ?? created)
            await loadPermissions()
            message = "Flat \(created.label) added. You can review it now."
            tab = .tenant
            autoForm = .tenant
        }
    }

    /// "Edit what you added": the building's name and address, and the visitor's flat label.
    func editPlace(buildingName: String?, address: String, flatLabel: String?) async -> String? {
        guard let place = selected else { return nil }
        return await attemptInline {
            if permissions?.can_edit_location == true,
               buildingName != place.building_name || address != place.address {
                let fresh = try await api.editLocation(id: place.id, fields: ["building_name": buildingName, "address": address])
                selected = fresh
                locations = locations.map { $0.id == fresh.id ? fresh : $0 }
            }
            if let flatLabel, let current = flat, flatLabel != current.label {
                _ = try await api.editFlat(id: current.id, label: flatLabel)
            }
            message = "Your changes were saved."
            await refreshPlace()
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

    // MARK: Discussions (see UI/Discussion.swift)

    /// The discussion's comments, oldest first, or nil when it could not load.
    func comments(onReview: Bool, subjectId: String) async -> [Comment]? {
        do { return try await api.comments(onReview: onReview, subjectId: subjectId) } catch { fail(error); return nil }
    }

    func postComment(onReview: Bool, subjectId: String, body: String) async -> Bool {
        await attempt { try await api.postComment(onReview: onReview, subjectId: subjectId, body: body) }
    }

    func editComment(_ comment: Comment, body: String) async -> Bool {
        await attempt { try await api.editComment(id: comment.id, body: body) }
    }

    func deleteComment(_ comment: Comment) async -> Bool {
        await attempt { try await api.deleteComment(id: comment.id) }
    }

    func reportComment(_ comment: Comment, reason: String) async -> Bool {
        await attempt {
            try await api.reportComment(id: comment.id, reason: reason)
            message = "Thanks. An admin will review this comment."
        }
    }

    /// Deletes one of the visitor's comments from the notebook.
    func deleteOwnComment(_ comment: Comment) {
        Task { if await deleteComment(comment) { await loadNotebook() } }
    }

    func decideReport(_ report: CommentReport, remove: Bool) {
        Task { if await attempt({ try await api.decideReport(id: report.id, remove: remove) }) { await loadNotebook() } }
    }

    func setName(_ name: String?) async -> Bool {
        await attempt { account = try await api.setName(name) }
    }

    // MARK: Signing in and out

    /// Runs `then` now when signed in; otherwise opens the sign-in sheet and
    /// runs it once signed in.
    func requireSignIn(title: String = "Sign in to share", detail: String, then: @escaping () -> Void) {
        if account != nil { then() } else { signInPrompt = SignInPrompt(title: title, detail: detail, then: then) }
    }

    /// The avatar's "Sign in": nothing to resume.
    func promptSignIn() {
        signInPrompt = SignInPrompt(title: "Sign in to Rental Review",
                                    detail: "Share reviews, add places, and keep your own rental notebook.", then: nil)
    }

    func dismissSignIn() { signInPrompt = nil }

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
        let resume = signInPrompt?.then
        signInPrompt = nil
        if let flat { await loadFlat(flat) }
        await loadPermissions()
        // The pending action (a form, adding a place, the notebook) carries on.
        resume?()
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
        permissions = nil
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
        requireSignIn(title: "Sign in to your notebook",
                      detail: "Your notebook keeps the places you added, your reviews and your interactions.") { [weak self] in
            guard let self else { return }
            self.screen = .notebook
            Task { await self.loadNotebook() }
        }
    }

    func loadNotebook() async {
        notebookLoading = true
        await attempt {
            notebook = Notebook(
                reviews: try await api.ownReviews(),
                interactions: try await api.ownInteractions(),
                requests: try await api.ownDeletionRequests(),
                adminRequests: account?.isAdmin == true ? try await api.pendingDeletionRequests() : [],
                flats: try await api.ownFlats(),
                comments: try await api.ownComments().filter { $0.deleted_at == nil },
                commentReports: account?.isAdmin == true ? try await api.pendingCommentReports() : [])
        }
        notebookLoading = false
    }

    /// Opens one of the visitor's own records: the place's details, without the map.
    func openOwn(locationId: String, flatId: String, tab: FeedbackTab) {
        Task {
            await attempt {
                let location = try await api.location(locationId)
                select(location, flatId: flatId, tab: tab)
            }
        }
    }
}

/// One location fix, after asking permission ("Near me", the Add place tab).
@MainActor
final class Locator: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var completion: ((CLLocation?) -> Void)?

    /// With `askIfNeeded` false, an undecided permission is not asked for.
    func locate(askIfNeeded: Bool = true, _ completion: @escaping (CLLocation?) -> Void) {
        finish(nil)
        self.completion = completion
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        switch manager.authorizationStatus {
        case .notDetermined:
            if askIfNeeded { manager.requestWhenInUseAuthorization() } else { finish(nil) }
        case .denied, .restricted: finish(nil)
        default: manager.requestLocation()
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            guard completion != nil else { return }
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
        let done = completion
        completion = nil
        done?(location)
    }
}
