package com.boringman.rentalreview.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.boringman.rentalreview.data.Review
import com.boringman.rentalreview.search.Point
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * Share or edit a tenant review, or share an interaction. Reviews name no one:
 * the prompt asks for facts about the flat, not names or contact details.
 */
@Composable
fun FeedbackForm(
    vm: AppViewModel,
    tab: FeedbackTab,
    editing: Review?,
    onDone: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var rating by remember { mutableIntStateOf(editing?.rating ?: 5) }
    var text by remember { mutableStateOf(editing?.feedback ?: "") }
    var start by remember { mutableStateOf<LocalDate?>(null) }
    var end by remember { mutableStateOf<LocalDate?>(null) }
    var date by remember { mutableStateOf<LocalDate?>(null) }
    var busy by remember { mutableStateOf(false) }
    val isReview = tab == FeedbackTab.TENANT
    val title = when {
        editing != null -> "Edit your review"
        isReview -> "Share your rental experience"
        else -> "Share an interaction"
    }
    val ready = text.isNotBlank() && when {
        editing != null -> true
        isReview -> start != null && end != null
        else -> date != null
    }

    AlertDialog(
        onDismissRequest = onDone,
        title = { Text(title) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                vm.flat?.let {
                    Text("${it.location.title} · Flat ${it.label}", color = Brand.muted)
                }
                if (isReview) {
                    Text("Your rating", fontWeight = FontWeight.SemiBold)
                    Row {
                        (1..5).forEach { n ->
                            IconButton(onClick = { rating = n }) {
                                Icon(Icons.Filled.Star, contentDescription = "$n ${if (n == 1) "star" else "stars"}",
                                    tint = if (n <= rating) Brand.gold else Brand.line)
                            }
                        }
                    }
                    if (editing == null) {
                        DateField("Tenancy start", start) { start = it }
                        DateField("Tenancy end", end) { end = it }
                    }
                } else {
                    DateField("Interaction date", date) { date = it }
                }
                OutlinedTextField(
                    value = text,
                    onValueChange = { if (it.length <= 10_000) text = it },
                    label = { Text(if (isReview) "Your experience" else "What happened?") },
                    placeholder = {
                        Text("Describe your own experience of the flat: repairs, deposit, communication. " +
                            "Stick to facts, and don’t name people or share contact details.")
                    },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 140.dp),
                )
                Text(
                    if (isReview) "Reviews are published immediately. Ratings and feedback can be edited for 30 days; tenancy dates stay fixed."
                    else "One interaction review per person, per flat. It is published for everyone to read.",
                    color = Brand.muted, fontSize = 12.sp,
                )
            }
        },
        confirmButton = {
            Button(
                enabled = ready && !busy,
                onClick = {
                    busy = true
                    scope.launch {
                        val ok = when {
                            editing != null -> vm.editReview(editing, rating, text.trim())
                            isReview -> vm.postReview(rating, text.trim(), start.toString(), end.toString())
                            else -> vm.postInteraction(text.trim(), date.toString())
                        }
                        busy = false
                        if (ok) onDone()
                    }
                },
            ) { Text(if (busy) "Saving…" else if (editing != null) "Save changes" else "Publish") }
        },
        dismissButton = { TextButton(onClick = onDone) { Text("Cancel") } },
    )
}

/** A date chosen from the calendar; shows the chosen date or a prompt. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DateField(label: String, value: LocalDate?, onChange: (LocalDate) -> Unit) {
    var open by remember { mutableStateOf(false) }
    OutlinedButton(onClick = { open = true }, modifier = Modifier.fillMaxWidth()) {
        Text("$label: " + (value?.let { shortDate(it.toString()) } ?: "choose a date"))
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

/** Add a building at [at] (the map's crosshair) with its first flat. */
@Composable
fun AddPlaceForm(vm: AppViewModel, at: Point, onDone: (Boolean) -> Unit) {
    val scope = rememberCoroutineScope()
    var building by remember { mutableStateOf("") }
    var address by remember { mutableStateOf("") }
    var flatLabel by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = { onDone(false) },
        title = { Text("Add a place") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("At %.5f, %.5f".format(at.latitude, at.longitude), color = Brand.muted, fontSize = 13.sp)
                OutlinedTextField(building, { if (it.length <= 200) building = it },
                    label = { Text("Building name (optional)") }, singleLine = true)
                OutlinedTextField(address, { if (it.length <= 500) address = it },
                    label = { Text("Address") }, singleLine = false)
                OutlinedTextField(flatLabel, { if (it.length <= 100) flatLabel = it },
                    label = { Text("Flat (e.g. A-204)") }, singleLine = true)
            }
        },
        confirmButton = {
            Button(
                enabled = !busy && address.isNotBlank() && flatLabel.isNotBlank(),
                onClick = {
                    busy = true
                    scope.launch {
                        val ok = vm.addPlace(address.trim(), building.trim().ifEmpty { null }, at, flatLabel.trim())
                        busy = false
                        if (ok) onDone(true)
                    }
                },
            ) { Text(if (busy) "Adding…" else "Add place") }
        },
        dismissButton = { TextButton(onClick = { onDone(false) }) { Text("Cancel") } },
    )
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
) {
    val scope = rememberCoroutineScope()
    var value by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDone,
        title = { Text(title) },
        text = { OutlinedTextField(value, { if (it.length <= maxLength) value = it }, label = { Text(label) }) },
        confirmButton = {
            Button(enabled = !busy && value.isNotBlank(), onClick = {
                busy = true
                scope.launch {
                    val ok = onSubmit(value.trim())
                    busy = false
                    if (ok) onDone()
                }
            }) { Text(action) }
        },
        dismissButton = { TextButton(onClick = onDone) { Text("Cancel") } },
    )
}
