package com.boringman.rentalreview.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.boringman.rentalreview.search.Point
import com.boringman.rentalreview.search.Region
import com.boringman.rentalreview.search.SearchService
import com.boringman.rentalreview.search.Suggestion
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun SearchBox(vm: AppViewModel, near: Point?, modifier: Modifier = Modifier) {
    var text by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<SearchService.Result?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    val term = text.trim()

    // Wait for a pause in typing; a newer term cancels the older search.
    LaunchedEffect(term) {
        results = null
        error = null
        if (term.length < SearchService.MIN_SEARCH) {
            busy = false
            return@LaunchedEffect
        }
        busy = true
        delay(400)
        try {
            results = vm.search.search(term, near)
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            error = "Place suggestions are unavailable right now."
        }
        busy = false
    }

    fun choose(s: Suggestion) {
        focus.clearFocus()
        scope.launch {
            runCatching { s.resolve() }
                .onSuccess { vm.openArea(it); text = "" }
                .onFailure { error = "We couldn’t open that place. Try another." }
        }
    }

    Column(modifier) {
        OutlinedTextField(
            value = text,
            onValueChange = { text = it },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("Search a locality or building") },
            leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
            trailingIcon = {
                if (text.isNotEmpty()) IconButton(onClick = { text = "" }) {
                    Icon(Icons.Filled.Clear, contentDescription = "Clear search")
                }
            },
            singleLine = true,
            shape = RoundedCornerShape(999.dp),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { results?.suggestions?.firstOrNull()?.let(::choose) }),
            colors = OutlinedTextFieldDefaults.colors(
                focusedContainerColor = Brand.surface, unfocusedContainerColor = Brand.surface,
                focusedBorderColor = Brand.gold, unfocusedBorderColor = Brand.line,
            ),
        )
        if (term.length >= SearchService.MIN_SEARCH) {
            Column(
                Modifier.fillMaxWidth().padding(top = 6.dp)
                    .border(1.dp, Brand.line, RoundedCornerShape(16.dp))
                    .background(Brand.surface, RoundedCornerShape(16.dp)).padding(vertical = 6.dp),
            ) {
                val list = results?.suggestions.orEmpty()
                list.forEach { s ->
                    Row(
                        Modifier.fillMaxWidth().clickable { choose(s) }.padding(horizontal = 14.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            when (s.kind) {
                                Suggestion.Kind.LISTED -> Icons.Filled.Star
                                Suggestion.Kind.BUILDING -> Icons.Filled.Home
                                Suggestion.Kind.AREA -> Icons.Filled.Place
                            },
                            contentDescription = null, tint = Brand.muted, modifier = Modifier.size(18.dp),
                        )
                        Spacer(Modifier.width(10.dp))
                        Column {
                            Text(s.name, fontWeight = FontWeight.SemiBold)
                            s.detail?.let { Text(it, color = Brand.muted, fontSize = 12.sp, maxLines = 1) }
                        }
                    }
                }
                val status = when {
                    busy -> "Finding places…"
                    error != null && list.isEmpty() -> error
                    list.isEmpty() -> "No places in ${Region.NAME} match “$term”."
                    else -> null
                }
                status?.let {
                    Text(it, color = if (error != null) Brand.poor else Brand.muted,
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp))
                }
                val attribution = results?.attribution
                if (attribution != null && list.any { it.kind != Suggestion.Kind.LISTED }) {
                    Text(attribution, color = Brand.muted, fontSize = 11.sp,
                        modifier = Modifier.align(Alignment.End).padding(horizontal = 14.dp, vertical = 4.dp))
                }
            }
        }
    }
}
