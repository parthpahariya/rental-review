package com.boringman.rentalreview.ui

import android.app.Activity
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.boringman.rentalreview.data.Place
import com.boringman.rentalreview.data.Review
import kotlinx.coroutines.launch

private fun Place?.label(fallback: String) = this?.let { "${it.building_name ?: "Rental property"} · Flat ${it.flat_label}" } ?: fallback

/** A7 · The rental notebook: the visitor's own records, private to them. */
@Composable
fun NotebookScreen(vm: AppViewModel, activity: Activity) {
    val account = vm.account
    if (account == null) {
        SignedOutNotebook(vm)
        return
    }
    val scope = rememberCoroutineScope()
    var section by rememberSaveable { mutableIntStateOf(0) }
    var editingName by remember { mutableStateOf(false) }
    var deactivating by remember { mutableStateOf(false) }
    var requesting by remember { mutableStateOf<Review?>(null) }
    val book = vm.notebook
    val pendingIds = book.requests.filter { it.status == "pending" }.map { it.tenant_review_id }.toSet()

    LazyColumn(
        Modifier.fillMaxSize().background(Brand.goldWash).statusBarsPadding(),
        contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Avatar(account, 60.dp, 24)
                Column(Modifier.weight(1f)) {
                    Text(
                        "Your notebook", fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, color = Brand.ink,
                        modifier = Modifier.semantics { heading() },
                    )
                    Text("Private — never shown on reviews", fontSize = 14.sp, color = Brand.muted)
                    listOfNotNull(account.name, account.email).joinToString(" · ").takeIf { it.isNotEmpty() }?.let {
                        Text(it, fontSize = 13.sp, color = Brand.muted, maxLines = 1)
                    }
                }
                QuietButton(if (account.name.isNullOrBlank()) "Add name" else "Edit name", { editingName = true })
            }
            if (account.name_is_custom) LinkButton("Use my Google name", { scope.launch { vm.setName(null) } })
        }
        item {
            Segmented(
                listOf("Reviews · ${book.reviews.size}", "Interactions · ${book.interactions.size}", "Places · ${book.flats.size}"),
                section, { section = it },
            )
        }
        if (vm.notebookLoading && book == Notebook()) item { Text("Loading…", color = Brand.muted) }

        when (section) {
            0 -> {
                if (book.reviews.isEmpty() && !vm.notebookLoading) item { Muted("No tenant reviews yet. Open a place and share what living there was like.") }
                items(book.reviews, key = { "review-" + it.id }) { r -> OwnReviewCard(vm, r, r.id in pendingIds) { requesting = r } }
                if (book.requests.isNotEmpty()) {
                    item { Section("Deletion requests") }
                    items(book.requests, key = { "request-" + it.id }) { d ->
                        Record(title = d.reason, subtitle = d.decision_note?.let { "Admin: $it" }) {
                            when (d.status) {
                                "approved" -> Badge("Approved", Brand.good)
                                "rejected" -> Badge("Rejected", Brand.poor)
                                else -> Badge("Deletion pending", Brand.pendingWash, Brand.pendingInk)
                            }
                        }
                    }
                }
            }
            1 -> {
                if (book.interactions.isEmpty() && !vm.notebookLoading) item { Muted("No interactions shared yet.") }
                items(book.interactions, key = { "interaction-" + it.id }) { i ->
                    OwnCard(
                        lead = {
                            Box(
                                Modifier.size(30.dp).clip(RoundedCornerShape(9.dp)).background(Color(0xFFEFF6FF)),
                                contentAlignment = Alignment.Center,
                            ) { Icon(Icons.Outlined.Visibility, contentDescription = null, tint = Brand.ink, modifier = Modifier.size(16.dp)) }
                        },
                        title = i.place.label("Interaction"),
                        subtitle = "On ${shortDate(i.interaction_date)}",
                        onOpen = i.location_id?.let { { vm.openOwn(it, i.flat_id, FeedbackTab.INTERACTION) } },
                    ) { Text(i.description, fontSize = 14.sp, color = Brand.ink, maxLines = 4) }
                }
            }
            else -> {
                if (book.flats.isEmpty() && !vm.notebookLoading) item { Muted("You haven’t added a place yet.") }
                items(book.flats, key = { "flat-" + it.id }) { f ->
                    OwnCard(
                        lead = { ScoreBadge(f.location.summary?.average_rating, 30.dp) },
                        title = "${f.location.title} · Flat ${f.label}",
                        subtitle = if (f.added_place) "You added this building" else "You added a flat here",
                        onOpen = { vm.openOwn(f.location.id, f.id, FeedbackTab.TENANT) },
                    ) {
                        if (f.can_edit) Text("You can still edit what you added.", fontSize = 13.sp, color = Brand.fair, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }

        comments(vm)
        if (account.isAdmin) admin(vm)

        item {
            Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                LinkButton("Sign out", { vm.signOut(activity) }, color = Brand.ink)
                LinkButton("Deactivate account", { deactivating = true }, color = Brand.poor)
            }
        }
    }

    if (editingName) TextPrompt(
        title = "Your name",
        label = "Name",
        action = "Save name",
        maxLength = 200,
        initial = account.name ?: "",
        note = "Only you see this. It never appears with your reviews.",
        onSubmit = { vm.setName(it.trim().ifEmpty { null }) },
        onDone = { editingName = false },
    )
    if (deactivating) AlertDialog(
        onDismissRequest = { deactivating = false },
        containerColor = Brand.goldWash,
        title = { Text("Deactivate your account?", fontWeight = FontWeight.ExtraBold) },
        text = { Text("Deactivating ends all your sessions. Your tenant reviews and interactions remain visible.") },
        confirmButton = {
            QuietButton("Confirm deactivation", { deactivating = false; vm.deactivate(activity) }, color = Brand.poor, border = Brand.poor)
        },
        dismissButton = { LinkButton("Cancel", { deactivating = false }, color = Brand.ink) },
    )
    requesting?.let { r ->
        TextPrompt(
            title = "Request deletion",
            label = "Why should this review be deleted?",
            action = "Send request",
            maxLength = 10_000,
            note = "The review stays public until an admin approves your request.",
            onSubmit = { vm.requestDeletion(r, it) },
            onDone = { requesting = null },
        )
    }
    LaunchedEffect(account.id) { if (book == Notebook()) vm.loadNotebook() }
}

@Composable
private fun SignedOutNotebook(vm: AppViewModel) {
    Column(
        Modifier.fillMaxSize().background(Brand.goldWash).statusBarsPadding().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(Icons.AutoMirrored.Outlined.MenuBook, contentDescription = null, tint = Brand.fair, modifier = Modifier.size(40.dp))
        Text("Your notebook", fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, color = Brand.ink, modifier = Modifier.semantics { heading() })
        Text(
            "Sign in to keep your reviews, interactions and places in one private spot.",
            fontSize = 15.sp, color = Brand.muted,
        )
        PrimaryButton("Sign in", { vm.requireSignIn(Pending.NOTEBOOK) }, Modifier.fillMaxWidth())
    }
}

@Composable
private fun OwnReviewCard(vm: AppViewModel, r: Review, pending: Boolean, onRequestDeletion: () -> Unit) {
    OwnCard(
        lead = { RatingTag(r.rating, decimals = false) },
        title = r.place.label("Tenant review"),
        subtitle = "${monthYear(r.tenancy_start_date)} – ${monthYear(r.tenancy_end_date)}",
        onOpen = r.location_id?.let { { vm.openOwn(it, r.flat_id, FeedbackTab.TENANT) } },
        trailing = if (pending && r.deleted_at == null) { { Badge("Deletion pending", Brand.pendingWash, Brand.pendingInk) } } else null,
    ) {
        when {
            r.deleted_at != null -> Text("Deleted after admin approval.", fontSize = 13.sp, color = Brand.muted)
            pending -> Text("Stays public until an admin approves your request.", fontSize = 13.sp, color = Brand.muted, lineHeight = 18.sp)
            r.can_edit -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(Icons.Outlined.CalendarMonth, contentDescription = null, tint = Brand.fair, modifier = Modifier.size(16.dp))
                Text("Editable until ${shortDate(r.editing_deadline)}", fontSize = 13.sp, color = Brand.fair, fontWeight = FontWeight.SemiBold)
            }
        }
        if (r.deleted_at == null && !pending && (r.can_edit || r.can_request_deletion)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (r.can_edit) InkButton("Edit review", { vm.form = Form(FeedbackTab.TENANT, r) }, Modifier.weight(1f))
                if (r.can_request_deletion) QuietButton("Request deletion", onRequestDeletion, Modifier.weight(1f))
            }
        }
    }
}

/** One of the visitor's records; tapping its heading opens the place. */
@Composable
private fun OwnCard(
    lead: @Composable () -> Unit,
    title: String,
    subtitle: String?,
    onOpen: (() -> Unit)?,
    trailing: (@Composable () -> Unit)? = null,
    body: @Composable () -> Unit,
) {
    Column(Modifier.fillMaxWidth().card().padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(
            (if (onOpen != null) Modifier.clickable(onClickLabel = "Open $title", onClick = onOpen) else Modifier)
                .fillMaxWidth().padding(vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            lead()
            Column(Modifier.weight(1f)) {
                Text(title, fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Brand.ink)
                subtitle?.let { Text(it, fontSize = 13.sp, color = Brand.muted) }
            }
            when {
                trailing != null -> trailing()
                onOpen != null -> Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = Brand.muted)
            }
        }
        body()
    }
}

private fun LazyListScope.comments(vm: AppViewModel) {
    val book = vm.notebook
    if (book.comments.isEmpty()) return
    item { Section("Your comments") }
    items(book.comments, key = { "comment-" + it.id }) { c ->
        Record(
            title = c.place.label("Comment"),
            subtitle = (if (c.onReview) "On a tenant review" else "On an interaction") +
                " · ${shortDate(c.submitted_at)}" + if (c.removed_at != null) " · Removed by an admin" else "",
            body = c.body,
        ) {
            if (c.removed_at == null) LinkButton("Delete comment", { vm.deleteOwnComment(c) }, color = Brand.poor)
        }
    }
}

private fun LazyListScope.admin(vm: AppViewModel) {
    val book = vm.notebook
    item { Section("Admin · Reported comments") }
    if (book.commentReports.isEmpty()) item { Muted("No reported comments.") }
    items(book.commentReports, key = { "report-" + it.id }) { r ->
        Record(
            title = "${r.place.building_name ?: "Rental property"} · Flat ${r.place.flat_label}",
            subtitle = (if (r.comment.onReview) "On a tenant review: " else "On an interaction: ") + r.subject.text,
            body = "“${r.comment.body}”\nReason: ${r.reason}",
        ) {
            InkButton("Remove", { vm.decideReport(r, true) })
            QuietButton("Keep", { vm.decideReport(r, false) })
        }
    }
    item { Section("Admin · Pending deletion requests") }
    if (book.adminRequests.isEmpty()) item { Muted("You’re all caught up.") }
    items(book.adminRequests, key = { "admin-" + it.id }) { d ->
        Record(
            title = d.review?.let { "Tenant review rated ${it.rating}" } ?: "Tenant review",
            subtitle = "Reason: ${d.reason}",
            body = d.review?.feedback,
        ) {
            InkButton("Approve", { vm.decide(d, true) })
            QuietButton("Reject", { vm.decide(d, false) })
        }
    }
}

@Composable
private fun Section(title: String) =
    Text(
        title, fontWeight = FontWeight.ExtraBold, fontSize = 16.sp, color = Brand.ink,
        modifier = Modifier.padding(top = 8.dp).semantics { heading() },
    )

@Composable
private fun Muted(text: String) = Text(text, color = Brand.muted, fontSize = 14.sp)

@Composable
private fun Record(title: String, subtitle: String?, body: String? = null, actions: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxWidth().card(16.dp).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(title, fontWeight = FontWeight.Bold, color = Brand.ink)
        subtitle?.let { Text(it, color = Brand.muted, fontSize = 13.sp) }
        body?.let { Text(it, color = Brand.ink, fontSize = 14.sp) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) { actions() }
    }
}
