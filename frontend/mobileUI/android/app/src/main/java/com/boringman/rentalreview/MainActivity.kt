package com.boringman.rentalreview

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.viewmodel.compose.viewModel
import com.boringman.rentalreview.ui.AppRoot
import com.boringman.rentalreview.ui.AppViewModel
import com.boringman.rentalreview.ui.RentalReviewTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            RentalReviewTheme {
                val vm: AppViewModel = viewModel()
                AppRoot(vm, this@MainActivity)
            }
        }
    }
}
