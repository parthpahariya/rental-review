package com.boringman.rentalreview.ui

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
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
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.outlined.Map
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.boringman.rentalreview.search.formatDistance

/**
 * A2 · Map and results: the shared map fills [mapHeight] at the top (drawn by
 * MapLayer underneath this screen) and the results sit in a sheet below it.
 * "List only" drops the map entirely; the choice is remembered.
 */
@Composable
fun ResultsScreen(vm: AppViewModel, mapHeight: Dp) {
    var searching by remember { mutableStateOf(false) }
    // A new area closes the search.
    LaunchedEffect(vm.focus?.key) { searching = false }
    val statusTop = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
    val sheetTop = if (vm.listOnly) statusTop + 76.dp else mapHeight - 28.dp

    Box(Modifier.fillMaxSize()) {
        if (!vm.listOnly) {
            FloatingPill(
                "List only", Icons.AutoMirrored.Filled.List, "Show the list only, without the map",
                Modifier.padding(start = 16.dp).offset(y = sheetTop - 54.dp),
            ) { vm.useListOnly(true) }
        }
        ResultsSheet(vm, Modifier.padding(top = sheetTop))

        Row(
            Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.Top,
        ) {
            RoundIconButton(
                Icons.AutoMirrored.Filled.ArrowBack, if (searching) "Close search" else "Back",
                onClick = { if (searching) searching = false else vm.goHome() },
            )
            if (searching) {
                SearchBox(vm, near = vm.mapCenter, modifier = Modifier.weight(1f), autoFocus = true)
            } else {
                Row(
                    Modifier.weight(1f).heightIn(min = 48.dp).shadow(6.dp, RoundedCornerShape(24.dp))
                        .clip(RoundedCornerShape(24.dp)).background(Brand.surface)
                        .clickable(onClickLabel = "Search for another area", role = Role.Button) { searching = true }
                        .padding(horizontal = 16.dp)
                        .semantics(mergeDescendants = true) {
                            contentDescription = "Area: ${vm.area?.name ?: "this map"}. Search for another area"
                        },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(Icons.Outlined.Place, contentDescription = null, tint = Brand.fair, modifier = Modifier.size(18.dp))
                    Text(
                        vm.area?.name ?: "This area", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Brand.ink,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            RoundIconButton(Icons.Filled.Add, "Add a place", onClick = vm::startAddPlace, background = Brand.ink, tint = Brand.surface)
        }
    }
}

/** A white pill floating over the map. */
@Composable
private fun FloatingPill(text: String, icon: ImageVector, description: String, modifier: Modifier, onClick: () -> Unit) {
        Row(
            modifier.heightIn(min = 48.dp).shadow(6.dp, RoundedCornerShape(22.dp)).clip(RoundedCornerShape(22.dp))
                .background(Brand.surface).clickable(onClickLabel = description, role = Role.Button, onClick = onClick)
                .padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(icon, contentDescription = null, tint = Brand.ink, modifier = Modifier.size(16.dp))
            Text(text, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Brand.ink)
        }
    }

@Composable
private fun ResultsSheet(vm: AppViewModel, modifier: Modifier) {
    val places = vm.visiblePlaces()
    val navBottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    var sortOpen by remember { mutableStateOf(false) }

    Column(
        modifier.fillMaxSize().shadow(16.dp, RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
            .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(Brand.goldWash),
    ) {
        Grabber(Modifier.align(Alignment.CenterHorizontally).padding(top = 10.dp))
        Row(
            Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, top = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val count = when {
                vm.loadingPlaces && vm.locations.isEmpty() -> "Loading…"
                else -> "${places.size}${if (vm.partial) "+" else ""} ${if (places.size == 1) "place" else "places"}"
            }
            Text(
                count, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold, color = Brand.ink,
                modifier = Modifier.weight(1f).semantics {
                    heading()
                    liveRegion = LiveRegionMode.Polite
                },
            )
            if (vm.listOnly) LinkButton("Show map", { vm.useListOnly(false) }) {
                Icon(Icons.Outlined.Map, contentDescription = null, tint = Brand.fair, modifier = Modifier.size(16.dp).padding(end = 2.dp))
            }
            Box {
                TextButton(onClick = { sortOpen = true }, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(vm.sort.label, color = Brand.fair, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                    Icon(Icons.Filled.KeyboardArrowDown, contentDescription = null, tint = Brand.fair, modifier = Modifier.size(18.dp))
                }
                DropdownMenu(expanded = sortOpen, onDismissRequest = { sortOpen = false }) {
                    SortOrder.entries.forEach { order ->
                        DropdownMenuItem(
                            text = {
                                Text(
                                    order.label + if (order == SortOrder.NEAREST) " to map centre" else "",
                                    fontWeight = if (order == vm.sort) FontWeight.Bold else FontWeight.Normal,
                                )
                            },
                            onClick = { vm.sort = order; sortOpen = false },
                        )
                    }
                }
            }
        }
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 20.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Chip("Has reviews", vm.onlyReviewed, { vm.onlyReviewed = !vm.onlyReviewed })
            Chip("4★ and up", vm.onlyFourUp, { vm.onlyFourUp = !vm.onlyFourUp })
            Chip("Has interactions", vm.onlyInteractions, { vm.onlyInteractions = !vm.onlyInteractions })
        }
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 16.dp + navBottom),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (places.isEmpty() && !vm.loadingPlaces) item {
                Text(
                    if (vm.locations.isEmpty()) "No places in this area. Move the map to another area, or add a place here with +."
                    else "No places here match these filters.",
                    color = Brand.muted, fontSize = 14.sp, modifier = Modifier.padding(8.dp),
                )
            }
            items(places, key = { it.id }) { l ->
                PlaceRow(l, formatDistance(vm.distanceTo(l)), highlighted = l.id == vm.lastViewedId) { vm.select(l) }
            }
            if (vm.partial) item {
                Text(
                    "This view has more places than fit. Zoom in for the full list.",
                    color = Brand.muted, fontSize = 13.sp, modifier = Modifier.padding(8.dp),
                )
            }
        }
    }
}
