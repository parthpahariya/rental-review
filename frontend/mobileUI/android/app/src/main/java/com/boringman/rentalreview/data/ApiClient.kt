package com.boringman.rentalreview.data

import com.boringman.rentalreview.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/** An error the API returned, with its machine code and a message to show. */
class ApiException(val status: Int, val code: String, message: String) : Exception(message)

val json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = true
}

/**
 * Talks to /api/v1 with the signed-in session, if any. Transport only: what
 * each endpoint means lives in [RentalReviewApi].
 */
class ApiClient(
    private val sessions: TokenStore,
    private val baseUrl: String = BuildConfig.API_BASE_URL,
    val http: OkHttpClient = defaultHttp,
) {
    suspend fun <T> send(
        method: String,
        path: String,
        body: JsonElement? = null,
        serializer: KSerializer<T>?,
    ): T? = withContext(Dispatchers.IO) {
        val builder = Request.Builder().url("$baseUrl/api/v1$path")
        sessions.token?.let { builder.header("Authorization", "Bearer $it") }
        val payload = body?.toString()?.toRequestBody(JSON)
        builder.method(method, payload ?: if (method in BODY_METHODS) EMPTY else null)
        http.newCall(builder.build()).execute().use { response ->
            val text = response.body.string()
            if (!response.isSuccessful) {
                if (response.code == 401) sessions.token = null
                throw parseError(response.code, text)
            }
            if (serializer == null || text.isBlank()) null
            else json.decodeFromString(serializer, text)
        }
    }

    private fun parseError(status: Int, text: String): ApiException = try {
        val detail = json.decodeFromString(ApiErrorBody.serializer(), text).error
        val fieldMessage = detail.fields.firstOrNull()?.message
        ApiException(status, detail.code, fieldMessage?.let { "${detail.message} $it" } ?: detail.message)
    } catch (_: Exception) {
        ApiException(status, "HTTP_$status", "Something went wrong. Please try again.")
    }

    companion object {
        private val JSON = "application/json".toMediaType()
        private val EMPTY = ByteArray(0).toRequestBody(null)
        private val BODY_METHODS = setOf("POST", "PATCH", "PUT")
        val defaultHttp: OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .build()
    }
}
