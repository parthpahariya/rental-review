package com.boringman.rentalreview.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.boringman.rentalreview.data.Account
import com.boringman.rentalreview.data.Interaction
import com.boringman.rentalreview.data.Location
import com.boringman.rentalreview.data.Review
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter

/** A white card with the hairline border. */
fun Modifier.card(radius: Dp = 18.dp, border: Color = Brand.line, width: Dp = 1.dp) =
    clip(RoundedCornerShape(radius)).background(Brand.surface).border(width, border, RoundedCornerShape(radius))

/** A dashed rounded outline (e.g. "+ Add flat"). */
fun Modifier.dashedBorder(color: Color, radius: Dp) = drawBehind {
    drawRoundRect(
        color = color,
        cornerRadius = CornerRadius(radius.toPx()),
        style = Stroke(width = 1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(10f, 8f))),
    )
}

/** A round white button floating over the map or a header (48 dp target). */
@Composable
fun RoundIconButton(
    icon: ImageVector,
    description: String,
    onClick: () -> Unit,
    background: Color = Brand.surface,
    tint: Color = Brand.ink,
    size: Dp = 48.dp,
) {
    Box(
        Modifier.size(size).shadow(6.dp, CircleShape).clip(CircleShape).background(background)
            .clickable(onClickLabel = description, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) { Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(22.dp)) }
}

/** The gold call to action with ink text. */
@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    height: Dp = 54.dp,
) {
    Button(
        onClick = onClick, enabled = enabled, modifier = modifier.height(height),
        shape = RoundedCornerShape(16.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = Brand.gold, contentColor = Brand.ink,
            disabledContainerColor = Brand.gold.copy(alpha = 0.45f), disabledContentColor = Brand.ink.copy(alpha = 0.6f),
        ),
    ) { Text(text, fontSize = 16.sp, fontWeight = FontWeight.ExtraBold) }
}

/** The secondary, ink-filled button. */
@Composable
fun InkButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, height: Dp = 48.dp) {
    Button(
        onClick = onClick, enabled = enabled, modifier = modifier.height(height),
        shape = RoundedCornerShape(12.dp), contentPadding = PaddingValues(horizontal = 14.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Brand.ink, contentColor = Color.White),
    ) { Text(text, fontSize = 14.sp, fontWeight = FontWeight.Bold) }
}

/** An outlined button on white. */
@Composable
fun QuietButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    color: Color = Brand.ink,
    border: Color = Brand.line,
    enabled: Boolean = true,
    height: Dp = 48.dp,
) {
    OutlinedButton(
        onClick = onClick, enabled = enabled, modifier = modifier.height(height),
        shape = RoundedCornerShape(12.dp), border = BorderStroke(1.dp, border),
        contentPadding = PaddingValues(horizontal = 14.dp),
        colors = ButtonDefaults.outlinedButtonColors(containerColor = Brand.surface, contentColor = color),
    ) { Text(text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold) }
}

/** A text-only action in the accent colour (48 dp tall). */
@Composable
fun LinkButton(text: String, onClick: () -> Unit, color: Color = Brand.fair, content: @Composable RowScope.() -> Unit = {}) {
    TextButton(onClick = onClick, modifier = Modifier.heightIn(min = 48.dp)) {
        content()
        Text(text, color = color, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
    }
}

/** The segmented control: a beige track with the chosen option on white. */
@Composable
fun Segmented(options: List<String>, selected: Int, onSelect: (Int) -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Brand.beige).padding(4.dp),
    ) {
        options.forEachIndexed { i, label ->
            val on = i == selected
            Box(
                Modifier.weight(1f).height(48.dp)
                    .then(if (on) Modifier.shadow(1.dp, RoundedCornerShape(10.dp)) else Modifier)
                    .clip(RoundedCornerShape(10.dp))
                    .background(if (on) Brand.surface else Color.Transparent)
                    .clickable(role = Role.Tab) { onSelect(i) }
                    .semantics { this.selected = on },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label, fontSize = 14.sp, maxLines = 1,
                    fontWeight = if (on) FontWeight.Bold else FontWeight.SemiBold,
                    color = if (on) Brand.ink else Brand.muted,
                )
            }
        }
    }
}

/** A filter or topic chip: ink when on, white with a hairline when off. */
@Composable
fun Chip(text: String, on: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier.minimumInteractiveComponentSize().heightIn(min = 40.dp).clip(RoundedCornerShape(20.dp))
            .background(if (on) Brand.ink else Brand.surface)
            .border(1.dp, if (on) Brand.ink else Brand.line, RoundedCornerShape(20.dp))
            .clickable(role = Role.Checkbox, onClick = onClick)
            .semantics { selected = on }
            .padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text, fontSize = 13.sp, color = if (on) Color.White else Brand.ink,
            fontWeight = if (on) FontWeight.SemiBold else FontWeight.Medium,
        )
    }
}

/** The grab handle at the top of a sheet. */
@Composable
fun Grabber(modifier: Modifier = Modifier) {
    Box(modifier.width(40.dp).height(5.dp).clip(RoundedCornerShape(3.dp)).background(Brand.line))
}

/** The coloured rating square used in lists: colour always comes with its number. */
@Composable
fun ScoreBadge(rating: Double?, size: Dp = 48.dp) {
    Box(
        Modifier.size(size).clip(RoundedCornerShape(14.dp)).background(ratingColor(rating))
            .semantics { contentDescription = rating?.let { "Rated %.1f out of 5".format(it) } ?: "Not rated yet" },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            rating?.let { "%.1f".format(it) } ?: "New",
            color = Color.White, fontWeight = FontWeight.ExtraBold, fontSize = if (rating == null) 13.sp else 17.sp,
        )
    }
}

/** A small rating tag on a review ("4.0" on green). */
@Composable
fun RatingTag(rating: Int, decimals: Boolean = true) {
    Box(
        Modifier.defaultMinSize(minWidth = 30.dp).height(28.dp).clip(RoundedCornerShape(8.dp))
            .background(ratingColor(rating.toDouble())).padding(horizontal = 8.dp)
            .semantics { contentDescription = "Rated $rating out of 5" },
        contentAlignment = Alignment.Center,
    ) {
        Text(if (decimals) "$rating.0" else "$rating", color = Color.White, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp)
    }
}

/** The round gold avatar with the account's initial. */
@Composable
fun Avatar(account: Account, size: Dp = 52.dp, fontSize: Int = 18) {
    Box(
        Modifier.size(size).clip(CircleShape).background(Brand.gold),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            (account.name ?: account.email ?: "?").trim().take(1).uppercase(),
            fontWeight = FontWeight.ExtraBold, color = Brand.ink, fontSize = fontSize.sp,
        )
    }
}

private fun plural(n: Int, one: String, many: String = one + "s") = "$n ${if (n == 1) one else many}"

/** A place in the results: rating tile, name, address · distance, counts. */
@Composable
fun PlaceRow(location: Location, distance: String?, highlighted: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth()
            .card(18.dp, if (highlighted) Brand.gold else Brand.line, if (highlighted) 2.dp else 1.dp)
            .clickable(onClickLabel = "Open ${location.title}", onClick = onClick)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        ScoreBadge(location.summary?.average_rating)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(location.title, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = Brand.ink, maxLines = 1)
            Text(
                location.address + (distance?.let { " · $it" } ?: ""),
                color = Brand.muted, fontSize = 13.sp, maxLines = 1,
            )
            val s = location.summary
            Text(
                "${plural(s?.tenant_review_count ?: 0, "review")} · ${plural(s?.interaction_review_count ?: 0, "interaction")}",
                color = Brand.ink, fontSize = 13.sp, fontWeight = FontWeight.Medium,
            )
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = Brand.muted)
    }
}

/** One tenant review or interaction. Reviews name no one: the card says its kind. */
@Composable
fun FeedbackCard(
    review: Review? = null,
    interaction: Interaction? = null,
    own: Review? = null,
    onEdit: (Review) -> Unit = {},
    /** Called when the post itself is tapped, e.g. to open its discussion. */
    onOpen: (() -> Unit)? = null,
    footer: @Composable () -> Unit = {},
) {
    Column(Modifier.fillMaxWidth().card().padding(horizontal = 14.dp, vertical = 12.dp)) {
        // The post: tapping it opens the discussion. The footer sits outside, so
        // taps inside it don't reopen the post.
        Column(
            if (onOpen != null) Modifier.fillMaxWidth().clickable(onClickLabel = "Open the discussion", onClick = onOpen)
            else Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (review != null) {
                    RatingTag(review.rating)
                    Text("Lived here", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Brand.ink)
                    Text(
                        "${monthYear(review.tenancy_start_date)} – ${monthYear(review.tenancy_end_date)}",
                        fontSize = 13.sp, color = Brand.muted, modifier = Modifier.weight(1f),
                    )
                }
                if (interaction != null) {
                    Box(
                        Modifier.size(28.dp).clip(RoundedCornerShape(8.dp)).background(Color(0xFFEFF6FF)),
                        contentAlignment = Alignment.Center,
                    ) { Icon(Icons.Outlined.Visibility, contentDescription = null, tint = Brand.ink, modifier = Modifier.size(16.dp)) }
                    Text("Viewed or enquired", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Brand.ink)
                    Text(shortDate(interaction.interaction_date), fontSize = 13.sp, color = Brand.muted, modifier = Modifier.weight(1f))
                }
            }
            if (own?.can_edit == true) Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "Your review · editable until ${shortDate(own.editing_deadline)}",
                    color = Brand.fair, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f),
                )
                Box(
                    Modifier.heightIn(min = 40.dp).clip(RoundedCornerShape(20.dp)).background(Brand.ink)
                        .clickable(onClickLabel = "Edit your review", role = Role.Button) { onEdit(own) }
                        .padding(horizontal = 16.dp),
                    contentAlignment = Alignment.Center,
                ) { Text("Edit", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 13.sp) }
            }
            Text(
                review?.feedback ?: interaction?.description.orEmpty(),
                color = Brand.ink, fontSize = 15.sp, lineHeight = 22.sp,
            )
        }
        footer()
    }
}

/** A small pill label, e.g. a request's status. */
@Composable
fun Badge(text: String, color: Color = Brand.muted, textColor: Color = Color.White) {
    Text(
        text,
        color = textColor, fontSize = 12.sp, fontWeight = FontWeight.Bold,
        modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(color).padding(horizontal = 10.dp, vertical = 4.dp),
    )
}

/** A form field's visible label above its control. */
@Composable
fun Labelled(label: String, modifier: Modifier = Modifier, error: String? = null, helper: String? = null, content: @Composable () -> Unit) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Brand.ink)
        content()
        helper?.let { Text(it, fontSize = 13.sp, color = Brand.muted) }
        error?.let { Text(it, fontSize = 13.sp, color = Brand.poor, fontWeight = FontWeight.SemiBold) }
    }
}

/** An inline error above a form's action. */
@Composable
fun ErrorBox(text: String) {
    Text(
        text, color = Brand.poor, fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color(0xFFFEF2F2))
            .border(1.dp, Color(0xFFFECACA), RoundedCornerShape(12.dp)).padding(12.dp)
            .semantics { contentDescription = "Error: $text" },
    )
}

@Composable
fun Gap(height: Dp) = Spacer(Modifier.height(height))

private val shortDateFormat = DateTimeFormatter.ofPattern("d MMM yyyy")
private val monthYearFormat = DateTimeFormatter.ofPattern("MMM yyyy")

private fun parseDate(value: String) =
    if (value.length == 10) LocalDate.parse(value) else OffsetDateTime.parse(value).toLocalDate()

/** "2024-01-01" or a timestamp → "1 Jan 2024". */
fun shortDate(value: String): String = runCatching { parseDate(value).format(shortDateFormat) }.getOrDefault(value)

/** "2024-01-01" → "Jan 2024". */
fun monthYear(value: String): String = runCatching { parseDate(value).format(monthYearFormat) }.getOrDefault(value)
