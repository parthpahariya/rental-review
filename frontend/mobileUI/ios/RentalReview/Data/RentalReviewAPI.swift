import Foundation

/// The Rental Review API (/api/v1), one function per endpoint the app uses.
final class RentalReviewAPI {
    let sessions: SessionStore
    private let session: URLSession

    init(sessions: SessionStore, session: URLSession = .shared) {
        self.sessions = sessions
        self.session = session
    }

    // MARK: Transport

    private func send<T: Decodable>(_ method: String, _ path: String, body: [String: Any?]? = nil, as type: T.Type) async throws -> T {
        let data = try await raw(method, path, body: body)
        return try JSONDecoder().decode(T.self, from: data)
    }

    @discardableResult
    private func raw(_ method: String, _ path: String, body: [String: Any?]? = nil) async throws -> Data {
        guard let url = URL(string: AppConfig.apiBaseURL + "/api/v1" + path) else {
            throw APIError(status: 0, code: "BAD_URL", message: "Something went wrong. Please try again.")
        }
        var request = URLRequest(url: url, timeoutInterval: 20)
        request.httpMethod = method
        if let token = sessions.token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            // Optional values become JSON null (e.g. clearing a name).
            let object = body.mapValues { $0 ?? NSNull() }
            request.httpBody = try JSONSerialization.data(withJSONObject: object)
        }
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            if status == 401 { sessions.token = nil }
            if let detail = try? JSONDecoder().decode(APIErrorBody.self, from: data).error {
                let extra = detail.fields?.first?.message.map { " \($0)" } ?? ""
                throw APIError(status: status, code: detail.code, message: detail.message + extra)
            }
            throw APIError(status: status, code: "HTTP_\(status)", message: "Something went wrong. Please try again.")
        }
        return data
    }

    private func q(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed.subtracting(CharacterSet(charactersIn: "&+=?"))) ?? value
    }

    /// Every page of a list, stopping after `maxPages` (a page holds at most 100).
    private func all<T: Decodable>(_ path: String, _ type: T.Type, maxPages: Int = 10) async throws -> (rows: [T], more: Bool) {
        var rows: [T] = []
        var cursor: String?
        var pages = 0
        repeat {
            let sep = path.contains("?") ? "&" : "?"
            let url = path + sep + "limit=100" + (cursor.map { "&cursor=\(q($0))" } ?? "")
            let page = try await send("GET", url, as: ListResponse<T>.self)
            rows += page.data
            cursor = page.page?.next_cursor
            pages += 1
        } while cursor != nil && pages < maxPages
        return (rows, cursor != nil)
    }

    // MARK: Configuration

    func mapConfig() async throws -> MapConfig { try await send("GET", "/map/config", as: ItemResponse<MapConfig>.self).data }
    func authProviders() async throws -> AuthProviders { try await send("GET", "/auth/providers", as: ItemResponse<AuthProviders>.self).data }

    // MARK: Account

    func signInWithGoogle(credential: String, reactivate: Bool = false) async throws -> SignInResult {
        try await send("POST", "/auth/google", body: ["credential": credential, "reactivate": reactivate],
                       as: ItemResponse<SignInResult>.self).data
    }
    func me() async throws -> Account { try await send("GET", "/me", as: ItemResponse<Account>.self).data }
    func setName(_ name: String?) async throws -> Account {
        try await send("PATCH", "/me", body: ["name": name], as: ItemResponse<Account>.self).data
    }
    func signOut() async throws { try await raw("DELETE", "/auth/session") }
    func deactivate() async throws { try await raw("POST", "/me/deactivation", body: ["confirm": true]) }

    // MARK: Places

    /// Places inside the map view; `more` is true when there were more than fit.
    func locations(west: Double, south: Double, east: Double, north: Double, reviewedOnly: Bool = true,
                   maxPages: Int = 5) async throws -> (rows: [Location], more: Bool) {
        try await all("/locations?bbox=\(west),\(south),\(east),\(north)" + (reviewedOnly ? "" : "&reviewed_only=false"),
                      Location.self, maxPages: maxPages)
    }
    /// Places on Rental Review whose name or address contains `text`.
    func searchListed(_ text: String, limit: Int = 5) async throws -> [Location] {
        try await send("GET", "/locations?q=\(q(text))&reviewed_only=false&limit=\(limit)", as: ListResponse<Location>.self).data
    }
    func location(_ id: String) async throws -> Location { try await send("GET", "/locations/\(id)", as: ItemResponse<Location>.self).data }
    func flats(_ locationId: String) async throws -> [Flat] { try await all("/locations/\(locationId)/flats", Flat.self).rows }
    func addPlace(address: String, buildingName: String?, latitude: Double, longitude: Double, flatLabel: String) async throws -> Flat {
        try await send("POST", "/locations", body: [
            "address": address, "building_name": buildingName,
            "latitude": latitude, "longitude": longitude, "flat_label": flatLabel,
        ], as: ItemResponse<Flat>.self).data
    }
    func addFlat(locationId: String, label: String) async throws -> Flat {
        try await send("POST", "/locations/\(locationId)/flats", body: ["label": label], as: ItemResponse<Flat>.self).data
    }
    func ownFlats() async throws -> [OwnFlat] { try await all("/me/flats", OwnFlat.self).rows }

    // MARK: Editing what you added

    func permissions(locationId: String) async throws -> LocationPermissions {
        try await send("GET", "/locations/\(locationId)/permissions", as: ItemResponse<LocationPermissions>.self).data
    }
    func editLocation(id: String, fields: [String: Any?]) async throws -> Location {
        try await send("PATCH", "/locations/\(id)", body: fields, as: ItemResponse<Location>.self).data
    }
    func editFlat(id: String, label: String) async throws -> Flat {
        try await send("PATCH", "/flats/\(id)", body: ["label": label], as: ItemResponse<Flat>.self).data
    }

    // MARK: Reviews

    func tenantReviews(flatId: String) async throws -> [Review] { try await all("/flats/\(flatId)/tenant-reviews", Review.self).rows }
    func interactions(flatId: String) async throws -> [Interaction] { try await all("/flats/\(flatId)/interactions", Interaction.self).rows }
    func ownReviews(flatId: String? = nil) async throws -> [Review] {
        try await all("/me/tenant-reviews" + (flatId.map { "?flat_id=\($0)" } ?? ""), Review.self).rows
    }
    func ownInteractions() async throws -> [Interaction] { try await all("/me/interactions", Interaction.self).rows }
    func postReview(flatId: String, rating: Int, feedback: String, start: String, end: String) async throws {
        try await raw("POST", "/flats/\(flatId)/tenant-reviews", body: [
            "rating": rating, "feedback": feedback, "tenancy_start_date": start, "tenancy_end_date": end,
        ])
    }
    func editReview(id: String, rating: Int, feedback: String) async throws {
        try await raw("PATCH", "/tenant-reviews/\(id)", body: ["rating": rating, "feedback": feedback])
    }
    func postInteraction(flatId: String, description: String, date: String) async throws {
        try await raw("POST", "/flats/\(flatId)/interactions", body: ["description": description, "interaction_date": date])
    }

    // MARK: Deletion requests

    func requestDeletion(reviewId: String, reason: String) async throws {
        try await raw("POST", "/tenant-reviews/\(reviewId)/deletion-requests", body: ["reason": reason])
    }
    func ownDeletionRequests() async throws -> [Deletion] { try await all("/me/deletion-requests", Deletion.self).rows }
    func pendingDeletionRequests() async throws -> [Deletion] { try await all("/admin/deletion-requests", Deletion.self).rows }
    func decide(requestId: String, approve: Bool) async throws {
        try await raw("POST", "/admin/deletion-requests/\(requestId)/decision", body: ["decision": approve ? "approved" : "rejected"])
    }

    // MARK: Discussions (comments under a review or interaction, oldest first)

    private func subjectPath(onReview: Bool, _ id: String) -> String {
        onReview ? "/tenant-reviews/\(id)" : "/interactions/\(id)"
    }
    func comments(onReview: Bool, subjectId: String) async throws -> [Comment] {
        try await all("\(subjectPath(onReview: onReview, subjectId))/comments", Comment.self).rows
    }
    func postComment(onReview: Bool, subjectId: String, body: String) async throws {
        try await raw("POST", "\(subjectPath(onReview: onReview, subjectId))/comments", body: ["body": body])
    }
    func editComment(id: String, body: String) async throws {
        try await raw("PATCH", "/comments/\(id)", body: ["body": body])
    }
    func deleteComment(id: String) async throws { try await raw("DELETE", "/comments/\(id)") }
    func reportComment(id: String, reason: String) async throws {
        try await raw("POST", "/comments/\(id)/reports", body: ["reason": reason])
    }
    func ownComments() async throws -> [Comment] { try await all("/me/comments", Comment.self).rows }
    func pendingCommentReports() async throws -> [CommentReport] {
        try await all("/admin/comment-reports", CommentReport.self).rows
    }
    func decideReport(id: String, remove: Bool) async throws {
        try await raw("POST", "/admin/comment-reports/\(id)/decision", body: ["decision": remove ? "removed" : "dismissed"])
    }
}
