package com.boringman.rentalreview.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * A full-screen form: Cancel and the title on top, the fields scrolling, and
 * the gold action pinned to the bottom with any error just above it.
 */
@Composable
fun FormPage(
    title: String,
    onCancel: () -> Unit,
    action: String,
    actionEnabled: Boolean,
    error: String?,
    onAction: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(Modifier.fillMaxSize().background(Brand.goldWash).statusBarsPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(88.dp)) { LinkButton("Cancel", onCancel) }
            Text(
                title, fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Brand.ink, textAlign = TextAlign.Center,
                modifier = Modifier.weight(1f).semantics { heading() },
            )
            Box(Modifier.width(88.dp))
        }
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
            content = content,
        )
        Column(Modifier.fillMaxWidth().background(Brand.surface)) {
            HorizontalDivider(color = Brand.line)
            Column(
                Modifier.navigationBarsPadding().padding(horizontal = 20.dp, vertical = 14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                error?.let { Box(Modifier.semantics { liveRegion = LiveRegionMode.Polite }) { ErrorBox(it) } }
                PrimaryButton(action, onAction, Modifier.fillMaxWidth(), enabled = actionEnabled)
            }
        }
    }
}

private val reviewTopics = listOf(
    "Deposit" to "Deposit: ",
    "Repairs" to "Repairs: ",
    "Rent hikes" to "Rent hikes: ",
    "Water & power" to "Water & power: ",
)
private val interactionTopics = listOf(
    "Viewing" to "The viewing: ",
    "Rent & deposit asked" to "Rent and deposit asked: ",
    "How they replied" to "How they replied: ",
    "Red flags" to "Red flags: ",
)

/**
 * A5 · Share or edit a tenant review, or share an interaction. Reviews name no
 * one: the prompt asks for facts about the flat, not names or contact details.
 * Errors (e.g. an overlapping tenancy) stay in the form, which keeps the text.
 */
@Composable
fun FeedbackForm(vm: AppViewModel, form: Form) {
    val editing = form.editing
    val isReview = form.kind == FeedbackTab.TENANT
    val scope = rememberCoroutineScope()
    var rating by remember { mutableStateOf(editing?.rating) }
    var text by remember { mutableStateOf(TextFieldValue(editing?.feedback ?: "")) }
    var start by remember { mutableStateOf<LocalDate?>(null) }
    var end by remember { mutableStateOf<LocalDate?>(null) }
    var date by remember { mutableStateOf<LocalDate?>(null) }
    var busy by remember { mutableStateOf(false) }
    var tried by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val ratingError = if (tried && isReview && rating == null) "Choose a rating from 1 to 5." else null
    val startError = if (tried && isReview && editing == null && start == null) "Choose when you moved in." else null
    val endError = when {
        !tried || !isReview || editing != null -> null
        end == null -> "Choose when you moved out."
        start?.let { end?.isAfter(it) } == false -> "Moved out must be after moved in."
        else -> null
    }
    val dateError = if (tried && !isReview && date == null) "Choose the date." else null
    val textError = if (tried && text.text.isBlank()) {
        if (isReview) "Tell other renters what it was like." else "Say what happened."
    } else null

    val title = when {
        editing != null -> "Edit your review"
        isReview -> "Tenant review"
        else -> "Interaction"
    }
    FormPage(
        title = title,
        onCancel = { vm.form = null },
        action = when {
            busy -> "Saving…"
            editing != null -> "Save changes"
            isReview -> "Publish review"
            else -> "Publish interaction"
        },
        actionEnabled = !busy,
        error = error,
        onAction = {
            tried = true
            val invalid = (isReview && rating == null) || text.text.isBlank() || when {
                editing != null -> false
                isReview -> start.let { s -> s == null || end?.isAfter(s) != true }
                else -> date == null
            }
            if (invalid) return@FormPage
            busy = true
            error = null
            scope.launch {
                val body = text.text.trim()
                error = when {
                    editing != null -> vm.editReview(editing, rating!!, body)
                    isReview -> vm.postReview(rating!!, body, start.toString(), end.toString())
                    else -> vm.postInteraction(body, date.toString())
                }
                busy = false
                if (error == null) vm.form = null
            }
        },
    ) {
        // What is being reviewed.
        val place = editing?.place
        val heading = place?.let { "${it.building_name ?: "Rental property"} · Flat ${it.flat_label}" }
            ?: vm.flat?.let { "${it.location.title} · Flat ${it.label}" }
        val address = place?.address ?: vm.flat?.location?.address
        if (heading != null) Row(
            Modifier.fillMaxWidth().card(16.dp).padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(Icons.Outlined.Home, contentDescription = null, tint = Brand.fair, modifier = Modifier.size(22.dp))
            Column {
                Text(heading, fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Brand.ink)
                address?.let { Text(it, fontSize = 13.sp, color = Brand.muted, maxLines = 1) }
            }
        }

        if (isReview) Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("How was living there?", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Brand.ink)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                (1..5).forEach { n ->
                    val on = rating == n
                    val color = ratingColor(n.toDouble())
                    Box(
                        Modifier.weight(1f).height(56.dp).clip(RoundedCornerShape(14.dp))
                            .background(if (on) color else Brand.surface)
                            .border(if (on) 2.dp else 1.dp, if (on) color else Brand.line, RoundedCornerShape(14.dp))
                            .clickable(role = Role.RadioButton) { rating = n }
                            .semantics {
                                contentDescription = "$n of 5"
                                selected = on
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            "$n", fontSize = 18.sp, fontWeight = if (on) FontWeight.ExtraBold else FontWeight.Bold,
                            color = if (on) Color.White else Brand.ink,
                        )
                    }
                }
            }
            Row {
                Text("Avoid", fontSize = 12.5.sp, color = Brand.muted, modifier = Modifier.weight(1f))
                Text("Good — would rent again", fontSize = 12.5.sp, color = Brand.muted)
            }
            ratingError?.let { Text(it, fontSize = 13.sp, color = Brand.poor, fontWeight = FontWeight.SemiBold) }
        }

        if (isReview && editing == null) Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Labelled("Moved in", Modifier.weight(1f), error = startError) { DateBox("Moved in", start) { start = it } }
            Labelled("Moved out", Modifier.weight(1f), error = endError) { DateBox("Moved out", end) { end = it } }
        }
        if (editing != null) Text(
            "Tenancy ${shortDate(editing.tenancy_start_date)} – ${shortDate(editing.tenancy_end_date)}. " +
                "Dates stay as submitted; the rating and text can change until ${shortDate(editing.editing_deadline)}.",
            fontSize = 13.sp, color = Brand.muted,
        )
        if (!isReview) Labelled("When was it?", error = dateError) { DateBox("Interaction date", date) { date = it } }

        Labelled(
            if (isReview) "What was it like?" else "What happened?",
            error = textError,
            helper = if (isReview) "Facts about the flat: deposit, repairs, rent changes, neighbourhood. No names or phone numbers."
            else "A viewing or enquiry: what you were told and what you saw. No names or phone numbers.",
        ) {
            OutlinedTextField(
                value = text,
                onValueChange = { if (it.text.length <= 10_000) text = it },
                modifier = Modifier.fillMaxWidth().heightIn(min = 140.dp)
                    .semantics { contentDescription = if (isReview) "What was it like?" else "What happened?" },
                isError = textError != null,
                shape = RoundedCornerShape(12.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedContainerColor = Brand.surface, unfocusedContainerColor = Brand.surface, errorContainerColor = Brand.surface,
                    focusedBorderColor = Brand.gold, unfocusedBorderColor = Brand.line, cursorColor = Brand.ink,
                ),
            )
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            (if (isReview) reviewTopics else interactionTopics).forEach { (label, prompt) ->
                Chip("+ $label", false, {
                    val current = text.text.trimEnd()
                    val next = (if (current.isEmpty()) "" else "$current\n") + prompt
                    if (next.length <= 10_000) text = TextFieldValue(next, TextRange(next.length))
                })
            }
        }
        Text(
            if (isReview) "Reviews are published immediately. Ratings and text can be edited for 30 days; tenancy dates stay fixed."
            else "One interaction per person, per flat. It is published for everyone to read.",
            color = Brand.muted, fontSize = 12.sp,
        )
    }
}

/** A date chosen from the calendar; shows the chosen date or a prompt. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DateBox(label: String, value: LocalDate?, onChange: (LocalDate) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(12.dp)).background(Brand.surface)
            .border(1.dp, Brand.line, RoundedCornerShape(12.dp))
            .clickable(onClickLabel = "Choose $label", role = Role.Button) { open = true }
            .padding(horizontal = 12.dp)
            .semantics(mergeDescendants = true) {
                contentDescription = "$label: " + (value?.let { shortDate(it.toString()) } ?: "not chosen")
            },
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(
            value?.let { shortDate(it.toString()) } ?: "Choose",
            fontSize = 15.sp, fontWeight = FontWeight.Medium, color = if (value == null) Brand.muted else Brand.ink,
        )
    }
    if (open) {
        val state = rememberDatePickerState(
            initialSelectedDateMillis = value?.atStartOfDay(ZoneOffset.UTC)?.toInstant()?.toEpochMilli(),
        )
        DatePickerDialog(
            onDismissRequest = { open = false },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let {
                        onChange(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate())
                    }
                    open = false
                }) { Text("OK") }
            },
            dismissButton = { TextButton(onClick = { open = false }) { Text("Cancel") } },
        ) { DatePicker(state = state) }
    }
}

/** A single short text answer, e.g. a new flat's label or a deletion reason. */
@Composable
fun TextPrompt(
    title: String,
    label: String,
    action: String,
    maxLength: Int,
    onSubmit: suspend (String) -> Boolean,
    onDone: () -> Unit,
    initial: String = "",
    note: String? = null,
) {
    val scope = rememberCoroutineScope()
    var value by remember { mutableStateOf(initial) }
    var busy by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDone,
        containerColor = Brand.goldWash,
        title = { Text(title, fontWeight = FontWeight.ExtraBold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Labelled(label) { Field(value, { if (it.length <= maxLength) value = it }, label) }
                note?.let { Text(it, fontSize = 13.sp, color = Brand.muted) }
            }
        },
        confirmButton = {
            PrimaryButton(
                if (busy) "Saving…" else action, height = 48.dp, enabled = !busy && value.isNotBlank(),
                onClick = {
                    busy = true
                    scope.launch {
                        val ok = onSubmit(value.trim())
                        busy = false
                        if (ok) onDone()
                    }
                },
            )
        },
        dismissButton = { LinkButton("Cancel", onDone, color = Brand.ink) },
    )
}
