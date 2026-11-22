package com.boringman.rentalreview.ui

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.boringman.rentalreview.BuildConfig
import com.boringman.rentalreview.search.Area
import com.boringman.rentalreview.search.Point
import com.boringman.rentalreview.search.Region
import kotlinx.coroutines.launch

private fun openWeb(context: Context, path: String) {
    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.SITE_URL + path)))
}

@Composable
private fun TopBar(vm: AppViewModel, activity: Activity, back: (() -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth().background(Brand.surface).statusBarsPadding()
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (back != null) IconButton(onClick = back) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
        }
        BrandMark(onClick = vm::goHome)
        Spacer(Modifier.weight(1f))
        AccountButton(vm.account, vm.signingIn, onSignIn = { vm.signIn(activity) }, onOpen = vm::openNotebook)
    }
}

/** "Use my location": the phone's last known position, after asking permission. */
@Composable
private fun rememberLocate(vm: AppViewModel): () -> Unit {
    val context = LocalContext.current
    @SuppressLint("MissingPermission")
    fun locate() {
        val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val last = manager.getProviders(true).mapNotNull { manager.getLastKnownLocation(it) }
            .maxByOrNull { it.time }
        if (last == null) {
            vm.message = "We couldn’t get your location. Search for a locality instead."
        } else {
            vm.openArea(Area("Near you", center = Point(last.latitude, last.longitude), zoom = 15.0))
        }
    }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted.values.any { it }) locate()
        else vm.message = "Location permission was not given. Search for a locality instead."
    }
    return {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        if (granted) locate()
        else launcher.launch(arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION))
    }
}

@Composable
fun HomeScreen(vm: AppViewModel, activity: Activity) {
    val context = LocalContext.current
    val locate = rememberLocate(vm)
    Column(Modifier.fillMaxSize().background(Brand.goldWash)) {
        TopBar(vm, activity)
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("Building by building", color = Brand.fair, fontWeight = FontWeight.SemiBold)
            Text("Rent with your eyes open.", fontSize = 34.sp, fontWeight = FontWeight.ExtraBold, lineHeight = 38.sp)
            Text(
                "Buildings across India, rated by the people who lived there. See what past tenants say " +
                    "about deposits, repairs and rent hikes before you sign anything.",
                color = Brand.muted, fontSize = 16.sp,
            )
            SearchBox(vm, near = Region.defaultCenter)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = locate) { Text("Use my location") }
                Button(onClick = vm::browseAll) { Text("Browse the map") }
            }
            Spacer(Modifier.height(12.dp))
            Explainer("Tenant reviews", "From people who rented the flat: a rating, what living there was like, and their tenancy dates.")
            Explainer("Interactions", "From people who only viewed or enquired: useful red flags before you ever move in.")
            Spacer(Modifier.height(12.dp))
            HorizontalDivider()
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                TextButton(onClick = { openWeb(context, "/privacy") }) { Text("Privacy Policy") }
                TextButton(onClick = { openWeb(context, "/delete-data") }) { Text("Delete your data") }
            }
        }
    }
}

@Composable
private fun Explainer(title: String, body: String) {
    Column(
        Modifier.fillMaxWidth().background(Brand.surface, RoundedCornerShape(16.dp)).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(title, fontWeight = FontWeight.Bold, fontSize = 18.sp)
        Text(body, color = Brand.muted)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ExploreScreen(vm: AppViewModel, activity: Activity) {
    var listOpen by remember { mutableStateOf(false) }
    var addMode by remember { mutableStateOf(false) }
    var addingAt by remember { mutableStateOf<Point?>(null) }
    var center by remember { mutableStateOf(Region.defaultCenter) }

    Column(Modifier.fillMaxSize()) {
        TopBar(vm, activity, back = vm::goHome)
        Box(Modifier.fillMaxSize()) {
            val provider = vm.provider
            if (provider != null) MapPane(vm, provider, addMode) { center = it }
            SearchBox(vm, near = center, modifier = Modifier.padding(12.dp).fillMaxWidth())

            if (addMode) {
                Column(
                    Modifier.align(Alignment.BottomCenter).padding(16.dp).fillMaxWidth()
                        .background(Brand.surface, RoundedCornerShape(16.dp)).padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text("Move the map so the + is on the building.", fontWeight = FontWeight.SemiBold)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { addingAt = center }) { Text("Add a place here") }
                        TextButton(onClick = { addMode = false }) { Text("Cancel") }
                    }
                }
            } else {
                Row(
                    Modifier.align(Alignment.BottomCenter).padding(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    ExtendedFloatingActionButton(
                        onClick = { listOpen = true },
                        icon = { Icon(Icons.AutoMirrored.Filled.List, contentDescription = null) },
                        text = {
                            Text("Show list · ${vm.locations.size} ${if (vm.locations.size == 1) "place" else "places"}" +
                                if (vm.partial) "+" else "")
                        },
                        containerColor = Brand.surface,
                    )
                    ExtendedFloatingActionButton(
                        onClick = { if (vm.account == null) vm.signIn(activity) else addMode = true },
                        icon = { Icon(Icons.Filled.Add, contentDescription = null) },
                        text = { Text("Add") },
                        containerColor = Brand.gold,
                    )
                }
            }
        }
    }

    if (listOpen) {
        ModalBottomSheet(onDismissRequest = { listOpen = false }, sheetState = rememberModalBottomSheetState()) {
            val places = vm.nearestFirst()
            Text(
                if (vm.loadingPlaces) "Loading places…" else "Nearest to map centre",
                fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 16.dp),
            )
            if (places.isEmpty() && !vm.loadingPlaces) Text(
                "No places in this area. Move the map, or add a place here.",
                color = Brand.muted, modifier = Modifier.padding(16.dp),
            )
            LazyColumn(Modifier.padding(horizontal = 8.dp)) {
                items(places, key = { it.id }) { l ->
                    PlaceRow(l) { listOpen = false; vm.select(l) }
                }
            }
        }
    }
    if (vm.selected != null) {
        ModalBottomSheet(onDismissRequest = vm::closePlace, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
            PlaceDetails(vm, onSignIn = { vm.signIn(activity) })
        }
    }
    addingAt?.let { at ->
        AddPlaceForm(vm, at) { added ->
            addingAt = null
            if (added) addMode = false
        }
    }
}

@Composable
fun NotebookScreen(vm: AppViewModel, activity: Activity) {
    val account = vm.account ?: run { vm.screen = Screen.HOME; return }
    val scope = rememberCoroutineScope()
    var name by remember(account.id) { mutableStateOf(account.name ?: "") }
    var deactivating by remember { mutableStateOf(false) }
    var requesting by remember { mutableStateOf<com.boringman.rentalreview.data.Review?>(null) }
    var editing by remember { mutableStateOf<com.boringman.rentalreview.data.Review?>(null) }
    val book = vm.notebook

    Column(Modifier.fillMaxSize().background(Brand.goldWash)) {
        TopBar(vm, activity, back = vm::goHome)
        LazyColumn(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item { Text("Your rental notebook", fontSize = 26.sp, fontWeight = FontWeight.ExtraBold) }
            item {
                OutlinedTextField(
                    name, { if (it.length <= 200) name = it },
                    label = { Text("Your name") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                    supportingText = { Text("Only you see this. It never appears with your reviews.") },
                )
                Row {
                    TextButton(onClick = { scope.launch { vm.setName(name.trim().ifEmpty { null }) } }) { Text("Save name") }
                    if (account.name_is_custom) TextButton(onClick = {
                        scope.launch { if (vm.setName(null)) name = vm.account?.name ?: "" }
                    }) { Text("Use my Google name") }
                }
            }
            if (vm.notebookLoading) item { Text("Loading…", color = Brand.muted) }

            item { Section("Places you added") }
            if (book.flats.isEmpty()) item { Muted("You haven’t added a place yet.") }
            items(book.flats, key = { "flat-" + it.id }) { f ->
                Record(
                    title = "${f.location.title} · Flat ${f.label}",
                    subtitle = if (f.added_place) "You added this building" else "You added a flat here",
                ) { TextButton(onClick = { vm.openOwn(f.location.id, f.id, FeedbackTab.TENANT) }) { Text("Open") } }
            }

            item { Section("Your tenant reviews") }
            if (book.reviews.isEmpty()) item { Muted("No tenant reviews yet.") }
            items(book.reviews, key = { "review-" + it.id }) { r ->
                Record(
                    title = r.place?.let { "${it.building_name ?: "Rental property"} · Flat ${it.flat_label}" } ?: "Tenant review",
                    subtitle = "★".repeat(r.rating) + " · " + if (r.deleted_at != null) "Deleted after admin approval"
                    else "Editing closes ${shortDate(r.editing_deadline)}",
                    body = r.feedback,
                ) {
                    r.location_id?.let { TextButton(onClick = { vm.openOwn(it, r.flat_id, FeedbackTab.TENANT) }) { Text("Open") } }
                    if (r.can_edit) TextButton(onClick = { editing = r }) { Text("Edit") }
                    if (r.can_request_deletion) TextButton(onClick = { requesting = r }) { Text("Request deletion") }
                }
            }

            item { Section("Your interactions") }
            if (book.interactions.isEmpty()) item { Muted("No interactions shared yet.") }
            items(book.interactions, key = { "interaction-" + it.id }) { i ->
                Record(
                    title = i.place?.let { "${it.building_name ?: "Rental property"} · Flat ${it.flat_label}" } ?: "Interaction",
                    subtitle = "On ${shortDate(i.interaction_date)}",
                    body = i.description,
                ) {
                    i.location_id?.let { TextButton(onClick = { vm.openOwn(it, i.flat_id, FeedbackTab.INTERACTION) }) { Text("Open") } }
                }
            }

            if (book.requests.isNotEmpty()) {
                item { Section("Deletion requests") }
                items(book.requests, key = { "request-" + it.id }) { d ->
                    Record(title = d.reason, subtitle = d.decision_note?.let { "Admin: $it" }) {
                        Badge(d.status, if (d.status == "approved") Brand.good else if (d.status == "rejected") Brand.poor else Brand.muted)
                    }
                }
            }

            if (account.isAdmin) {
                item { Section("Admin · Pending deletion requests") }
                if (book.adminRequests.isEmpty()) item { Muted("You’re all caught up.") }
                items(book.adminRequests, key = { "admin-" + it.id }) { d ->
                    Record(
                        title = d.review?.let { "★".repeat(it.rating) } ?: "Tenant review",
                        subtitle = "Reason: ${d.reason}",
                        body = d.review?.feedback,
                    ) {
                        Button(onClick = { vm.decide(d, true) }) { Text("Approve") }
                        OutlinedButton(onClick = { vm.decide(d, false) }) { Text("Reject") }
                    }
                }
            }

            item {
                HorizontalDivider(Modifier.padding(vertical = 8.dp))
                OutlinedButton(onClick = { vm.signOut(activity) }, modifier = Modifier.fillMaxWidth()) { Text("Sign out") }
            }
            item {
                if (!deactivating) TextButton(onClick = { deactivating = true }) {
                    Text("Deactivate account", color = Brand.poor)
                } else Column(
                    Modifier.background(Brand.surface, RoundedCornerShape(12.dp)).padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text("Deactivating ends all your sessions. Your tenant reviews and interactions remain visible.")
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = { vm.deactivate(activity) },
                            colors = ButtonDefaults.buttonColors(containerColor = Brand.poor),
                        ) { Text("Confirm deactivation") }
                        TextButton(onClick = { deactivating = false }) { Text("Cancel") }
                    }
                }
                Spacer(Modifier.height(32.dp))
            }
        }
    }

    requesting?.let { r ->
        TextPrompt(
            title = "Request deletion",
            label = "Why should this review be deleted?",
            action = "Send request",
            maxLength = 10_000,
            onSubmit = { vm.requestDeletion(r, it) },
            onDone = { requesting = null },
        )
    }
    editing?.let { r -> FeedbackForm(vm, FeedbackTab.TENANT, r) { editing = null } }
    LaunchedEffect(account.id) { if (book == Notebook()) vm.loadNotebook() }
}

@Composable
private fun Section(title: String) =
    Text(title, fontWeight = FontWeight.Bold, fontSize = 18.sp, modifier = Modifier.padding(top = 8.dp))

@Composable
private fun Muted(text: String) = Text(text, color = Brand.muted)

@Composable
private fun Record(title: String, subtitle: String?, body: String? = null, actions: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxWidth().background(Brand.surface, RoundedCornerShape(14.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(title, fontWeight = FontWeight.Bold)
        subtitle?.let { Text(it, color = Brand.muted, fontSize = 13.sp) }
        body?.let { Text(it) }
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) { actions() }
    }
}

/** Shown when a deactivated account signs in again. */
@Composable
fun ReactivationDialog(vm: AppViewModel) {
    androidx.compose.material3.AlertDialog(
        onDismissRequest = { vm.confirmReactivation(false) },
        title = { Text("Reactivate your account?") },
        text = { Text("This account was deactivated. Reactivate it to sign in; your reviews are unchanged.") },
        confirmButton = { Button(onClick = { vm.confirmReactivation(true) }) { Text("Reactivate") } },
        dismissButton = { TextButton(onClick = { vm.confirmReactivation(false) }) { Text("Cancel") } },
    )
}
