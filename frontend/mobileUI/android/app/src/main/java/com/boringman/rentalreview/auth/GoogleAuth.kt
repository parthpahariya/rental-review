package com.boringman.rentalreview.auth

import android.app.Activity
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential

/**
 * Gets a Google ID token for the backend (POST /auth/google), as the web's
 * "Continue with Google" button does. The token's audience is the site's web
 * OAuth client id, which the backend already accepts; Google Cloud also needs
 * an Android OAuth client for this app's package name and signing certificate.
 */
class GoogleAuth(private val activity: Activity) {
    private val credentials = CredentialManager.create(activity)

    /** The ID token, or null if the person closed the Google sheet. */
    suspend fun idToken(webClientId: String): String? {
        val request = GetCredentialRequest.Builder()
            .addCredentialOption(GetSignInWithGoogleOption.Builder(webClientId).build())
            .build()
        return try {
            val credential = credentials.getCredential(activity, request).credential
            if (credential is CustomCredential &&
                credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
            ) GoogleIdTokenCredential.createFrom(credential.data).idToken
            else throw IllegalStateException("Google didn't return a sign-in token.")
        } catch (_: GetCredentialCancellationException) {
            null
        }
    }

    /** Forget the chosen Google account, so the next sign-in asks again. */
    suspend fun clear() {
        runCatching { credentials.clearCredentialState(ClearCredentialStateRequest()) }
    }
}
