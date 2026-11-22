package com.boringman.rentalreview.search

import com.boringman.rentalreview.data.json
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request

private suspend fun getText(http: OkHttpClient, url: String): String = withContext(Dispatchers.IO) {
    http.newCall(Request.Builder().url(url).header("User-Agent", USER_AGENT).build()).execute().use {
        if (!it.isSuccessful) throw IllegalStateException("Place search failed (${it.code}).")
        it.body.string()
    }
}

/** Identifies the app to free services (OpenStreetMap's usage policy asks for it). */
const val USER_AGENT = "RentalReview-Android/1.0"

// ---------- Ola Maps Places ----------

@Serializable
private data class OlaResponse(val predictions: List<OlaPrediction> = emptyList())

@Serializable
private data class OlaPrediction(
    val description: String,
    val place_id: String,
    val types: List<String> = emptyList(),
    val structured_formatting: OlaFormatting? = null,
    val geometry: OlaGeometry? = null,
)

@Serializable
private data class OlaFormatting(val main_text: String? = null, val secondary_text: String? = null)

@Serializable
private data class OlaGeometry(val location: OlaLatLng? = null)

@Serializable
private data class OlaLatLng(val lat: Double, val lng: Double)

@Serializable
private data class OlaDetails(val result: OlaDetailsResult? = null)

@Serializable
private data class OlaDetailsResult(val geometry: OlaGeometry? = null)

/** Ola Maps Places Autocomplete; Details only when a result lacks its location. */
class OlaSearch(private val apiKey: String, private val http: OkHttpClient) : PlaceSearch {
    override val attribution = "Search by Ola Maps"

    override suspend fun search(text: String, near: Point?): List<Suggestion> {
        val url = "$API/autocomplete".toHttpUrl().newBuilder()
            .addQueryParameter("input", text)
            .addQueryParameter("language", "en")
            .addQueryParameter("api_key", apiKey)
            .apply { near?.let { addQueryParameter("location", "%.4f,%.4f".format(it.latitude, it.longitude)) } }
            .build().toString()
        return parse(getText(http, url))
    }

    private fun parse(body: String): List<Suggestion> =
        json.decodeFromString(OlaResponse.serializer(), body).predictions.take(8).map { p ->
            val exact = !isAreaType(p.types)
            val name = p.structured_formatting?.main_text ?: p.description
            val detail = p.structured_formatting?.secondary_text
            Suggestion(name, detail, if (exact) Suggestion.Kind.BUILDING else Suggestion.Kind.AREA) {
                val at = p.geometry?.location ?: details(p.place_id)
                    ?: throw IllegalStateException("The place has no location.")
                Area(
                    name, detail, Point(at.lat, at.lng),
                    zoom = if (exact) 18.0 else if (isCityType(p.types)) 12.0 else 15.0,
                    exact = exact,
                )
            }
        }

    private suspend fun details(placeId: String): OlaLatLng? {
        val url = "$API/details".toHttpUrl().newBuilder()
            .addQueryParameter("place_id", placeId)
            .addQueryParameter("api_key", apiKey)
            .build().toString()
        return json.decodeFromString(OlaDetails.serializer(), getText(http, url)).result?.geometry?.location
    }

    private companion object {
        const val API = "https://api.olamaps.io/places/v1"
    }
}

// ---------- Photon (OpenStreetMap) ----------

@Serializable
private data class PhotonResponse(val features: List<PhotonFeature> = emptyList())

@Serializable
private data class PhotonFeature(val geometry: PhotonGeometry, val properties: PhotonProperties)

@Serializable
private data class PhotonGeometry(val coordinates: List<Double>)

@Serializable
private data class PhotonProperties(
    val name: String? = null,
    val type: String? = null,
    val city: String? = null,
    val county: String? = null,
    val state: String? = null,
    val countrycode: String? = null,
    val osm_key: String? = null,
    val osm_value: String? = null,
    val extent: List<Double>? = null,
)

/** Photon, an OpenStreetMap geocoder: localities and mapped housing complexes. */
class PhotonSearch(private val http: OkHttpClient) : PlaceSearch {
    override val attribution = "Search © OpenStreetMap contributors"

    override suspend fun search(text: String, near: Point?): List<Suggestion> {
        val b = Region.bounds
        val url = "https://photon.komoot.io/api/".toHttpUrl().newBuilder()
            .addQueryParameter("q", text)
            .addQueryParameter("limit", "15")
            .addQueryParameter("lang", "en")
            .addQueryParameter("bbox", "${b.west},${b.south},${b.east},${b.north}")
            .apply {
                near?.let {
                    addQueryParameter("lat", "%.4f".format(it.latitude))
                    addQueryParameter("lon", "%.4f".format(it.longitude))
                }
                listOf("locality", "district", "city").forEach { addQueryParameter("layer", it) }
            }
            .build().toString()
        return parse(getText(http, url))
    }

    private fun parse(body: String): List<Suggestion> {
        val areas = mutableListOf<Area>()
        for (f in json.decodeFromString(PhotonResponse.serializer(), body).features) {
            val p = f.properties
            val name = p.name ?: continue
            if (p.countrycode != null && p.countrycode != Region.COUNTRY_CODE) continue
            val lng = f.geometry.coordinates[0]
            val lat = f.geometry.coordinates[1]
            // OpenStreetMap often lists one locality twice, a short distance apart.
            if (areas.any { it.name.equals(name, true) &&
                    kotlin.math.abs(it.center.latitude - lat) < 0.03 &&
                    kotlin.math.abs(it.center.longitude - lng) < 0.03 }) continue
            val detail = listOfNotNull(p.city ?: p.county, p.state).filter { it != name }
                .joinToString(", ").ifEmpty { null }
            val e = p.extent
            // Apartment societies are usually mapped as named residential land.
            val building = p.type == "house" || p.osm_key == "building" ||
                (p.osm_key == "landuse" && p.osm_value == "residential")
            areas += if (building) Area(
                name, detail,
                if (e != null && e.size == 4) Point((e[1] + e[3]) / 2, (e[0] + e[2]) / 2) else Point(lat, lng),
                zoom = 17.0, exact = true,
            ) else Area(
                name, detail, Point(lat, lng),
                bounds = if (e != null && e.size == 4) Bounds(e[0], e[3], e[2], e[1]) else null,
                zoom = if (p.type == "city") 12.0 else 15.0,
            )
        }
        return areas.take(8).map { a ->
            Suggestion(a.name, a.detail, if (a.exact) Suggestion.Kind.BUILDING else Suggestion.Kind.AREA) { a }
        }
    }
}
