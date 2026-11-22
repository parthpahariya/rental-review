package com.boringman.rentalreview.search

import com.boringman.rentalreview.data.Location

/**
 * The search box's rules, the same as the web app's: wait for 4 letters, go
 * straight to typed coordinates, list buildings already on Rental Review first
 * (free), and ask the map provider only when fewer than 3 of those match.
 */
class SearchService(
    private val listed: suspend (String) -> List<Location>,
    private val provider: suspend () -> PlaceSearch,
) {
    data class Result(val suggestions: List<Suggestion>, val attribution: String?)

    suspend fun search(text: String, near: Point?): Result {
        val term = text.trim()
        if (term.length < MIN_SEARCH) return Result(emptyList(), null)
        if (Coordinates.looksLike(term)) {
            val point = Coordinates.parse(term) ?: return Result(emptyList(), null)
            val area = Coordinates.area(point)
            return Result(
                listOf(Suggestion(area.name, "Go to these coordinates", Suggestion.Kind.BUILDING) { area }),
                null,
            )
        }
        val own = runCatching { listed(term) }.getOrDefault(emptyList()).map { l ->
            val name = l.building_name ?: l.address
            val area = Area(name, null, Point(l.latitude, l.longitude), zoom = 18.0)
            Suggestion(
                name,
                if (l.building_name != null) "On Rental Review · ${l.address}" else "On Rental Review",
                Suggestion.Kind.LISTED,
            ) { area }
        }
        if (own.size >= ENOUGH_LISTED) return Result(own, null)
        val search = provider()
        val found = try {
            search.search(term, near)
        } catch (e: Exception) {
            if (own.isEmpty()) throw e else emptyList()
        }
        val names = own.map { it.name.lowercase() }.toSet()
        return Result(own + found.filter { it.name.lowercase() !in names }, search.attribution)
    }

    companion object {
        const val MIN_SEARCH = 4
        const val ENOUGH_LISTED = 3
    }
}
