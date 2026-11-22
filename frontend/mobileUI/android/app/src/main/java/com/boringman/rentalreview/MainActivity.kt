package com.boringman.rentalreview

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import com.boringman.rentalreview.ui.AppViewModel
import com.boringman.rentalreview.ui.ExploreScreen
import com.boringman.rentalreview.ui.HomeScreen
import com.boringman.rentalreview.ui.NotebookScreen
import com.boringman.rentalreview.ui.ReactivationDialog
import com.boringman.rentalreview.ui.RentalReviewTheme
import com.boringman.rentalreview.ui.Screen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            RentalReviewTheme {
                val vm: AppViewModel = viewModel()
                val snackbar = remember { SnackbarHostState() }
                LaunchedEffect(vm.message) {
                    vm.message?.let {
                        snackbar.showSnackbar(it)
                        vm.message = null
                    }
                }
                // Back goes from the map or notebook to the home page.
                BackHandler(enabled = vm.screen != Screen.HOME) { vm.goHome() }
                Box(Modifier.fillMaxSize()) {
                    when (vm.screen) {
                        Screen.HOME -> HomeScreen(vm, this@MainActivity)
                        Screen.EXPLORE -> ExploreScreen(vm, this@MainActivity)
                        Screen.NOTEBOOK -> NotebookScreen(vm, this@MainActivity)
                    }
                    SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).navigationBarsPadding())
                }
                if (vm.reactivationPending) ReactivationDialog(vm)
            }
        }
    }
}
