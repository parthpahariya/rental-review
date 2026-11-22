package com.boringman.rentalreview.ui

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
import androidx.compose.runtime.Composable
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
                FeedbackCard(review = r, own = vm.ownReviews[r.id], onEdit = { editing = it })
            }
        } else {
            if (vm.interactions.isEmpty()) item { Empty("No interactions yet") }
            items(vm.interactions, key = { it.id }) { FeedbackCard(interaction = it) }
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
