package com.boringman.rentalreview.ui

import android.graphics.PointF
import android.view.View
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import com.boringman.rentalreview.data.Location
import com.boringman.rentalreview.maps.MAX_ZOOM
import com.boringman.rentalreview.maps.MapProvider
import com.boringman.rentalreview.maps.Marker
import com.boringman.rentalreview.maps.cluster
import com.boringman.rentalreview.maps.clusterRadius
import com.boringman.rentalreview.maps.shortCount
import com.boringman.rentalreview.search.Bounds
import com.boringman.rentalreview.search.Point
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapLibreMapOptions
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * The app's one map. It is composed only once the visitor first asks for a map
 * (MainActivity's root keeps it in a fixed slot from then on), so the provider's
 * style and tiles load only on demand, and results, adding a place and moving a
 * pin all reuse this single MapView. In [MapMode.HIDDEN] it stays alive but is
 * stopped and invisible. MapLibre's ambient tile cache is left at its default (on).
 *
 * Rating pins, bubbles and the searched-place marker are Compose views drawn on
 * top; in [MapMode.ADD_PLACE] and [MapMode.MOVE_PIN] a draggable pin marks the spot.
 */
@Composable
fun MapLayer(vm: AppViewModel, provider: MapProvider, mode: MapMode, bottomInset: Dp, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val lifecycleState by lifecycleOwner.lifecycle.currentStateAsState()
    val mapView = remember {
        MapView(context, MapLibreMapOptions.createFromAttributes(context).textureMode(true)).apply { onCreate(null) }
    }
    var map by remember { mutableStateOf<MapLibreMap?>(null) }
    // Bumped on every camera move so the overlay re-projects the pins.
    var cameraTick by remember { mutableIntStateOf(0) }
    val density = LocalDensity.current
    val currentMode by rememberUpdatedState(mode)

    // Run the map only while it is on screen and the app is in front:
    // 0 = created, 1 = started, 2 = resumed.
    val running = remember { intArrayOf(0) }
    val target = when {
        mode == MapMode.HIDDEN -> 0
        lifecycleState.isAtLeast(Lifecycle.State.RESUMED) -> 2
        lifecycleState.isAtLeast(Lifecycle.State.STARTED) -> 1
        else -> 0
    }
    fun stepTo(goal: Int) {
        while (running[0] < goal) {
            if (running[0] == 0) mapView.onStart() else mapView.onResume()
            running[0]++
        }
        while (running[0] > goal) {
            if (running[0] == 2) mapView.onPause() else mapView.onStop()
            running[0]--
        }
    }
    LaunchedEffect(target) { stepTo(target) }
    DisposableEffect(Unit) {
        onDispose {
            stepTo(0)
            mapView.onDestroy()
        }
    }

    LaunchedEffect(provider) {
        mapView.addOnDidFailLoadingMapListener { vm.mapFailed() }
        mapView.getMapAsync { m ->
            m.uiSettings.isRotateGesturesEnabled = false
            m.uiSettings.isTiltGesturesEnabled = false
            m.uiSettings.isCompassEnabled = false
            m.setMaxZoomPreference(MAX_ZOOM)
            m.cameraPosition = CameraPosition.Builder()
                .target(LatLng(vm.mapCenter.latitude, vm.mapCenter.longitude)).zoom(vm.mapZoom).build()
            val style = Style.Builder().let { b ->
                provider.styleUri?.let { b.fromUri(it) } ?: b.fromJson(provider.styleJson!!)
            }
            m.setStyle(style) {
                map = m
                cameraTick++
            }
            m.addOnCameraMoveListener { cameraTick++ }
            m.addOnCameraIdleListener {
                cameraTick++
                if (currentMode == MapMode.HIDDEN) return@addOnCameraIdleListener
                val target = m.cameraPosition.target ?: return@addOnCameraIdleListener
                val r = m.projection.visibleRegion.latLngBounds
                vm.onViewport(
                    Bounds(
                        west = r.longitudeWest.coerceIn(-180.0, 180.0),
                        south = r.latitudeSouth.coerceIn(-90.0, 90.0),
                        east = r.longitudeEast.coerceIn(-180.0, 180.0),
                        north = r.latitudeNorth.coerceIn(-90.0, 90.0),
                    ),
                    Point(target.latitude, target.longitude),
                    m.cameraPosition.zoom,
                )
            }
            // Tapping the map moves the draft pin there.
            m.addOnMapClickListener { at ->
                when (currentMode) {
                    MapMode.ADD_PLACE -> { vm.moveDraft(Point(at.latitude, at.longitude)); true }
                    MapMode.MOVE_PIN -> { vm.dragMovePin(Point(at.latitude, at.longitude)); true }
                    else -> false
                }
            }
        }
    }

    // Keep MapLibre's own logo and credit above whatever sheet covers the map's bottom.
    LaunchedEffect(map, bottomInset) {
        val m = map ?: return@LaunchedEffect
        val px = with(density) { (bottomInset + 4.dp).roundToPx() }
        val side = with(density) { 6.dp.roundToPx() }
        m.uiSettings.setLogoMargins(side, 0, 0, px)
        m.uiSettings.setAttributionMargins(with(density) { 96.dp.roundToPx() }, 0, 0, px)
    }

    // Move the map when an area, building or pin to move is chosen.
    LaunchedEffect(map, vm.focus?.key) {
        val m = map ?: return@LaunchedEffect
        val f = vm.focus ?: return@LaunchedEffect
        if (f.key == vm.appliedFocus) return@LaunchedEffect
        vm.appliedFocus = f.key
        val area = f.area
        val b = area.bounds
        if (b != null && b.north - b.south > 0.004) {
            val padding = with(density) { 40.dp.roundToPx() }
            m.easeCamera(
                CameraUpdateFactory.newLatLngBounds(LatLngBounds.from(b.north, b.east, b.south, b.west), padding),
                600,
            )
        } else {
            m.easeCamera(
                CameraUpdateFactory.newLatLngZoom(LatLng(area.center.latitude, area.center.longitude), area.zoom),
                600,
            )
        }
    }

    Box(modifier) {
        AndroidView(
            factory = { mapView },
            update = { it.visibility = if (mode == MapMode.HIDDEN) View.INVISIBLE else View.VISIBLE },
            modifier = Modifier.fillMaxSize(),
        )

        val m = map
        if (m != null && mode != MapMode.HIDDEN) {
            @Suppress("UNUSED_EXPRESSION") cameraTick // re-read on every camera move
            val zoom = m.cameraPosition.zoom
            val radiusPx = with(density) { clusterRadius(zoom).dp.toPx() }
            fun screen(p: Point) = m.projection.toScreenLocation(LatLng(p.latitude, p.longitude))

            if (mode == MapMode.RESULTS || mode == MapMode.ADD_PLACE) {
                val markers = cluster(vm.locations, zoom, radiusPx) { l ->
                    val p = m.projection.toScreenLocation(LatLng(l.latitude, l.longitude))
                    if (p.x < -50 || p.y < -50 || p.x > mapView.width + 50 || p.y > mapView.height + 50) null
                    else p.x to p.y
                }
                markers.forEach { marker ->
                    when (marker) {
                        is Marker.Pin -> RatingPin(marker.location, marker.location.id == vm.lastViewedId, marker.x, marker.y) {
                            vm.select(marker.location)
                        }
                        is Marker.Bubble -> Bubble(marker.locations.size, vm.partial, marker.x, marker.y) {
                            zoomInto(m, marker.locations, density.density)
                        }
                    }
                }
            }
            if (mode == MapMode.RESULTS) vm.searched?.let { s ->
                val p = screen(s.center)
                SearchedMarker(s.name, p.x, p.y)
            }
            if (mode == MapMode.ADD_PLACE) vm.draftPin?.let { at ->
                val p = screen(at)
                // The 100 m around the pin, where places already listed are shown.
                val edge = screen(Point(at.latitude + 100.0 / 111_320.0, at.longitude))
                val radius = abs(p.y - edge.y)
                Canvas(Modifier.fillMaxSize()) {
                    drawCircle(Brand.gold.copy(alpha = 0.10f), radius, Offset(p.x, p.y))
                    drawCircle(
                        Brand.gold, radius, Offset(p.x, p.y),
                        style = Stroke(width = 1.5.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(14f, 14f))),
                    )
                }
                DraggablePin("+ New", "New place pin. Drag it onto the building, or tap the map.", p.x, p.y) { x, y ->
                    val ll = m.projection.fromScreenLocation(PointF(x, y))
                    vm.moveDraft(Point(ll.latitude, ll.longitude))
                }
            }
            if (mode == MapMode.MOVE_PIN) vm.movePin?.let { at ->
                val p = screen(at)
                DraggablePin(vm.selected?.title ?: "Your place", "Your place's pin. Drag it, or tap the map.", p.x, p.y) { x, y ->
                    val ll = m.projection.fromScreenLocation(PointF(x, y))
                    vm.dragMovePin(Point(ll.latitude, ll.longitude))
                }
            }
        }

        if (vm.mapUnavailable && mode != MapMode.HIDDEN) {
            Text(
                "The map isn’t available right now. The list shows the same places.",
                color = Brand.muted,
                modifier = Modifier.align(Alignment.Center).padding(24.dp)
                    .background(Brand.surface, RoundedCornerShape(12.dp)).padding(14.dp),
            )
        }
        Text(
            provider.attribution, fontSize = 10.sp, color = Brand.ink,
            modifier = Modifier.align(Alignment.BottomEnd).padding(bottom = bottomInset)
                .background(Color(0xCCFFFFFF)).padding(horizontal = 6.dp, vertical = 2.dp),
        )
    }
}

/** Zooms so a bubble's places spread out (or one level in, if they share a spot). */
private fun zoomInto(m: MapLibreMap, locations: List<Location>, density: Float) {
    val lats = locations.map { it.latitude }
    val lngs = locations.map { it.longitude }
    if (lats.max() - lats.min() < 1e-5 && lngs.max() - lngs.min() < 1e-5) {
        m.easeCamera(CameraUpdateFactory.zoomBy(2.0), 400)
        return
    }
    m.easeCamera(
        CameraUpdateFactory.newLatLngBounds(
            LatLngBounds.from(lats.max(), lngs.max(), lats.min(), lngs.min()), (60 * density).roundToInt(),
        ),
        500,
    )
}

/** Places a view with its bottom centre ([bottom]) or centre on a screen point. */
private fun Modifier.at(x: Float, y: Float, bottom: Boolean) =
    offset { IntOffset(x.roundToInt(), y.roundToInt()) }.layout { measurable, constraints ->
        val p = measurable.measure(constraints)
        layout(p.width, p.height) { p.place(-p.width / 2, if (bottom) -p.height else -p.height / 2) }
    }

/** A building's pin: its rating in the rating colour (ink and gold once opened). */
@Composable
private fun RatingPin(location: Location, active: Boolean, x: Float, y: Float, onClick: () -> Unit) {
    val rating = location.summary?.average_rating
    val label = rating?.let { "%.1f".format(it) } ?: "New"
    Row(
        Modifier.at(x, y, bottom = true)
            .shadow(4.dp, RoundedCornerShape(999.dp))
            .clip(RoundedCornerShape(999.dp))
            .background(if (active) Brand.ink else Brand.surface)
            .then(if (active) Modifier.border(2.dp, Brand.gold, RoundedCornerShape(999.dp)) else Modifier)
            .clickable(onClickLabel = "Read reviews of ${location.title}", onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 5.dp)
            .semantics(mergeDescendants = true) {
                contentDescription = "${location.title}, " + (rating?.let { "rated %.1f".format(it) } ?: "no rating yet")
            },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        if (active) Icon(Icons.Filled.Star, contentDescription = null, tint = Brand.gold, modifier = Modifier.size(12.dp))
        Text(
            label,
            color = if (active) Color.White else if (rating == null) Brand.muted else ratingColor(rating),
            fontWeight = FontWeight.Bold, fontSize = 13.sp,
        )
    }
}

@Composable
private fun Bubble(count: Int, partial: Boolean, x: Float, y: Float, onClick: () -> Unit) {
    val size = when {
        count < 10 -> 40.dp
        count < 100 -> 48.dp
        count < 1000 -> 56.dp
        else -> 64.dp
    }
    Box(
        Modifier.at(x, y, bottom = false).shadow(6.dp, CircleShape).size(size).clip(CircleShape).background(Brand.gold)
            .border(3.dp, Brand.surface, CircleShape)
            .clickable(onClickLabel = "Zoom in", onClick = onClick)
            .semantics { contentDescription = "${if (partial) "At least " else ""}$count places" },
        contentAlignment = Alignment.Center,
    ) {
        Text(shortCount(count) + if (partial) "+" else "", fontWeight = FontWeight.ExtraBold, color = Brand.ink, fontSize = 13.sp)
    }
}

/** The searched building: its name above a large red pin. */
@Composable
private fun SearchedMarker(name: String, x: Float, y: Float) {
    Column(Modifier.at(x, y, bottom = true), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            name, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 14.sp, maxLines = 1,
            modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(Brand.searched)
                .padding(horizontal = 12.dp, vertical = 5.dp),
        )
        Icon(Icons.Filled.Place, contentDescription = "Searched place: $name", tint = Brand.searched,
            modifier = Modifier.size(44.dp))
    }
}

/** A pin the visitor drags onto a building: a labelled flag on a stem. */
@Composable
private fun DraggablePin(label: String, description: String, x: Float, y: Float, onMove: (Float, Float) -> Unit) {
    val position by rememberUpdatedState(x to y)
    val move by rememberUpdatedState(onMove)
    Column(
        Modifier.at(x, y, bottom = true)
            .pointerInput(Unit) {
                detectDragGestures { change, drag ->
                    change.consume()
                    move(position.first + drag.x, position.second + drag.y)
                }
            }
            .semantics(mergeDescendants = true) { contentDescription = description },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            label, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 13.sp, maxLines = 1,
            modifier = Modifier.shadow(6.dp, RoundedCornerShape(16.dp)).clip(RoundedCornerShape(16.dp))
                .background(Brand.ink).border(2.dp, Brand.gold, RoundedCornerShape(16.dp))
                .padding(horizontal = 14.dp, vertical = 8.dp),
        )
        Box(Modifier.width(3.dp).height(22.dp).background(Brand.ink))
        Box(Modifier.size(10.dp).clip(CircleShape).background(Brand.ink))
    }
}
