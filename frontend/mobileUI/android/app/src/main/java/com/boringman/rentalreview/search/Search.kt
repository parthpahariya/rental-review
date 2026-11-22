package com.boringman.rentalreview.search

/** A point in WGS84 degrees. */
data class Point(val latitude: Double, val longitude: Double)

data class Bounds(val west: Double, val south: Double, val east: Double, val north: Double)

/** Where the map should go: an area to fit, or a single building to mark. */
data class Area(
    val name: String,
    val detail: String? = null,
    val center: Point,
    val bounds: Bounds? = null,
    val zoom: Double = 15.0,
    /** A single building rather than an area: the map marks its spot. */
    val exact: Boolean = false,
)

/** One line in the suggestion list; its place is looked up only when chosen. */
class Suggestion(
    val name: String,
    val detail: String?,
    val kind: Kind,
    val resolve: suspend () -> Area,
) {
    enum class Kind { AREA, BUILDING, LISTED }
}

/** A map provider's place search (Ola Maps or Photon). */
interface PlaceSearch {
    /** Text shown under the results, as the provider's terms require. */
    val attribution: String
    suspend fun search(text: String, near: Point?): List<Suggestion>
}

/** Search covers India; the map opens on Bengaluru. */
object Region {
    const val NAME = "India"
    const val COUNTRY_CODE = "IN"
    val bounds = Bounds(68.1, 6.5, 97.5, 35.7)
    val defaultCenter = Point(12.955, 77.63)
    const val DEFAULT_NAME = "Bengaluru"
}

/**
 * Typed coordinates, e.g. "12.9716, 77.5946" copied from a phone's map app.
 * They're the visitor's own input, so going there needs no provider.
 */
object Coordinates {
    private val pair = Regex("""^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$""")

    /** True for text that is just two numbers, whether or not they're valid. */
    fun looksLike(text: String) = pair.matches(text)

    /** "latitude, longitude" inside the search region, or null. */
    fun parse(text: String): Point? {
        val match = pair.matchEntire(text) ?: return null
        val lat = match.groupValues[1].toDouble()
        val lng = match.groupValues[2].toDouble()
        val b = Region.bounds
        if (lat < b.south || lat > b.north || lng < b.west || lng > b.east) return null
        return Point(lat, lng)
    }

    fun area(point: Point) = Area(
        name = "%.5f, %.5f".format(point.latitude, point.longitude),
        detail = "Coordinates",
        center = point,
        zoom = 17.0,
        exact = true,
    )
}

/** Place types (as Ola Maps returns them) that describe an area, not a building. */
fun isAreaType(types: List<String>) = types.any {
    it == "locality" || it == "neighborhood" || it == "colloquial_area" || it == "postal_code" ||
        it == "country" || it == "political" || it.startsWith("sublocality") ||
        it.startsWith("administrative_area")
}

fun isCityType(types: List<String>) = types.any { it == "locality" || it.startsWith("administrative_area") }
