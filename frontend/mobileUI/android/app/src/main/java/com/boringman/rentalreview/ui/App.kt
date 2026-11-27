package com.boringman.rentalreview.ui

import android.app.Activity
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.filled.AddBox
import androidx.compose.material.icons.filled.Explore
import androidx.compose.material.icons.outlined.AddBox
import androidx.compose.material.icons.outlined.Explore
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The app's frame: the one shared map (once asked for) in a fixed slot at the
 * bottom of the stack, the current tab's screen over it, full-screen pages
 * (place, forms) over that, and the bottom navigation.
 */
@Composable
fun AppRoot(vm: AppViewModel, activity: Activity) {
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(vm.message) {
        vm.message?.let {
            snackbar.showSnackbar(it)
            vm.message = null
        }
    }
    BackHandler(enabled = vm.canGoBack) { vm.back() }

    val mode = vm.mapMode
    // The map is created the first time a screen asks for it, then kept for the session.
    SideEffect { if (mode != MapMode.HIDDEN) vm.markMapStarted() }

    Column(Modifier.fillMaxSize().background(Brand.goldWash)) {
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
            val mapHeight = when (mode) {
                MapMode.MOVE_PIN -> maxHeight
                MapMode.ADD_PLACE -> maxHeight * 0.42f
                else -> maxHeight * 0.46f
            }
            val provider = vm.provider
            if ((vm.mapStarted || mode != MapMode.HIDDEN) && provider != null) {
                MapLayer(
                    vm, provider, mode,
                    bottomInset = if (mode == MapMode.MOVE_PIN) 96.dp else 28.dp,
                    modifier = Modifier.fillMaxWidth().height(mapHeight),
                )
            }
            if (vm.movePin == null) {
                when (vm.tab) {
                    Tab.EXPLORE -> if (vm.resultsOpen) ResultsScreen(vm, mapHeight) else HomeScreen(vm)
                    Tab.ADD -> AddPlaceScreen(vm, mapHeight)
                    Tab.NOTEBOOK -> NotebookScreen(vm, activity)
                }
                if (vm.selected != null) PlaceScreen(vm)
                if (vm.editDraft != null) EditPlaceScreen(vm)
            } else {
                MovePinScreen(vm)
            }
            vm.form?.let { key(it) { FeedbackForm(vm, it) } }
            SnackbarHost(
                snackbar,
                Modifier.align(Alignment.BottomCenter).navigationBarsPadding()
                    .padding(bottom = if (vm.showsBottomBar) 8.dp else 84.dp),
            )
        }
        if (vm.showsBottomBar) BottomBar(vm)
    }

    vm.signInFor?.let { SignInSheet(vm, activity, it) }
    if (vm.reactivationPending) ReactivationDialog(vm)
}

/** Explore · Add place · Notebook. */
@Composable
private fun BottomBar(vm: AppViewModel) {
    Column(Modifier.fillMaxWidth().background(Brand.surface)) {
        HorizontalDivider(color = Brand.line)
        Row(Modifier.navigationBarsPadding().fillMaxWidth().height(60.dp)) {
            NavItem("Explore", Icons.Outlined.Explore, Icons.Filled.Explore, vm.tab == Tab.EXPLORE) { vm.selectTab(Tab.EXPLORE) }
            NavItem("Add place", Icons.Outlined.AddBox, Icons.Filled.AddBox, vm.tab == Tab.ADD) { vm.selectTab(Tab.ADD) }
            NavItem(
                "Notebook", Icons.AutoMirrored.Outlined.MenuBook, Icons.AutoMirrored.Filled.MenuBook,
                vm.tab == Tab.NOTEBOOK,
            ) { vm.selectTab(Tab.NOTEBOOK) }
        }
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.NavItem(
    label: String,
    icon: ImageVector,
    selectedIcon: ImageVector,
    on: Boolean,
    onClick: () -> Unit,
) {
    Column(
        Modifier.weight(1f).fillMaxHeight().clickable(role = Role.Tab, onClick = onClick).semantics { selected = on },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            if (on) selectedIcon else icon, contentDescription = null,
            tint = if (on) Brand.gold else Brand.muted, modifier = Modifier.size(24.dp),
        )
        Text(
            label, fontSize = 11.sp, fontWeight = if (on) FontWeight.Bold else FontWeight.Medium,
            color = if (on) Brand.ink else Brand.muted,
        )
    }
}
