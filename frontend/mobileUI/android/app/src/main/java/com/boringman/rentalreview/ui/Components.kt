package com.boringman.rentalreview.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.boringman.rentalreview.data.Account
import com.boringman.rentalreview.data.Interaction
import com.boringman.rentalreview.data.Location
import com.boringman.rentalreview.data.Review
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter

/** The amber house mark and "rentalreview" wordmark. */
@Composable
fun BrandMark(onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.clickable(onClickLabel = "Rental Review home", onClick = onClick),
    ) {
        Box(
            Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)).background(Brand.gold),
            contentAlignment = Alignment.Center,
        ) { Icon(Icons.Filled.Home, contentDescription = null, tint = Brand.ink, modifier = Modifier.size(20.dp)) }
        Spacer(Modifier.width(8.dp))
        Text("rental", fontSize = 19.sp, color = Brand.ink)
        Text("review", fontSize = 19.sp, fontWeight = FontWeight.Bold, color = Brand.ink)
    }
}

/** Sign in, or the account's initial, which opens the notebook. */
@Composable
fun AccountButton(account: Account?, signingIn: Boolean, onSignIn: () -> Unit, onOpen: () -> Unit) {
    if (account == null) {
        TextButton(onClick = onSignIn, enabled = !signingIn) {
            Icon(Icons.Filled.Person, contentDescription = null)
            Spacer(Modifier.width(6.dp))
            Text(if (signingIn) "Signing in…" else "Sign in", fontWeight = FontWeight.SemiBold)
        }
    } else {
        IconButton(onClick = onOpen) {
            Box(
                Modifier.size(38.dp).clip(CircleShape).background(Brand.gold)
                    .semantics { contentDescription = "Your account" },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    (account.name ?: account.email ?: "?").trim().take(1).uppercase(),
                    fontWeight = FontWeight.Bold, color = Brand.ink,
                )
            }
        }
    }
}

/** The coloured rating square used in lists. */
@Composable
fun ScoreBadge(rating: Double?) {
    Box(
        Modifier.size(48.dp).clip(RoundedCornerShape(12.dp)).background(ratingColor(rating)),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            rating?.let { "%.1f".format(it) } ?: "New",
            color = Color.White, fontWeight = FontWeight.Bold, fontSize = if (rating == null) 13.sp else 17.sp,
        )
    }
}

@Composable
fun Stars(rating: Int, size: Int = 16) {
    Row(Modifier.semantics { contentDescription = "$rating out of 5 stars" }) {
        repeat(5) { i ->
            Icon(
                Icons.Filled.Star, contentDescription = null,
                tint = if (i < rating) Brand.gold else Brand.line, modifier = Modifier.size(size.dp),
            )
        }
    }
}

/** A place in a list: rating, name, address and review counts. */
@Composable
fun PlaceRow(location: Location, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable(onClick = onClick).padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ScoreBadge(location.summary?.average_rating)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(location.title, fontWeight = FontWeight.Bold, color = Brand.ink)
            Text(location.address, color = Brand.muted, fontSize = 13.sp, maxLines = 1)
            location.summary?.let {
                Text(
                    "${it.tenant_review_count} tenant ${if (it.tenant_review_count == 1) "review" else "reviews"} · " +
                        "${it.interaction_review_count} ${if (it.interaction_review_count == 1) "interaction" else "interactions"}",
                    color = Brand.muted, fontSize = 12.sp,
                )
            }
        }
    }
}

/** One tenant review or interaction. Reviews name no one: the card says its kind. */
@Composable
fun FeedbackCard(review: Review? = null, interaction: Interaction? = null, own: Review? = null, onEdit: (Review) -> Unit = {}) {
    val isReview = review != null
    Column(
        Modifier.fillMaxWidth().border(1.dp, Brand.line, RoundedCornerShape(16.dp))
            .background(Brand.surface, RoundedCornerShape(16.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(30.dp).clip(CircleShape).background(if (isReview) Brand.goldWash else Color(0xFFEFF6FF)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(if (isReview) Icons.Filled.Home else Icons.Filled.Chat, contentDescription = null,
                    tint = Brand.ink, modifier = Modifier.size(16.dp))
            }
            Spacer(Modifier.width(8.dp))
            Text(if (isReview) "Tenant review" else "Interaction", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            if (own?.can_edit == true) TextButton(onClick = { onEdit(own) }) { Text("Edit") }
        }
        if (review != null) {
            Stars(review.rating)
            Text(
                "Tenancy ${shortDate(review.tenancy_start_date)} – ${shortDate(review.tenancy_end_date)}",
                color = Brand.muted, fontSize = 12.sp,
            )
            Text(review.feedback, color = Brand.ink)
        }
        if (interaction != null) {
            Text("On ${shortDate(interaction.interaction_date)}", color = Brand.muted, fontSize = 12.sp)
            Text(interaction.description, color = Brand.ink)
        }
    }
}

private val shortDateFormat = DateTimeFormatter.ofPattern("d MMM yyyy")

/** "2024-01-01" or a timestamp → "1 Jan 2024". */
fun shortDate(value: String): String = runCatching {
    if (value.length == 10) LocalDate.parse(value).format(shortDateFormat)
    else OffsetDateTime.parse(value).format(shortDateFormat)
}.getOrDefault(value)

/** A small pill label, e.g. a request's status. */
@Composable
fun Badge(text: String, color: Color = Brand.muted) {
    Text(
        text,
        color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
        modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(color).padding(horizontal = 10.dp, vertical = 3.dp),
    )
}
