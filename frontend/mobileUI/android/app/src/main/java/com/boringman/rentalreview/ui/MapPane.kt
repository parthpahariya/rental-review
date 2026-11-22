package com.boringman.rentalreview.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Place
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.boringman.rentalreview.data.Location
import com.boringman.rentalreview.maps.MAX_ZOOM
import com.boringman.rentalreview.maps.MapProvider
import com.boringman.rentalreview.maps.Marker
import com.boringman.rentalreview.maps.cluster
import com.boringman.rentalreview.maps.clusterRadius
import com.boringman.rentalreview.maps.pinLabel
import com.boringman.rentalreview.maps.shortCount
import com.boringman.rentalreview.search.Bounds
import com.boringman.rentalreview.search.Point
import com.boringman.rentalreview.search.Region
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import kotlin.math.roundToInt

/**
 * The map: the provider's style drawn by MapLibre, with rating pins, bubbles
 * and the searched-place marker drawn on top as Compose views (the same pills
 * as the web app, on any provider). In [addMode] a crosshair marks the spot a
 * new place will be added at.
 */
@Composable
fun MapPane(vm: AppViewModel, provider: MapProvider, addMode: Boolean, onCenter: (Point) -> Unit) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val mapView = remember { MapView(context).apply { onCreate(null) } }
    var map by remember { mutableStateOf<MapLibreMap?>(null) }
    // Bumped on every camera move so the overlay re-projects the pins.
    var cameraTick by remember { mutableIntStateOf(0) }
    val density = LocalDensity.current

    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> mapView.onStart()
                Lifecycle.Event.ON_RESUME -> mapView.onResume()
                Lifecycle.Event.ON_PAUSE -> mapView.onPause()
                Lifecycle.Event.ON_STOP -> mapView.onStop()
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        onDispose {
            lifecycle.removeObserver(observer)
            mapView.onPause()
            mapView.onStop()
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
                .target(LatLng(Region.defaultCenter.latitude, Region.defaultCenter.longitude)).zoom(12.0).build()
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
                val target = m.cameraPosition.target ?: return@addOnCameraIdleListener
                val r = m.projection.visibleRegion.latLngBounds
                val center = Point(target.latitude, target.longitude)
                onCenter(center)
                vm.onViewport(
                    Bounds(
                        west = r.longitudeWest.coerceIn(-180.0, 180.0),
                        south = r.latitudeSouth.coerceIn(-90.0, 90.0),
                        east = r.longitudeEast.coerceIn(-180.0, 180.0),
                        north = r.latitudeNorth.coerceIn(-90.0, 90.0),
                    ),
                    center,
                )
            }
        }
    }

    // Move the map when an area or building is chosen.
    LaunchedEffect(map, vm.focus?.key) {
        val m = map ?: return@LaunchedEffect
        val area = vm.focus?.area ?: return@LaunchedEffect
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

    Box(Modifier.fillMaxSize()) {
        AndroidView(factory = { mapView }, modifier = Modifier.fillMaxSize())

        val m = map
        if (m != null) {
            @Suppress("UNUSED_EXPRESSION") cameraTick // re-read on every camera move
            val zoom = m.cameraPosition.zoom
            val radiusPx = with(density) { clusterRadius(zoom).dp.toPx() }
            val markers = cluster(vm.locations, zoom, radiusPx) { l ->
                val p = m.projection.toScreenLocation(LatLng(l.latitude, l.longitude))
                if (p.x < -50 || p.y < -50 || p.x > mapView.width + 50 || p.y > mapView.height + 50) null
                else p.x to p.y
            }
            markers.forEach { marker ->
                when (marker) {
                    is Marker.Pin -> RatingPin(marker.location, marker.location.id == vm.selected?.id, marker.x, marker.y) {
                        vm.select(marker.location)
                    }
                    is Marker.Bubble -> Bubble(marker.locations.size, vm.partial, marker.x, marker.y) {
                        zoomInto(m, marker.locations, density.density)
                    }
                }
            }
            vm.searched?.let { s ->
                val p = m.projection.toScreenLocation(LatLng(s.center.latitude, s.center.longitude))
                SearchedMarker(s.name, p.x, p.y)
            }
        }

        if (addMode) {
            Icon(
                Icons.Filled.Add, contentDescription = "New place goes here",
                tint = Brand.searched, modifier = Modifier.align(Alignment.Center).size(44.dp),
            )
        }
        if (vm.mapUnavailable) {
            Text(
                "The map isn’t available right now. The list shows the same places.",
                color = Brand.muted,
                modifier = Modifier.align(Alignment.Center).background(Brand.surface, RoundedCornerShape(12.dp)).padding(14.dp),
            )
        }
        Text(
            provider.attribution, fontSize = 10.sp, color = Brand.ink,
            modifier = Modifier.align(Alignment.BottomEnd).background(Color(0xCCFFFFFF)).padding(horizontal = 6.dp, vertical = 2.dp),
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

@Composable
private fun RatingPin(location: Location, active: Boolean, x: Float, y: Float, onClick: () -> Unit) {
    val label = pinLabel(location.summary?.average_rating)
    Text(
        label,
        color = if (active) Brand.ink else Color.White,
        fontWeight = FontWeight.Bold, fontSize = 14.sp,
        modifier = Modifier.at(x, y, bottom = true)
            .clip(RoundedCornerShape(999.dp))
            .background(if (active) Brand.gold else Brand.ink)
            .border(2.dp, Brand.ink, RoundedCornerShape(999.dp))
            .clickable(onClickLabel = "Read reviews of ${location.title}", onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp)
            .semantics { contentDescription = "${location.title}, $label" },
    )
}

@Composable
private fun Bubble(count: Int, partial: Boolean, x: Float, y: Float, onClick: () -> Unit) {
    val size = when {
        count < 10 -> 44.dp
        count < 100 -> 52.dp
        count < 1000 -> 60.dp
        else -> 68.dp
    }
    Box(
        Modifier.at(x, y, bottom = false).size(size).clip(CircleShape).background(Brand.gold)
            .border(3.dp, Brand.ink, CircleShape)
            .clickable(onClickLabel = "Zoom in", onClick = onClick)
            .semantics { contentDescription = "${if (partial) "At least " else ""}$count places" },
        contentAlignment = Alignment.Center,
    ) {
        Text(shortCount(count) + if (partial) "+" else "", fontWeight = FontWeight.ExtraBold, color = Brand.ink, fontSize = 16.sp)
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
