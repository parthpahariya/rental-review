package com.boringman.rentalreview.maps

import com.boringman.rentalreview.data.Location

/** A place as drawn on screen: one building's pin, or a bubble of several. */
sealed class Marker {
    abstract val x: Float
    abstract val y: Float

    data class Pin(val location: Location, override val x: Float, override val y: Float) : Marker()
    data class Bubble(val locations: List<Location>, override val x: Float, override val y: Float) : Marker()
}

/** Closest zoom used; every building gets its own pin at this level. */
const val MAX_ZOOM = 19.0

/**
 * How far (dp) pins reach to merge into one bubble, as on the web: wide when
 * zoomed out so the city reads as a few bubbles, tight close up.
 */
fun clusterRadius(zoom: Double) = when {
    zoom <= 13 -> 80f
    zoom <= 15 -> 65f
    zoom <= 16 -> 50f
    else -> 30f
}

/**
 * Groups places whose screen positions are within [radiusPx] of a group's
 * first place. [project] maps a place to screen pixels (or null if off screen).
 */
fun cluster(
    locations: List<Location>,
    zoom: Double,
    radiusPx: Float,
    project: (Location) -> Pair<Float, Float>?,
): List<Marker> {
    val groups = mutableListOf<Triple<Float, Float, MutableList<Location>>>()
    for (location in locations) {
        val (x, y) = project(location) ?: continue
        val near = if (zoom >= MAX_ZOOM) null else groups.firstOrNull { (gx, gy) ->
            val dx = gx - x
            val dy = gy - y
            dx * dx + dy * dy <= radiusPx * radiusPx
        }
        if (near != null) near.third += location else groups += Triple(x, y, mutableListOf(location))
    }
    return groups.map { (x, y, members) ->
        if (members.size == 1) Marker.Pin(members[0], x, y) else Marker.Bubble(members, x, y)
    }
}

/** "1.2k" style counts for bubbles. */
fun shortCount(n: Int): String = when {
    n < 1000 -> n.toString()
    n < 10_000 -> "%.1fk".format(n / 1000.0).replace(".0k", "k")
    else -> "${n / 1000}k"
}

/** The rating label on a building's pin. */
fun pinLabel(rating: Double?) = rating?.let { "★ %.1f".format(it) } ?: "New"
