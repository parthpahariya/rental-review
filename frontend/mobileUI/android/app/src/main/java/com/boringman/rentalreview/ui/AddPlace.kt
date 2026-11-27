package com.boringman.rentalreview.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.boringman.rentalreview.search.Point
import com.boringman.rentalreview.search.distanceMeters
import com.boringman.rentalreview.search.formatDistance
import kotlinx.coroutines.launch

/** A single-line or multi-line text field in the forms' style. */
@Composable
fun Field(
    value: String,
    onChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    singleLine: Boolean = true,
    error: Boolean = false,
    capitalize: Boolean = true,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        modifier = modifier.fillMaxWidth().semantics { contentDescription = label },
        placeholder = placeholder?.let { { Text(it, color = Brand.muted) } },
        singleLine = singleLine,
        isError = error,
        shape = RoundedCornerShape(12.dp),
        keyboardOptions = KeyboardOptions(
            capitalization = if (capitalize) KeyboardCapitalization.Sentences else KeyboardCapitalization.None,
        ),
        colors = OutlinedTextFieldDefaults.colors(
            focusedContainerColor = Brand.surface, unfocusedContainerColor = Brand.surface, errorContainerColor = Brand.surface,
            focusedBorderColor = Brand.gold, unfocusedBorderColor = Brand.line, cursorColor = Brand.ink,
        ),
    )
}

/** The dark instruction banner over the map, beside a round ✕. */
@Composable
private fun MapBanner(text: String, closeDescription: String, onClose: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RoundIconButton(Icons.Filled.Close, closeDescription, onClick = onClose)
        Box(
            Modifier.weight(1f).heightIn(min = 48.dp).shadow(6.dp, RoundedCornerShape(24.dp))
                .clip(RoundedCornerShape(24.dp)).background(Brand.ink).padding(horizontal = 16.dp, vertical = 8.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(text, color = Brand.surface, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
        }
    }
}

/**
 * A6 · Add a place, on the same map as the results: drag the "+ New" pin (drawn
 * by MapLayer) onto the building, check what's already listed nearby, then add it.
 */
@Composable
fun AddPlaceScreen(vm: AppViewModel, mapHeight: Dp) {
    val scope = rememberCoroutineScope()
    var name by rememberSaveable { mutableStateOf("") }
    var address by rememberSaveable { mutableStateOf("") }
    var flatLabel by rememberSaveable { mutableStateOf("") }
    var tried by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val nearby = vm.nearby
    val nameNeeded = nearby.isNotEmpty()
    val nameError = if (tried && nameNeeded && name.isBlank()) "Name the building: places are listed nearby, so we need it to tell them apart." else null
    val addressError = if (tried && address.isBlank()) "Enter the building’s address." else null
    val flatError = if (tried && flatLabel.isBlank()) "Enter your flat number." else null

    Box(Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxSize().padding(top = mapHeight - 28.dp)
                .shadow(16.dp, RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
                .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(Brand.goldWash)
                .imePadding().verticalScroll(rememberScrollState()).navigationBarsPadding()
                .padding(start = 20.dp, end = 20.dp, top = 10.dp, bottom = 20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Grabber(Modifier.align(Alignment.CenterHorizontally))
            if (nearby.isNotEmpty()) {
                Column(
                    Modifier.fillMaxWidth().card(16.dp, Brand.gold).padding(horizontal = 14.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text("ALREADY ON THE MAP NEARBY", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Brand.fair)
                    val pin = vm.draftPin
                    nearby.take(3).forEach { l ->
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Column(Modifier.weight(1f)) {
                                Text(l.title, fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Brand.ink)
                                val s = l.summary
                                Text(
                                    listOfNotNull(
                                        pin?.let { formatDistance(distanceMeters(it, Point(l.latitude, l.longitude))) + " away" },
                                        s?.average_rating?.let { "%.1f".format(it) },
                                        s?.let { "${it.tenant_review_count} ${if (it.tenant_review_count == 1) "review" else "reviews"}" },
                                    ).joinToString(" · "),
                                    fontSize = 13.sp, color = Brand.muted,
                                )
                            }
                            InkButton("Review this", onClick = { vm.select(l) })
                        }
                    }
                }
            }
            Text(
                if (nearby.isNotEmpty()) "Not listed? Add it" else "Add the building",
                fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Brand.ink,
            )
            Labelled("Building name" + if (nameNeeded) "" else " (optional)", error = nameError) {
                Field(name, { if (it.length <= 200) name = it }, "Building name", placeholder = "e.g. Mango Lane Homes", error = nameError != null)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Labelled("Address", Modifier.weight(2f), error = addressError) {
                    Field(address, { if (it.length <= 500) address = it }, "Address", error = addressError != null)
                }
                Labelled("Your flat", Modifier.weight(1f), error = flatError) {
                    Field(flatLabel, { if (it.length <= 100) flatLabel = it }, "Your flat", placeholder = "302", error = flatError != null)
                }
            }
            error?.let { Box(Modifier.semantics { liveRegion = LiveRegionMode.Polite }) { ErrorBox(it) } }
            PrimaryButton(
                if (busy) "Adding…" else "Add place and write a review",
                enabled = !busy,
                modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                onClick = {
                    tried = true
                    if ((nameNeeded && name.isBlank()) || address.isBlank() || flatLabel.isBlank()) return@PrimaryButton
                    busy = true
                    error = null
                    scope.launch {
                        error = vm.addPlace(address.trim(), name.trim().ifEmpty { null }, flatLabel.trim())
                        busy = false
                        if (error == null) { name = ""; address = ""; flatLabel = ""; tried = false }
                    }
                },
            )
        }
        MapBanner("Drag the pin onto the building", "Cancel adding a place", vm::closeAddPlace)
    }
}

/** Moving a place's pin on the shared map ("Edit what you added"). */
@Composable
fun MovePinScreen(vm: AppViewModel) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    Box(Modifier.fillMaxSize()) {
        MapBanner("Drag the pin, or tap the map, then save", "Stop moving the pin", vm::cancelMovePin)
        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Brand.surface).navigationBarsPadding()
                .padding(horizontal = 20.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            error?.let { ErrorBox(it) }
            PrimaryButton(
                if (busy) "Saving…" else "Save pin", enabled = !busy, modifier = Modifier.fillMaxWidth(),
                onClick = {
                    busy = true
                    scope.launch {
                        error = vm.saveMovePin()
                        busy = false
                    }
                },
            )
        }
    }
}

/** "Edit what you added": the place's name and address, and the visitor's flat. */
@Composable
fun EditPlaceScreen(vm: AppViewModel) {
    val draft = vm.editDraft ?: return
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var tried by remember { mutableStateOf(false) }
    val addressError = if (tried && vm.canEditPlace && draft.address.isBlank()) "Enter the building’s address." else null
    val flatError = if (tried && vm.canEditFlat && draft.flatLabel.isBlank()) "Enter your flat number." else null

    FormPage(
        title = "Edit your place",
        onCancel = { vm.editDraft = null },
        action = if (busy) "Saving…" else "Save changes",
        actionEnabled = !busy,
        error = error,
        onAction = {
            tried = true
            if ((vm.canEditPlace && draft.address.isBlank()) || (vm.canEditFlat && draft.flatLabel.isBlank())) return@FormPage
            busy = true
            error = null
            scope.launch {
                error = vm.saveEditPlace(draft)
                busy = false
            }
        },
    ) {
        Text(
            "You can change what you added until someone else reviews it, posts an interaction, or adds a flat here.",
            fontSize = 14.sp, color = Brand.muted,
        )
        if (vm.canEditPlace) {
            Labelled("Building name (optional)") {
                Field(draft.name, { if (it.length <= 200) vm.editDraft = draft.copy(name = it) }, "Building name")
            }
            Labelled("Address", error = addressError) {
                Field(draft.address, { if (it.length <= 500) vm.editDraft = draft.copy(address = it) }, "Address", error = addressError != null)
            }
            QuietButton("Move the pin on the map", onClick = vm::startMovePin, modifier = Modifier.fillMaxWidth())
        }
        if (vm.canEditFlat) Labelled("Your flat", error = flatError) {
            Field(draft.flatLabel, { if (it.length <= 100) vm.editDraft = draft.copy(flatLabel = it) }, "Your flat", error = flatError != null)
        }
    }
}
