package com.boringman.rentalreview

import android.app.Application
import com.boringman.rentalreview.data.ApiClient
import com.boringman.rentalreview.data.RentalReviewApi
import com.boringman.rentalreview.data.SessionStore
import org.maplibre.android.MapLibre

/** Creates the app-wide services once. */
class RentalReviewApp : Application() {
    lateinit var sessions: SessionStore
        private set
    lateinit var api: RentalReviewApi
        private set

    override fun onCreate() {
        super.onCreate()
        MapLibre.getInstance(this)
        sessions = SessionStore(this)
        api = RentalReviewApi(ApiClient(sessions))
    }
}
