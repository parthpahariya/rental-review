package com.boringman.rentalreview.data

import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.net.URLEncoder

/** The Rental Review API, one function per endpoint the app uses. */
class RentalReviewApi(private val client: ApiClient) {

    private suspend fun <T> get(path: String, s: KSerializer<T>): T = client.send("GET", path, null, s)!!
    private suspend fun <T> post(path: String, body: JsonElement?, s: KSerializer<T>): T =
        client.send("POST", path, body, s)!!
    private suspend fun <T> patch(path: String, body: JsonElement, s: KSerializer<T>): T =
        client.send("PATCH", path, body, s)!!
    private suspend fun delete(path: String) {
        client.send("DELETE", path, null, null as KSerializer<Unit>?)
    }

    private fun <T> list(s: KSerializer<T>) = ListResponse.serializer(s)
    private fun <T> item(s: KSerializer<T>) = ItemResponse.serializer(s)
    private fun q(value: String) = URLEncoder.encode(value, "UTF-8")

    /** Every page of a list, stopping after [maxPages] (the API caps a page at 100). */
    private suspend fun <T> all(path: String, s: KSerializer<T>, maxPages: Int = 10): Pair<List<T>, Boolean> {
        val rows = mutableListOf<T>()
        var cursor: String? = null
        var pages = 0
        do {
            val sep = if ('?' in path) '&' else '?'
            val url = path + sep + "limit=100" + (cursor?.let { "&cursor=${q(it)}" } ?: "")
            val page = get(url, list(s))
            rows += page.data
            cursor = page.page.next_cursor
            pages++
        } while (cursor != null && pages < maxPages)
        return rows to (cursor != null)
    }

    // Configuration
    suspend fun mapConfig() = get("/map/config", item(MapConfig.serializer())).data
    suspend fun authProviders() = get("/auth/providers", item(AuthProviders.serializer())).data

    // Account
    suspend fun signInWithGoogle(credential: String, reactivate: Boolean = false) = post(
        "/auth/google",
        buildJsonObject { put("credential", credential); put("reactivate", reactivate) },
        item(SignInResult.serializer()),
    ).data
    suspend fun me() = get("/me", item(Account.serializer())).data
    suspend fun setName(name: String?) = patch(
        "/me",
        buildJsonObject { if (name == null) put("name", JsonNull) else put("name", name) },
        item(Account.serializer()),
    ).data
    suspend fun signOut() = delete("/auth/session")
    suspend fun deactivate() {
        post("/me/deactivation", buildJsonObject { put("confirm", true) }, item(DeactivationResult.serializer()))
    }

    // Places
    /** Places inside the map view; `more` is true when there were more than fit. */
    suspend fun locationsIn(west: Double, south: Double, east: Double, north: Double): Pair<List<Location>, Boolean> =
        all("/locations?bbox=$west,$south,$east,$north", Location.serializer(), maxPages = 5)
    /** Places on Rental Review whose name or address contains [text]. */
    suspend fun searchListed(text: String, limit: Int = 5) =
        get("/locations?q=${q(text)}&reviewed_only=false&limit=$limit", list(Location.serializer())).data
    suspend fun location(id: String) = get("/locations/$id", item(Location.serializer())).data
    suspend fun flats(locationId: String) = all("/locations/$locationId/flats", Flat.serializer()).first
    suspend fun addPlace(address: String, buildingName: String?, latitude: Double, longitude: Double, flatLabel: String) =
        post(
            "/locations",
            buildJsonObject {
                put("address", address)
                if (buildingName.isNullOrBlank()) put("building_name", JsonNull) else put("building_name", buildingName)
                put("latitude", latitude)
                put("longitude", longitude)
                put("flat_label", flatLabel)
            },
            item(Flat.serializer()),
        ).data
    suspend fun addFlat(locationId: String, label: String) =
        post("/locations/$locationId/flats", buildJsonObject { put("label", label) }, item(Flat.serializer())).data
    suspend fun ownFlats() = all("/me/flats", OwnFlat.serializer()).first

    // Reviews
    suspend fun tenantReviews(flatId: String) = all("/flats/$flatId/tenant-reviews", Review.serializer()).first
    suspend fun interactions(flatId: String) = all("/flats/$flatId/interactions", Interaction.serializer()).first
    suspend fun ownReviews(flatId: String? = null) =
        all("/me/tenant-reviews" + (flatId?.let { "?flat_id=$it" } ?: ""), Review.serializer()).first
    suspend fun ownInteractions() = all("/me/interactions", Interaction.serializer()).first
    suspend fun postReview(flatId: String, rating: Int, feedback: String, start: String, end: String) = post(
        "/flats/$flatId/tenant-reviews",
        buildJsonObject {
            put("rating", rating); put("feedback", feedback)
            put("tenancy_start_date", start); put("tenancy_end_date", end)
        },
        item(Review.serializer()),
    ).data
    suspend fun editReview(reviewId: String, rating: Int, feedback: String) = patch(
        "/tenant-reviews/$reviewId",
        buildJsonObject { put("rating", rating); put("feedback", feedback) },
        item(Review.serializer()),
    ).data
    suspend fun postInteraction(flatId: String, description: String, date: String) = post(
        "/flats/$flatId/interactions",
        buildJsonObject { put("description", description); put("interaction_date", date) },
        item(Interaction.serializer()),
    ).data

    // Deletion requests
    suspend fun requestDeletion(reviewId: String, reason: String) = post(
        "/tenant-reviews/$reviewId/deletion-requests",
        buildJsonObject { put("reason", reason) },
        item(Deletion.serializer()),
    ).data
    suspend fun ownDeletionRequests() = all("/me/deletion-requests", Deletion.serializer()).first
    suspend fun pendingDeletionRequests() = all("/admin/deletion-requests", Deletion.serializer()).first
    suspend fun decide(requestId: String, approve: Boolean) = post(
        "/admin/deletion-requests/$requestId/decision",
        buildJsonObject { put("decision", if (approve) "approved" else "rejected") },
        item(Deletion.serializer()),
    ).data
}

@kotlinx.serialization.Serializable
data class DeactivationResult(val status: String)
