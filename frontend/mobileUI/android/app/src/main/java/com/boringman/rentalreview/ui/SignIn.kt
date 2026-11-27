package com.boringman.rentalreview.ui

import android.app.Activity
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.background

/** Google's four-colour "G", for the Continue with Google button. */
private val GoogleG: ImageVector by lazy {
    fun ImageVector.Builder.path(color: Long, d: String) =
        addPath(PathParser().parsePathString(d).toNodes(), fill = SolidColor(Color(color)))
    ImageVector.Builder("GoogleG", 20.dp, 20.dp, 48f, 48f).apply {
        path(0xFFEA4335, "M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6C12.4 13.7 17.7 9.5 24 9.5z")
        path(0xFF4285F4, "M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z")
        path(0xFFFBBC05, "M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.3.8-4.7l-7.8-6C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7z")
        path(0xFF34A853, "M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.2-13.5-9.9l-7.8 6C6.6 42.6 14.6 48 24 48z")
    }.build()
}

/** Where the visitor will land after signing in, in the sheet's words. */
private fun resumeLine(vm: AppViewModel, pending: Pending): String {
    val place = vm.selected?.title
    val flat = vm.flat?.label
    val where = when {
        place != null && flat != null -> "$place, Flat $flat"
        place != null -> place
        else -> null
    }
    return when (pending) {
        Pending.REVIEW -> where?.let { "You’ll come straight back to your review of $it." }
        Pending.INTERACTION -> where?.let { "You’ll come straight back to your interaction at $it." }
        Pending.ADD_FLAT -> place?.let { "You’ll come straight back to adding your flat at $it." }
        Pending.ADD_PLACE -> "You’ll come straight back to adding a place."
        Pending.NOTEBOOK -> "Your notebook keeps your reviews, interactions and places in one private spot."
        Pending.NONE -> null
    } ?: "Share reviews, add places and join discussions. Reading stays open to everyone."
}

/** A4 · Sign in: a sheet over the page; the pending action resumes afterwards. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SignInSheet(vm: AppViewModel, activity: Activity, pending: Pending) {
    ModalBottomSheet(
        onDismissRequest = vm::dismissSignIn,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Brand.goldWash,
        scrimColor = Brand.ink.copy(alpha = 0.45f),
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
        dragHandle = { Grabber(Modifier.padding(top = 10.dp)) },
    ) {
        Column(
            Modifier.fillMaxWidth().navigationBarsPadding().padding(start = 24.dp, end = 24.dp, top = 16.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Row(verticalAlignment = Alignment.Top) {
                Box(
                    Modifier.size(56.dp).clip(RoundedCornerShape(16.dp)).background(Brand.gold),
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Outlined.Home, contentDescription = null, tint = Brand.ink, modifier = Modifier.size(28.dp)) }
                Spacer(Modifier.weight(1f))
                RoundIconButton(Icons.Filled.Close, "Close", vm::dismissSignIn, background = Brand.beige)
            }
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    "Sign in to share", fontSize = 26.sp, fontWeight = FontWeight.ExtraBold, color = Brand.ink,
                    modifier = Modifier.semantics { heading() },
                )
                Text(resumeLine(vm, pending), fontSize = 15.sp, lineHeight = 22.sp, color = Brand.muted)
            }
            OutlinedButton(
                onClick = { vm.signIn(activity) },
                enabled = !vm.signingIn,
                modifier = Modifier.fillMaxWidth().height(54.dp),
                shape = RoundedCornerShape(16.dp),
                border = BorderStroke(1.5.dp, Brand.ink),
                colors = ButtonDefaults.outlinedButtonColors(containerColor = Brand.surface, contentColor = Brand.ink),
            ) {
                if (vm.signingIn) CircularProgressIndicator(Modifier.size(20.dp), color = Brand.ink, strokeWidth = 2.dp)
                else Icon(GoogleG, contentDescription = null, tint = Color.Unspecified, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(12.dp))
                Text(if (vm.signingIn) "Signing in…" else "Continue with Google", fontSize = 16.sp, fontWeight = FontWeight.Bold)
            }
            Column(
                Modifier.fillMaxWidth().card(16.dp).padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Reassurance("Your name and email are never shown on reviews.")
                Reassurance("Edit your review for 30 days, or ask us to delete it.")
            }
        }
    }
}

@Composable
private fun Reassurance(text: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Icon(Icons.Filled.Check, contentDescription = null, tint = Brand.good, modifier = Modifier.size(20.dp))
        Text(text, fontSize = 14.sp, lineHeight = 20.sp, color = Brand.ink)
    }
}

/** Shown when a deactivated account signs in again. */
@Composable
fun ReactivationDialog(vm: AppViewModel) {
    androidx.compose.material3.AlertDialog(
        onDismissRequest = { vm.confirmReactivation(false) },
        containerColor = Brand.goldWash,
        title = { Text("Welcome back", fontWeight = FontWeight.ExtraBold) },
        text = { Text("This account was deactivated. Reactivate it to sign in; your reviews are unchanged.") },
        confirmButton = {
            Button(
                onClick = { vm.confirmReactivation(true) },
                colors = ButtonDefaults.buttonColors(containerColor = Brand.gold, contentColor = Brand.ink),
            ) { Text("Reactivate my account", fontWeight = FontWeight.Bold) }
        },
        dismissButton = { LinkButton("Cancel", { vm.confirmReactivation(false) }, color = Brand.ink) },
    )
}
