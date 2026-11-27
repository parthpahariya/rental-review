package com.boringman.rentalreview.ui

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat
import androidx.compose.foundation.BorderStroke
import androidx.compose.material3.ButtonDefaults
import com.boringman.rentalreview.BuildConfig
import com.boringman.rentalreview.data.Location

/** Light status-bar icons while a dark header is on screen. */
@Composable
fun LightStatusBarIcons() {
    val activity = LocalActivity.current ?: return
    val view = LocalView.current
    DisposableEffect(Unit) {
        val controller = WindowCompat.getInsetsController(activity.window, view)
        val before = controller.isAppearanceLightStatusBars
        controller.isAppearanceLightStatusBars = false
        onDispose { controller.isAppearanceLightStatusBars = before }
    }
}

/**
 * A3 · Place details: no map here (a dark band instead), with directions handed
 * to the phone's own maps app. The chosen flat's Tenant reviews and Interactions,
 * sharing and editing for signed-in visitors.
 */
@Composable
fun PlaceScreen(vm: AppViewModel) {
    val place = vm.selected ?: return
    val context = LocalContext.current

    vm.post?.let { (onReview, id) ->
        PostPage(vm, onReview, id)
        return
    }
    if (vm.form == null && vm.editDraft == null) LightStatusBarIcons()
    val statusTop = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
    val bandHeight = statusTop + 130.dp

    Box(Modifier.fillMaxSize().background(Brand.goldWash)) {
        Box(Modifier.fillMaxWidth().height(bandHeight).background(Brand.ink)) {
            BuildingsArt(Modifier.fillMaxSize(), sun = false)
        }
        Column(Modifier.fillMaxSize()) {
            LazyColumn(
                Modifier.weight(1f).fillMaxWidth().padding(top = bandHeight - 20.dp)
                    .clip(RoundedCornerShape(topStart = 26.dp, topEnd = 26.dp)).background(Brand.goldWash),
                contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                item { PlaceHeader(place) { directions(context, place) { vm.message = it } } }
                item { PlaceTiles(place) }
                item { FlatPicker(vm) }
                if (vm.canEditPlace || vm.canEditFlat) item {
                    LinkButton("Edit what you added", vm::startEditPlace) {
                        Icon(Icons.Outlined.Edit, contentDescription = null, tint = Brand.fair, modifier = Modifier.size(16.dp).padding(end = 2.dp))
                    }
                }
                item {
                    val f = vm.flat
                    Segmented(
                        listOf(
                            "Tenant reviews · ${f?.summary?.tenant_review_count ?: 0}",
                            "Interactions · ${f?.summary?.interaction_review_count ?: 0}",
                        ),
                        vm.feedbackTab.ordinal,
                        { vm.feedbackTab = FeedbackTab.entries[it] },
                    )
                }
                if (vm.detailLoading) item {
                    Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = Brand.gold)
                    }
                } else if (vm.flats.isEmpty()) item {
                    Empty("No flats listed yet", "Add your flat to share the first review.")
                } else if (vm.feedbackTab == FeedbackTab.TENANT) {
                    if (vm.reviews.isEmpty()) item { Empty("No tenant reviews yet", "Be the first to share your experience with this flat.") }
                    items(vm.reviews, key = { it.id }) { r ->
                        FeedbackCard(
                            review = r, own = vm.ownReviews[r.id],
                            onEdit = { vm.form = Form(FeedbackTab.TENANT, it) },
                            onOpen = { vm.post = true to r.id },
                        ) { DiscussionLink(r.comment_count) { vm.post = true to r.id } }
                    }
                } else {
                    if (vm.interactions.isEmpty()) item { Empty("No interactions yet", "Viewed or enquired about this flat? Share what you saw.") }
                    items(vm.interactions, key = { it.id }) { i ->
                        FeedbackCard(interaction = i, onOpen = { vm.post = false to i.id }) {
                            DiscussionLink(i.comment_count) { vm.post = false to i.id }
                        }
                    }
                }
            }
            // The sticky actions.
            Column(Modifier.fillMaxWidth().background(Brand.surface)) {
                HorizontalDivider(color = Brand.line)
                Row(
                    Modifier.navigationBarsPadding().padding(horizontal = 20.dp, vertical = 14.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    PrimaryButton(
                        "Share a review", { vm.share(FeedbackTab.TENANT) }, Modifier.weight(1f),
                        enabled = vm.flat != null, height = 52.dp,
                    )
                    OutlinedButton(
                        onClick = { vm.share(FeedbackTab.INTERACTION) },
                        enabled = vm.flat != null,
                        modifier = Modifier.height(52.dp),
                        shape = RoundedCornerShape(16.dp),
                        border = BorderStroke(1.5.dp, if (vm.flat != null) Brand.ink else Brand.line),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = Brand.ink),
                    ) { Text("Interaction", fontSize = 15.sp, fontWeight = FontWeight.Bold) }
                }
            }
        }
        Row(
            Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            RoundIconButton(Icons.AutoMirrored.Filled.ArrowBack, "Back", vm::closePlace)
            RoundIconButton(Icons.Outlined.Share, "Share this place", { share(context, vm, place) })
        }
    }

    if (vm.addingFlat) TextPrompt(
        title = "Add your flat",
        label = "Flat (e.g. A-204)",
        action = "Add and review",
        maxLength = 100,
        note = "Add it only if it isn’t listed above. Then you’ll go straight to the review form.",
        onSubmit = { vm.addFlat(it) },
        onDone = { vm.addingFlat = false },
    )
}

@Composable
private fun PlaceHeader(place: Location, onDirections: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            place.title, fontSize = 26.sp, lineHeight = 30.sp, fontWeight = FontWeight.ExtraBold, color = Brand.ink,
            modifier = Modifier.semantics { heading() },
        )
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(place.address, fontSize = 14.sp, color = Brand.muted, modifier = Modifier.weight(1f))
            Row(
                Modifier.minimumInteractiveComponentSize().heightIn(min = 40.dp).clip(RoundedCornerShape(20.dp))
                    .background(Brand.surface).border(1.dp, Brand.line, RoundedCornerShape(20.dp))
                    .clickable(onClickLabel = "Directions in your maps app", role = Role.Button, onClick = onDirections)
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(Icons.Outlined.Place, contentDescription = null, tint = Brand.fair, modifier = Modifier.size(16.dp))
                Text("Directions", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Brand.ink)
            }
        }
    }
}

@Composable
private fun PlaceTiles(place: Location) {
    val s = place.summary
    val rating = s?.average_rating
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Column(
            Modifier.weight(1f).clip(RoundedCornerShape(14.dp))
                .background(if (rating != null) ratingColor(rating) else Brand.surface)
                .then(if (rating == null) Modifier.border(1.dp, Brand.line, RoundedCornerShape(14.dp)) else Modifier)
                .padding(horizontal = 12.dp, vertical = 10.dp)
                .semantics(mergeDescendants = true) {
                    contentDescription = rating?.let { "Rating %.1f out of 5".format(it) } ?: "Not rated yet"
                },
        ) {
            Text(
                rating?.let { "%.1f".format(it) } ?: "New", fontSize = 22.sp, fontWeight = FontWeight.ExtraBold,
                color = if (rating != null) Color.White else Brand.ink,
            )
            Text("Rating", fontSize = 12.sp, fontWeight = FontWeight.Medium, color = if (rating != null) Color.White else Brand.muted)
        }
        CountTile("${s?.tenant_review_count ?: 0}", "Reviews", Modifier.weight(1f))
        CountTile("${s?.interaction_review_count ?: 0}", "Interactions", Modifier.weight(1f))
    }
}

@Composable
private fun CountTile(value: String, label: String, modifier: Modifier) {
    Column(
        modifier.card(14.dp).padding(horizontal = 12.dp, vertical = 10.dp)
            .semantics(mergeDescendants = true) {},
    ) {
        Text(value, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, color = Brand.ink)
        Text(label, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = Brand.muted)
    }
}

/** The flats at the place; reviews belong to one flat, never mixed. */
@Composable
private fun FlatPicker(vm: AppViewModel) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("FLAT", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Brand.muted)
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            vm.flats.forEach { f ->
                val on = f.id == vm.flat?.id
                Box(
                    Modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(12.dp))
                        .background(if (on) Brand.ink else Brand.surface)
                        .border(if (on) 2.dp else 1.dp, if (on) Brand.ink else Brand.line, RoundedCornerShape(12.dp))
                        .clickable(role = Role.Tab) { vm.chooseFlat(f) }
                        .semantics {
                            contentDescription = "Flat ${f.label}"
                            selected = on
                        }
                        .padding(horizontal = 14.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        f.label, fontSize = 14.sp, fontWeight = if (on) FontWeight.Bold else FontWeight.SemiBold,
                        color = if (on) Color.White else Brand.ink,
                    )
                }
            }
            Box(
                Modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(12.dp)).dashedBorder(Brand.fair, 12.dp)
                    .clickable(role = Role.Button, onClick = vm::askAddFlat).padding(horizontal = 12.dp),
                contentAlignment = Alignment.Center,
            ) { Text("+ Add flat", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Brand.fair) }
        }
    }
}

@Composable
private fun Empty(title: String, body: String) {
    Column(Modifier.fillMaxWidth().padding(vertical = 20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, fontWeight = FontWeight.Bold, color = Brand.ink)
        Text(body, color = Brand.muted, fontSize = 14.sp)
    }
}

/** Hands the building to the phone's maps app: no map provider calls of ours. */
private fun directions(context: android.content.Context, place: Location, onError: (String) -> Unit) {
    val lat = place.latitude
    val lng = place.longitude
    val uri = Uri.parse("geo:$lat,$lng?q=$lat,$lng(${Uri.encode(place.title)})")
    try {
        context.startActivity(Intent(Intent.ACTION_VIEW, uri))
    } catch (_: ActivityNotFoundException) {
        onError("No maps app is installed to show directions.")
    }
}

/** Shares a link that opens the same place and flat on the web app. */
private fun share(context: android.content.Context, vm: AppViewModel, place: Location) {
    val link = "${BuildConfig.SITE_URL}/?at=${place.latitude},${place.longitude},17&place=${place.id}" +
        (vm.flat?.let { "&flat=${it.id}" } ?: "")
    val text = "${place.title}, ${place.address}: tenant reviews on Rental Review\n$link"
    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
    context.startActivity(Intent.createChooser(send, "Share this place"))
}

/**
 * One review or interaction on its own page, with its discussion: opened from
 * the flat's list.
 */
@Composable
private fun PostPage(vm: AppViewModel, onReview: Boolean, id: String) {
    val place = vm.selected ?: return
    // Read from the flat's lists, so edits and comment counts stay current.
    val review = if (onReview) vm.reviews.find { it.id == id } else null
    val interaction = if (!onReview) vm.interactions.find { it.id == id } else null
    if (review == null && interaction == null) {
        // Gone (e.g. deleted, or another flat chosen): back to the building.
        LaunchedEffect(id) { vm.post = null }
        return
    }
    LazyColumn(
        Modifier.fillMaxSize().background(Brand.goldWash).statusBarsPadding(),
        contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                RoundIconButton(Icons.AutoMirrored.Filled.ArrowBack, "Back to ${place.title}", { vm.post = null })
                Column(Modifier.weight(1f)) {
                    Text(
                        (if (onReview) "TENANT REVIEW" else "INTERACTION") + (vm.flat?.let { " · FLAT ${it.label.uppercase()}" } ?: ""),
                        color = Brand.fair, fontWeight = FontWeight.Bold, fontSize = 12.sp,
                    )
                    Text(
                        place.title, fontWeight = FontWeight.ExtraBold, fontSize = 20.sp, color = Brand.ink,
                        modifier = Modifier.semantics { heading() },
                    )
                }
            }
        }
        item {
            FeedbackCard(
                review = review, interaction = interaction, own = review?.let { vm.ownReviews[it.id] },
                onEdit = { vm.form = Form(FeedbackTab.TENANT, it) },
            )
        }
        item {
            Discussion(
                vm, onReview = onReview, subjectId = id,
                initialCount = review?.comment_count ?: interaction?.comment_count ?: 0,
                onSignIn = { vm.requireSignIn(Pending.NONE) }, onChange = vm::refreshFlatLists,
            )
        }
    }
}
