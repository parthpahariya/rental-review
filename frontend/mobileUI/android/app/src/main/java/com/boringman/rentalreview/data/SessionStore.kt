package com.boringman.rentalreview.data

import android.content.Context

/** Where the sign-in session token lives. */
interface TokenStore {
    var token: String?
}

/**
 * The sign-in session token, kept in the app's private storage (no other app
 * can read it). Sessions expire on the server after 7 days.
 */
class SessionStore(context: Context) : TokenStore {
    private val prefs = context.getSharedPreferences("session", Context.MODE_PRIVATE)

    override var token: String?
        get() = prefs.getString(KEY, null)
        set(value) {
            prefs.edit().apply { if (value == null) remove(KEY) else putString(KEY, value) }.apply()
        }

    private companion object {
        const val KEY = "token"
    }
}
