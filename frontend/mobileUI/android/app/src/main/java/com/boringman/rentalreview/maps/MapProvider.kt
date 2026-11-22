package com.boringman.rentalreview.maps

import com.boringman.rentalreview.data.MapConfig
import com.boringman.rentalreview.search.OlaSearch
import com.boringman.rentalreview.search.PhotonSearch
import com.boringman.rentalreview.search.PlaceSearch
import com.boringman.rentalreview.search.USER_AGENT
import okhttp3.Interceptor
import okhttp3.OkHttpClient

/**
 * One map provider (chosen by the server's MAP_PROVIDER, see GET /map/config):
 * the map style MapLibre draws, the credit it requires, and its place search.
 * The same two providers as the web app: Ola Maps and OpenStreetMap.
 */
sealed class MapProvider {
    /** A style URL, or an inline style JSON, for MapLibre. */
    abstract val styleUri: String?
    abstract val styleJson: String?
    abstract val attribution: String
    abstract fun search(http: OkHttpClient): PlaceSearch

    class Ola(private val apiKey: String) : MapProvider() {
        override val styleUri =
            "https://api.olamaps.io/tiles/vector/v1/styles/default-light-standard/style.json"
        override val styleJson: String? = null
        override val attribution = "© Ola Maps © OpenStreetMap"
        override fun search(http: OkHttpClient) = OlaSearch(apiKey, http)

        /** The style, tiles, fonts and sprites all need the key. */
        fun keyInterceptor() = Interceptor { chain ->
            val request = chain.request()
            if (request.url.host != "api.olamaps.io") return@Interceptor chain.proceed(request)
            val url = request.url.newBuilder().setQueryParameter("api_key", apiKey).build()
            chain.proceed(request.newBuilder().url(url).build())
        }
    }

    data object Osm : MapProvider() {
        override val styleUri: String? = null
        override val attribution = "© OpenStreetMap contributors"
        override fun search(http: OkHttpClient) = PhotonSearch(http)
        override val styleJson = """
            {
              "version": 8,
              "sources": {
                "osm": {
                  "type": "raster",
                  "tiles": ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
                  "tileSize": 256,
                  "maxzoom": 19,
                  "attribution": "© OpenStreetMap contributors"
                }
              },
              "layers": [{ "id": "osm", "type": "raster", "source": "osm" }]
            }
        """.trimIndent()
    }

    companion object {
        fun from(config: MapConfig): MapProvider =
            if (config.provider == "ola" && !config.api_key.isNullOrBlank()) Ola(config.api_key) else Osm

        /** Identifies the app to tile servers, as OpenStreetMap's tile policy asks. */
        val userAgentInterceptor = Interceptor { chain ->
            chain.proceed(chain.request().newBuilder().header("User-Agent", USER_AGENT).build())
        }
    }
}
