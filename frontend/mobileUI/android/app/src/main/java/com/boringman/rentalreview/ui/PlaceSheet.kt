package com.boringman.rentalreview.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.boringman.rentalreview.data.Review

/**
 * A selected place: its flats, then the chosen flat's Tenant Reviews and
 * Interactions tabs, with sharing and editing for signed-in visitors.
 */
@Composable
fun PlaceDetails(vm: AppViewModel, onSignIn: () -> Unit) {
    val place = vm.selected ?: return
    var form by remember { mutableStateOf<FeedbackTab?>(null) }
    var editing by remember { mutableStateOf<Review?>(null) }
    var addingFlat by remember { mutableStateOf(false) }
    /** A review or interaction opened on its own page: (is it a review, its id). */
    var post by remember(place.id) { mutableStateOf<Pair<Boolean, String>?>(null) }

    post?.let { (onReview, id) ->
        // Back returns to the building, like leaving a place returns to the map.
        BackHandler { post = null }
        PostPage(vm, onReview, id, onBack = { post = null }, onEdit = { editing = it }, onSignIn = onSignIn)
        editing?.let { FeedbackForm(vm, FeedbackTab.TENANT, it) { editing = null } }
        return
    }

    LazyColumn(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(place.title, fontWeight = FontWeight.Bold, fontSize = 22.sp)
                    Text(place.address, color = Brand.muted)
                }
                TextButton(onClick = vm::closePlace) { Text("Close") }
            }
        }
        item {
            Text("Flats", fontWeight = FontWeight.SemiBold)
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(vm.flats, key = { it.id }) { f ->
                    FilterChip(
                        selected = f.id == vm.flat?.id,
                        onClick = { vm.chooseFlat(f) },
                        label = { Text("Flat ${f.label}") },
                    )
                }
                item {
                    TextButton(onClick = { if (vm.account == null) onSignIn() else addingFlat = true }) {
                        Text("+ Add flat")
                    }
                }
            }
        }
        item {
            TabRow(selectedTabIndex = vm.tab.ordinal) {
                val flat = vm.flat
                Tab(vm.tab == FeedbackTab.TENANT, onClick = { vm.tab = FeedbackTab.TENANT },
                    text = { Text("Tenant Reviews (${flat?.summary?.tenant_review_count ?: 0})") })
                Tab(vm.tab == FeedbackTab.INTERACTION, onClick = { vm.tab = FeedbackTab.INTERACTION },
                    text = { Text("Interactions (${flat?.summary?.interaction_review_count ?: 0})") })
            }
        }
        item {
            Button(
                onClick = { if (vm.account == null) onSignIn() else form = vm.tab },
                enabled = vm.flat != null,
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (vm.tab == FeedbackTab.TENANT) "Share a review" else "Share an interaction") }
        }
        if (vm.detailLoading) item {
            CircularProgressIndicator(Modifier.padding(16.dp))
        } else if (vm.tab == FeedbackTab.TENANT) {
            if (vm.reviews.isEmpty()) item { Empty("No tenant reviews yet") }
            items(vm.reviews, key = { it.id }) { r ->
                FeedbackCard(review = r, own = vm.ownReviews[r.id], onEdit = { editing = it }, onOpen = { post = true to r.id }) {
                    DiscussionLink(r.comment_count) { post = true to r.id }
                }
            }
        } else {
            if (vm.interactions.isEmpty()) item { Empty("No interactions yet") }
            items(vm.interactions, key = { it.id }) { i ->
                FeedbackCard(interaction = i, onOpen = { post = false to i.id }) {
                    DiscussionLink(i.comment_count) { post = false to i.id }
                }
            }
        }
        item { Spacer(Modifier.height(24.dp)) }
    }

    form?.let { FeedbackForm(vm, it, null) { form = null } }
    editing?.let { FeedbackForm(vm, FeedbackTab.TENANT, it) { editing = null } }
    if (addingFlat) TextPrompt(
        title = "Add a flat to ${place.title}",
        label = "Flat (e.g. A-204)",
        action = "Add flat",
        maxLength = 100,
        onSubmit = { vm.addFlat(it) },
        onDone = { addingFlat = false },
    )
}

@Composable
private fun Empty(title: String) {
    Column(Modifier.fillMaxWidth().padding(vertical = 20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, fontWeight = FontWeight.Bold)
        Text("Be the first to share your experience with this flat.", color = Brand.muted)
    }
}

/**
 * One review or interaction on its own page, with its discussion: opened from the
 * flat's list, the way a building opens from the map.
 */
@Composable
private fun PostPage(
    vm: AppViewModel,
    onReview: Boolean,
    id: String,
    onBack: () -> Unit,
    onEdit: (Review) -> Unit,
    onSignIn: () -> Unit,
) {
    val place = vm.selected ?: return
    // Read from the flat's lists, so edits and comment counts stay current.
    val review = if (onReview) vm.reviews.find { it.id == id } else null
    val interaction = if (!onReview) vm.interactions.find { it.id == id } else null
    if (review == null && interaction == null) {
        // Gone (e.g. deleted, or another flat chosen): back to the building.
        LaunchedEffect(id) { onBack() }
        return
    }
    LazyColumn(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            TextButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null)
                Text(" Back to ${place.title}")
            }
        }
        item {
            Text(
                (if (onReview) "Tenant review" else "Interaction") + (vm.flat?.let { " · Flat ${it.label}" } ?: ""),
                color = Brand.fair, fontWeight = FontWeight.Bold, fontSize = 13.sp,
            )
            Text(place.title, fontWeight = FontWeight.Bold, fontSize = 22.sp)
            Text(place.address, color = Brand.muted)
        }
        item { FeedbackCard(review = review, interaction = interaction, own = review?.let { vm.ownReviews[it.id] }, onEdit = onEdit) }
        item {
            Discussion(
                vm, onReview = onReview, subjectId = id,
                initialCount = review?.comment_count ?: interaction?.comment_count ?: 0,
                onSignIn = onSignIn, onChange = vm::refreshFlatLists,
            )
        }
        item { Spacer(Modifier.height(24.dp)) }
    }
}
