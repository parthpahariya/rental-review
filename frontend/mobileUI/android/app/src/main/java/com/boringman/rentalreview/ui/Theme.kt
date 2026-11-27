package com.boringman.rentalreview.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/** The web app's palette (fronend/webUI/src/styles.css). */
object Brand {
    val ink = Color(0xFF0F172A)
    val gold = Color(0xFFF59E0B)
    val goldWash = Color(0xFFFFFBEB)
    val muted = Color(0xFF64748B)
    val line = Color(0xFFE7E0CF)
    val surface = Color(0xFFFFFFFF)
    val good = Color(0xFF15803D)
    val fair = Color(0xFFB45309)
    val poor = Color(0xFFB91C1C)
    val searched = Color(0xFFE11D48)
    /** Segmented-control tracks and quiet buttons. */
    val beige = Color(0xFFF4EFDF)
    /** "Deletion pending" pill. */
    val pendingWash = Color(0xFFFEF3C7)
    val pendingInk = Color(0xFF92400E)
}

@Composable
fun RentalReviewTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Brand.ink,
            onPrimary = Color.White,
            secondary = Brand.gold,
            onSecondary = Brand.ink,
            background = Brand.goldWash,
            surface = Brand.surface,
            onSurface = Brand.ink,
            onBackground = Brand.ink,
            error = Brand.poor,
        ),
        content = content,
    )
}

/** Rating colour, as the web's score badges: green 4+, amber 3+, red below. */
fun ratingColor(rating: Double?) = when {
    rating == null -> Brand.muted
    rating >= 4 -> Brand.good
    rating >= 3 -> Brand.fair
    else -> Brand.poor
}
