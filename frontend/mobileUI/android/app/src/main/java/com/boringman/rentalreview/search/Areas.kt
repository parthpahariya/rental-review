package com.boringman.rentalreview.search

import com.boringman.rentalreview.data.Location
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/** An area that has reviewed places on Rental Review, with how many. */
data class ReviewedArea(val area: Area, val places: Int)

/**
 * "Areas with reviews" on the home page, worked out from our own reviewed places'
 * addresses (no map provider involved): the locality part of each address, with
 * phases and stages folded together ("JP Nagar 6th Phase" counts as "JP Nagar").
 */
object Areas {
    private val pincode = Regex("""^\d{6}$""")
    private val trailingPin = Regex("""[\s-]*\d{6}$""")
    private val subdivision = Regex(
        """\s*(\d+\s*(st|nd|rd|th)?\s+)?(phase|stage|block|sector)(\s+[\w-]+)?$""",
        RegexOption.IGNORE_CASE,
    )
    private val ordinalSubdivision = Regex("""\s+\d+\s*(st|nd|rd|th)\s*$""", RegexOption.IGNORE_CASE)
    /** Address parts that name a city, state or country, never a locality. */
    private val wide = setOf(
        "india", "bengaluru", "bangalore", "bengaluru urban", "bangalore urban", "karnataka",
        "mumbai", "maharashtra", "pune", "delhi", "new delhi", "gurugram", "gurgaon", "haryana",
        "noida", "uttar pradesh", "hyderabad", "telangana", "chennai", "tamil nadu", "kolkata",
        "west bengal", "ahmedabad", "gujarat", "kerala", "kochi",
    )

    /** The locality an address is in, or null when it can't be told. */
    fun locality(address: String): String? {
        val parts = address.split(',').map { it.trim().replace(trailingPin, "").trim() }.filter { it.isNotEmpty() }
        val kept = parts.filterNot { pincode.matches(it) || it.lowercase() in wide }
        // The first part is the street or building; the locality comes after it.
        if (kept.size < 2) return null
        val raw = kept.last()
        val name = raw.replace(subdivision, "").replace(ordinalSubdivision, "").trim()
        return name.takeIf { it.length >= 3 && it.any(Char::isLetter) }
    }

    fun from(locations: List<Location>, limit: Int = 8): List<ReviewedArea> =
        locations.mapNotNull { l -> locality(l.address)?.let { it to l } }
            .groupBy { it.first.lowercase() }
            .values
            .map { group ->
                val name = group.groupingBy { it.first }.eachCount().maxBy { it.value }.key
                val places = group.map { it.second }
                val lats = places.map { it.latitude }
                val lngs = places.map { it.longitude }
                val pad = 0.004
                ReviewedArea(
                    Area(
                        name,
                        center = Point(lats.average(), lngs.average()),
                        bounds = Bounds(lngs.min() - pad, lats.min() - pad, lngs.max() + pad, lats.max() + pad),
                        zoom = 15.0,
                    ),
                    places.size,
                )
            }
            .sortedWith(compareByDescending<ReviewedArea> { it.places }.thenBy { it.area.name })
            .take(limit)
}

/** Great-circle distance in metres. */
fun distanceMeters(a: Point, b: Point): Double {
    val r = 6_371_000.0
    val dLat = Math.toRadians(b.latitude - a.latitude)
    val dLng = Math.toRadians(b.longitude - a.longitude)
    val h = sin(dLat / 2).pow(2) +
        cos(Math.toRadians(a.latitude)) * cos(Math.toRadians(b.latitude)) * sin(dLng / 2).pow(2)
    return 2 * r * asin(sqrt(h))
}

/** "350 m", "1.2 km". */
fun formatDistance(meters: Double): String = when {
    meters < 1000 -> "${(meters / 10).toInt() * 10} m"
    meters < 10_000 -> "%.1f km".format(meters / 1000)
    else -> "${(meters / 1000).toInt()} km"
}

/** Rough bounds a phone screen shows around [center] at [zoom], for loading a list without a map. */
fun approximateBounds(center: Point, zoom: Double): Bounds {
    val degPerDp = 360.0 / (512.0 * 2.0.pow(zoom))
    val halfW = 200 * degPerDp
    val halfH = 220 * degPerDp * cos(Math.toRadians(center.latitude))
    return Bounds(
        (center.longitude - halfW).coerceIn(-180.0, 180.0),
        (center.latitude - halfH).coerceIn(-90.0, 90.0),
        (center.longitude + halfW).coerceIn(-180.0, 180.0),
        (center.latitude + halfH).coerceIn(-90.0, 90.0),
    )
}
