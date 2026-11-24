import Foundation

// The API's shapes (see API_CONTRACTS.md). Field names match the JSON
// (snake_case); unknown fields are ignored, so the server can add fields.

struct Summary: Codable, Hashable {
    var tenant_review_count: Int = 0
    var interaction_review_count: Int = 0
    var average_rating: Double?
}

struct Location: Codable, Hashable, Identifiable {
    let id: String
    let address: String
    let building_name: String?
    let latitude: Double
    let longitude: Double
    var summary: Summary?

    var title: String { building_name ?? "Rental property" }
}

struct Flat: Codable, Hashable, Identifiable {
    let id: String
    let label: String
    let location: Location
    var summary: Summary = Summary()
}

/// A flat the signed-in user added, with whether they may still edit it.
struct OwnFlat: Codable, Hashable, Identifiable {
    let id: String
    let label: String
    let location: Location
    var added_place: Bool = false
    var can_edit: Bool = false
}

/// Where one of the user's own reviews is (only in their own lists).
struct Place: Codable, Hashable {
    let building_name: String?
    let address: String
    let flat_label: String
}

struct Review: Codable, Hashable, Identifiable {
    let id: String
    let flat_id: String
    var location_id: String?
    var place: Place?
    let rating: Int
    let feedback: String
    let tenancy_start_date: String
    let tenancy_end_date: String
    let submitted_at: String
    let editing_deadline: String
    var can_edit: Bool?
    var can_request_deletion: Bool?
    var deleted_at: String?
    /// Visible comments in this review's discussion.
    var comment_count: Int?
}

struct Interaction: Codable, Hashable, Identifiable {
    let id: String
    let flat_id: String
    var location_id: String?
    var place: Place?
    let description: String
    let interaction_date: String
    let submitted_at: String
    /// Visible comments in this interaction's discussion.
    var comment_count: Int?
}

/// A comment in the discussion under a review or interaction. It names no one;
/// `by_subject_author` marks replies from whoever wrote the review/interaction.
struct Comment: Codable, Hashable, Identifiable {
    let id: String
    let subject_type: String
    let body: String
    let submitted_at: String
    var edited: Bool?
    var by_subject_author: Bool?
    /// Only when signed in: the viewer wrote it, and may still edit it.
    var mine: Bool?
    var can_edit: Bool?
    /// Only in the viewer's own list.
    var place: Place?
    var deleted_at: String?
    var removed_at: String?

    var onReview: Bool { subject_type == "tenant_review" }
}

/// What a reported comment replies to: a review (feedback) or interaction (description).
struct CommentSubject: Codable, Hashable {
    var feedback: String?
    var description: String?
    var text: String { feedback ?? description ?? "" }
}

/// A reported comment in the admin queue, with what it replies to.
struct CommentReport: Codable, Hashable, Identifiable {
    let id: String
    let reason: String
    let status: String
    let comment: Comment
    let subject: CommentSubject
    let place: Place
}

struct Account: Codable, Hashable {
    let id: String
    var name: String?
    var name_is_custom: Bool?
    var email: String?
    var role: String?

    var isAdmin: Bool { role == "admin" }
}

struct Deletion: Codable, Hashable, Identifiable {
    let id: String
    let tenant_review_id: String
    let reason: String
    let status: String
    var decision_note: String?
    var review: Review?
}

struct PageInfo: Codable { var next_cursor: String? }
struct ListResponse<T: Decodable>: Decodable { let data: [T]; var page: PageInfo? }
struct ItemResponse<T: Decodable>: Decodable { let data: T }

struct SessionToken: Codable { let token: String }

/// POST /auth/google: signed in, or the account must confirm reactivation first.
struct SignInResult: Codable {
    let outcome: String
    var account: Account?
    var session: SessionToken?
}

struct AuthProviders: Codable { var google_client_id: String? }

/// GET /map/config: which map and search provider, and its browser key.
struct MapConfig: Codable { let provider: String; var api_key: String? }

struct APIErrorBody: Codable { let error: APIErrorDetail }
struct APIErrorDetail: Codable {
    let code: String
    let message: String
    var fields: [APIFieldError]?
}
struct APIFieldError: Codable { var message: String? }

/// An error the API returned, with its machine code and a message to show.
struct APIError: LocalizedError {
    let status: Int
    let code: String
    let message: String
    var errorDescription: String? { message }
}
