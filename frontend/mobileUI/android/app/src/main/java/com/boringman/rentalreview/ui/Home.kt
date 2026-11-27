package com.boringman.rentalreview.ui

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Map
import androidx.compose.material.icons.outlined.MyLocation
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.boringman.rentalreview.BuildConfig
import com.boringman.rentalreview.search.Area
import com.boringman.rentalreview.search.Point
import com.boringman.rentalreview.search.Region

fun openWeb(context: Context, path: String) {
    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.SITE_URL + path)))
}

/** "Near me": the phone's last known position, after asking permission. */
@Composable
fun rememberLocate(vm: AppViewModel): () -> Unit {
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

/** A1 · Home: no map here, only the way into it. */
@Composable
fun HomeScreen(vm: AppViewModel) {
    val context = LocalContext.current
    val locate = rememberLocate(vm)
    Column(
        Modifier.fillMaxSize().background(Brand.goldWash).statusBarsPadding().verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp),
    ) {
        Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SearchBox(vm, near = Region.defaultCenter, modifier = Modifier.weight(1f))
            AccountCircle(vm)
        }

        Hero(onOpenMap = vm::openMap)

        Row(Modifier.fillMaxWidth().padding(top = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                "Areas with reviews", fontSize = 16.sp, fontWeight = FontWeight.ExtraBold, color = Brand.ink,
                modifier = Modifier.weight(1f).semantics { heading() },
            )
            LinkButton("Near me", onClick = locate) {
                Icon(Icons.Outlined.MyLocation, contentDescription = null, tint = Brand.fair, modifier = Modifier.size(16.dp).padding(end = 2.dp))
            }
        }
        when {
            vm.areasLoading && vm.areas.isEmpty() -> Text("Finding areas…", color = Brand.muted, fontSize = 14.sp)
            vm.areas.isEmpty() -> Text(
                "No reviewed areas yet. Search above, or open the map to look around.",
                color = Brand.muted, fontSize = 14.sp,
            )
            else -> FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                vm.areas.forEach { a ->
                    Row(
                        Modifier.minimumInteractiveComponentSize().heightIn(min = 40.dp).clip(RoundedCornerShape(20.dp))
                            .background(Brand.surface).border(1.dp, Brand.line, RoundedCornerShape(20.dp))
                            .clickable(onClickLabel = "Explore ${a.area.name}") { vm.openArea(a.area) }
                            .semantics(mergeDescendants = true) {
                                contentDescription = "${a.area.name}, ${a.places} ${if (a.places == 1) "place" else "places"} with reviews"
                            }
                            .padding(horizontal = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(a.area.name, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Brand.ink)
                        Text("${a.places}", fontSize = 14.sp, fontWeight = FontWeight.Medium, color = Brand.muted)
                    }
                }
            }
        }

        Row(Modifier.padding(top = 20.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Explainer(
                Icons.Outlined.Key, "Tenant reviews",
                "From people who lived there: rating, dates, what it was like.", Modifier.weight(1f),
            )
            Explainer(
                Icons.Outlined.Visibility, "Interactions",
                "From people who viewed or enquired: red flags early.", Modifier.weight(1f),
            )
        }

        Row(Modifier.padding(top = 12.dp, bottom = 16.dp)) {
            LinkButton("Privacy Policy", { openWeb(context, "/privacy") }, color = Brand.muted)
            LinkButton("Delete your data", { openWeb(context, "/delete-data") }, color = Brand.muted)
        }
    }
}

/** The round gold avatar: the notebook when signed in, sign-in otherwise. */
@Composable
private fun AccountCircle(vm: AppViewModel) {
    val account = vm.account
    Box(
        Modifier.padding(top = 2.dp).size(52.dp).clip(CircleShape).background(Brand.gold)
            .clickable(role = Role.Button) {
                if (account != null) vm.selectTab(Tab.NOTEBOOK) else vm.requireSignIn(Pending.NONE)
            }
            .semantics { contentDescription = if (account != null) "Your account" else "Sign in" },
        contentAlignment = Alignment.Center,
    ) {
        when {
            vm.signingIn -> CircularProgressIndicator(Modifier.size(22.dp), color = Brand.ink, strokeWidth = 2.dp)
            account != null -> Avatar(account)
            else -> Icon(Icons.Filled.Person, contentDescription = null, tint = Brand.ink)
        }
    }
}

/** The dark hero card with the way into the map. */
@Composable
private fun Hero(onOpenMap: () -> Unit) {
    Box(
        Modifier.padding(top = 16.dp).fillMaxWidth().height(220.dp).clip(RoundedCornerShape(24.dp)).background(Brand.ink),
    ) {
        BuildingsArt(Modifier.fillMaxSize())
        Column(
            Modifier.padding(start = 20.dp, top = 20.dp, end = 140.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("BUILDING BY BUILDING", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Brand.gold, letterSpacing = 0.5.sp)
            Text(
                "Rent with your eyes open.", fontSize = 27.sp, lineHeight = 29.sp, fontWeight = FontWeight.ExtraBold,
                color = Brand.surface, modifier = Modifier.semantics { heading() },
            )
        }
        Row(
            Modifier.align(Alignment.BottomStart).padding(20.dp).heightIn(min = 48.dp).clip(RoundedCornerShape(24.dp))
                .background(Brand.gold).clickable(role = Role.Button, onClick = onOpenMap).padding(horizontal = 18.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(Icons.Outlined.Map, contentDescription = null, tint = Brand.ink, modifier = Modifier.size(18.dp))
            Text("Open the map", fontSize = 15.sp, fontWeight = FontWeight.ExtraBold, color = Brand.ink)
        }
    }
}

/** Outlined towers and a gold sun, drawn on the right of a dark band. */
@Composable
fun BuildingsArt(modifier: Modifier = Modifier, sun: Boolean = true) {
    Canvas(modifier) {
        val u = size.height / 220f
        val right = size.width
        val stroke = Stroke(width = 1.5.dp.toPx())
        val line = Brand.gold.copy(alpha = 0.35f)
        fun tower(fromRight: Float, top: Float, width: Float, floors: Int) {
            val x = right - fromRight * u
            drawRect(line, Offset(x, top * u), Size(width * u, size.height - top * u), style = stroke)
            val path = Path()
            repeat(floors) { i ->
                val y = (top + 16 + i * 20) * u
                if (y < size.height - 8 * u) {
                    path.moveTo(x + 10 * u, y)
                    path.lineTo(x + (width - 10) * u, y)
                }
            }
            drawPath(path, line, style = stroke)
        }
        tower(162f, 120f, 38f, 3)
        tower(118f, 92f, 44f, 4)
        tower(68f, 136f, 46f, 2)
        if (sun) drawCircle(Brand.gold, 16 * u, Offset(right - 96 * u, 64 * u))
    }
}

@Composable
private fun Explainer(icon: ImageVector, title: String, body: String, modifier: Modifier) {
    Column(
        modifier.card(16.dp).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(icon, contentDescription = null, tint = Brand.fair, modifier = Modifier.size(22.dp))
        Text(title, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Brand.ink)
        Text(body, fontSize = 12.5.sp, lineHeight = 17.sp, color = Brand.muted)
    }
}
