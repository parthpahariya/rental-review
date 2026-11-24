package com.boringman.rentalreview.data

import kotlinx.serialization.Serializable

/**
 * The API's shapes (see API_CONTRACTS.md). Only what the app reads is declared;
 * unknown fields are ignored, so the server can add fields safely.
 */

@Serializable
data class Summary(
    val tenant_review_count: Int = 0,
    val interaction_review_count: Int = 0,
    val average_rating: Double? = null,
)

@Serializable
data class Location(
    val id: String,
    val address: String,
    val building_name: String? = null,
    val latitude: Double,
    val longitude: Double,
    val summary: Summary? = null,
) {
    val title: String get() = building_name ?: "Rental property"
}

@Serializable
data class Flat(
    val id: String,
    val label: String,
    val location: Location,
    val summary: Summary = Summary(),
)

/** A flat the signed-in user added, with whether they may still edit it. */
@Serializable
data class OwnFlat(
    val id: String,
    val label: String,
    val location: Location,
    val summary: Summary = Summary(),
    val added_place: Boolean = false,
    val can_edit: Boolean = false,
)

/** Where one of the user's own reviews is (only in their own lists). */
@Serializable
data class Place(
    val building_name: String? = null,
    val address: String,
    val flat_label: String,
    val latitude: Double,
    val longitude: Double,
)

@Serializable
data class Review(
    val id: String,
    val flat_id: String,
    val location_id: String? = null,
    val place: Place? = null,
    val rating: Int,
    val feedback: String,
    val tenancy_start_date: String,
    val tenancy_end_date: String,
    val submitted_at: String,
    val editing_deadline: String,
    val can_edit: Boolean = false,
    val can_request_deletion: Boolean = false,
    val deleted_at: String? = null,
    /** Visible comments in this review's discussion. */
    val comment_count: Int = 0,
)

@Serializable
data class Interaction(
    val id: String,
    val flat_id: String,
    val location_id: String? = null,
    val place: Place? = null,
    val description: String,
    val interaction_date: String,
    val submitted_at: String,
    /** Visible comments in this interaction's discussion. */
    val comment_count: Int = 0,
)

/**
 * A comment in the discussion under a review or interaction. It names no one;
 * [by_subject_author] marks replies from whoever wrote the review/interaction.
 */
@Serializable
data class Comment(
    val id: String,
    val subject_type: String,
    val body: String,
    val submitted_at: String,
    val edited: Boolean = false,
    val by_subject_author: Boolean = false,
    /** Only when signed in: the viewer wrote it, and may still edit it. */
    val mine: Boolean = false,
    val can_edit: Boolean = false,
    /** Only in the viewer's own list. */
    val place: Place? = null,
    val deleted_at: String? = null,
    val removed_at: String? = null,
) {
    val onReview: Boolean get() = subject_type == "tenant_review"
}

/** What a reported comment replies to: a review (feedback) or interaction (description). */
@Serializable
data class CommentSubject(val feedback: String? = null, val description: String? = null) {
    val text: String get() = feedback ?: description.orEmpty()
}

/** A reported comment in the admin queue, with what it replies to. */
@Serializable
data class CommentReport(
    val id: String,
    val reason: String,
    val status: String,
    val comment: Comment,
    val subject: CommentSubject,
    val place: Place,
)

@Serializable
data class ReportResult(val id: String, val status: String)

@Serializable
data class Account(
    val id: String,
    val name: String? = null,
    val name_is_custom: Boolean = false,
    val email: String? = null,
    val role: String = "user",
    val status: String = "active",
) {
    val isAdmin: Boolean get() = role == "admin"
}

@Serializable
data class Deletion(
    val id: String,
    val tenant_review_id: String,
    val reason: String,
    val status: String,
    val decision_note: String? = null,
    val review: Review? = null,
)

@Serializable
data class Permissions(
    val can_edit_location: Boolean = false,
    val editable_flat_ids: List<String> = emptyList(),
)

@Serializable
data class Page(val next_cursor: String? = null)

@Serializable
data class ListResponse<T>(val data: List<T>, val page: Page = Page())

@Serializable
data class ItemResponse<T>(val data: T)

@Serializable
data class SessionToken(val token: String, val expires_at: String)

/** POST /auth/google: signed in, or the account must confirm reactivation first. */
@Serializable
data class SignInResult(
    val outcome: String,
    val account: Account? = null,
    val session: SessionToken? = null,
)

@Serializable
data class AuthProviders(val google_client_id: String? = null)

/** GET /map/config: which map and search provider, and its browser key. */
@Serializable
data class MapConfig(val provider: String, val api_key: String? = null)

@Serializable
data class ApiErrorBody(val error: ApiErrorDetail)

@Serializable
data class ApiErrorDetail(
    val code: String,
    val message: String,
    val fields: List<ApiFieldError> = emptyList(),
)

@Serializable
data class ApiFieldError(val field: String? = null, val message: String? = null)
