package com.boringman.rentalreview.ui

import android.app.Activity
import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.boringman.rentalreview.RentalReviewApp
import com.boringman.rentalreview.auth.GoogleAuth
import com.boringman.rentalreview.data.Account
import com.boringman.rentalreview.data.ApiClient
import com.boringman.rentalreview.data.ApiException
import com.boringman.rentalreview.data.Comment
import com.boringman.rentalreview.data.CommentReport
import com.boringman.rentalreview.data.Deletion
import com.boringman.rentalreview.data.Flat
import com.boringman.rentalreview.data.Interaction
import com.boringman.rentalreview.data.Location
import com.boringman.rentalreview.data.OwnFlat
import com.boringman.rentalreview.data.Review
import com.boringman.rentalreview.maps.MapProvider
import com.boringman.rentalreview.search.Area
import com.boringman.rentalreview.search.Bounds
import com.boringman.rentalreview.search.Point
import com.boringman.rentalreview.search.Region
import com.boringman.rentalreview.search.SearchService
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import org.maplibre.android.module.http.HttpRequestUtil

enum class Screen { HOME, EXPLORE, NOTEBOOK }
enum class FeedbackTab { TENANT, INTERACTION }

/** A place to move the map to; a new [key] moves it there again. */
data class Focus(val key: Int, val area: Area)

/** The visitor's own records, shown in the notebook. */
data class Notebook(
    val reviews: List<Review> = emptyList(),
    val interactions: List<Interaction> = emptyList(),
    val requests: List<Deletion> = emptyList(),
    val adminRequests: List<Deletion> = emptyList(),
    val flats: List<OwnFlat> = emptyList(),
    val comments: List<Comment> = emptyList(),
    val commentReports: List<CommentReport> = emptyList(),
)

class AppViewModel(application: Application) : AndroidViewModel(application) {
    private val app = application as RentalReviewApp
    private val api = app.api

    // ----- Account -----
    var account by mutableStateOf<Account?>(null); private set
    var signingIn by mutableStateOf(false); private set
    /** Set when a deactivated account must confirm reactivation. */
    var reactivationPending by mutableStateOf(false); private set
    private var pendingCredential: String? = null

    // ----- Navigation and feedback -----
    var screen by mutableStateOf(Screen.HOME)
    var message by mutableStateOf<String?>(null)

    // ----- Map -----
    var provider by mutableStateOf<MapProvider?>(null); private set
    var mapUnavailable by mutableStateOf(false); private set
    var area by mutableStateOf<Area?>(null); private set
    var focus by mutableStateOf<Focus?>(null); private set
    /** The searched building, marked on the map. */
    var searched by mutableStateOf<Area?>(null); private set
    var locations by mutableStateOf(emptyList<Location>()); private set
    var partial by mutableStateOf(false); private set
    var loadingPlaces by mutableStateOf(false); private set
    var mapCenter by mutableStateOf(Region.defaultCenter); private set
    private var viewportJob: Job? = null
    private var focusKey = 0

    // ----- Selected place -----
    var selected by mutableStateOf<Location?>(null); private set
    var flats by mutableStateOf(emptyList<Flat>()); private set
    var flat by mutableStateOf<Flat?>(null); private set
    var tab by mutableStateOf(FeedbackTab.TENANT)
    var reviews by mutableStateOf(emptyList<Review>()); private set
    var interactions by mutableStateOf(emptyList<Interaction>()); private set
    /** The viewer's own reviews of the selected flat, by id (for Edit). */
    var ownReviews by mutableStateOf(emptyMap<String, Review>()); private set
    var detailLoading by mutableStateOf(false); private set

    // ----- Notebook -----
    var notebook by mutableStateOf(Notebook()); private set
    var notebookLoading by mutableStateOf(false); private set

    private val http: OkHttpClient = ApiClient.defaultHttp
    val search = SearchService(
        listed = { api.searchListed(it) },
        provider = { (provider ?: MapProvider.Osm).search(http) },
    )

    init {
        viewModelScope.launch {
            runCatching { api.mapConfig() }
                .onSuccess { config -> useProvider(MapProvider.from(config)) }
                .onFailure { useProvider(MapProvider.Osm) }
        }
        if (app.sessions.token != null) viewModelScope.launch {
            account = runCatching { api.me() }.getOrNull()
        }
    }

    private fun useProvider(p: MapProvider) {
        // MapLibre fetches the style, tiles and fonts through this client.
        val client = http.newBuilder().addInterceptor(MapProvider.userAgentInterceptor).apply {
            if (p is MapProvider.Ola) addInterceptor(p.keyInterceptor())
        }.build()
        HttpRequestUtil.setOkHttpClient(client)
        provider = p
    }

    fun mapFailed() {
        mapUnavailable = true
    }

    private fun fail(e: Throwable) {
        message = (e as? ApiException)?.message ?: e.message ?: "Something went wrong. Please try again."
    }

    // ----- Areas and the map -----

    fun openArea(next: Area) {
        area = next
        searched = if (next.exact) next else null
        selected = null
        focus = Focus(++focusKey, next)
        screen = Screen.EXPLORE
    }

    fun browseAll() = openArea(Area(Region.DEFAULT_NAME, center = Region.defaultCenter, zoom = 12.0))

    fun goHome() {
        screen = Screen.HOME
        selected = null
    }

    /** The visible map area changed: load its places after the camera settles. */
    fun onViewport(bounds: Bounds, center: Point) {
        mapCenter = center
        viewportJob?.cancel()
        viewportJob = viewModelScope.launch {
            delay(250)
            loadingPlaces = true
            runCatching { api.locationsIn(bounds.west, bounds.south, bounds.east, bounds.north) }
                .onSuccess { (rows, more) -> locations = rows; partial = more }
                .onFailure { if (it !is kotlinx.coroutines.CancellationException) fail(it) }
            loadingPlaces = false
        }
    }

    /** Places in view, nearest to the map centre first. */
    fun nearestFirst(): List<Location> = locations.sortedBy {
        val dLat = it.latitude - mapCenter.latitude
        val dLng = (it.longitude - mapCenter.longitude) * Math.cos(Math.toRadians(mapCenter.latitude))
        dLat * dLat + dLng * dLng
    }

    // ----- A place, its flats and their reviews -----

    fun select(location: Location, flatId: String? = null, tab: FeedbackTab? = null) {
        selected = location
        flats = emptyList()
        flat = null
        tab?.let { this.tab = it }
        viewModelScope.launch {
            detailLoading = true
            runCatching { api.flats(location.id) }
                .onSuccess { list ->
                    flats = list
                    (list.firstOrNull { it.id == flatId } ?: list.firstOrNull())?.let { loadFlat(it) }
                }
                .onFailure(::fail)
            detailLoading = false
        }
    }

    fun closePlace() {
        selected = null
    }

    fun chooseFlat(next: Flat) = viewModelScope.launch { loadFlat(next) }

    private suspend fun loadFlat(next: Flat) {
        flat = next
        detailLoading = true
        runCatching {
            reviews = api.tenantReviews(next.id)
            interactions = api.interactions(next.id)
            ownReviews = if (account != null) api.ownReviews(next.id).associateBy { it.id } else emptyMap()
        }.onFailure(::fail)
        detailLoading = false
    }

    private suspend fun refreshPlace() {
        flat?.let { loadFlat(it) }
        selected?.let { s -> runCatching { api.location(s.id) }.onSuccess { selected = it } }
        locations = locations.map { l -> if (l.id == selected?.id) selected!! else l }
    }

    // ----- Writing -----

    /** Runs [action], reporting failure; returns whether it succeeded. */
    private suspend fun attempt(action: suspend () -> Unit): Boolean =
        runCatching { action() }.onFailure(::fail).isSuccess

    suspend fun postReview(rating: Int, feedback: String, start: String, end: String): Boolean = attempt {
        api.postReview(flat!!.id, rating, feedback, start, end)
        message = "Thanks for sharing. Your experience is now public."
        refreshPlace()
    }

    suspend fun editReview(review: Review, rating: Int, feedback: String): Boolean = attempt {
        api.editReview(review.id, rating, feedback)
        message = "Your review was updated."
        refreshPlace()
        if (screen == Screen.NOTEBOOK) loadNotebook()
    }

    suspend fun postInteraction(description: String, date: String): Boolean = attempt {
        api.postInteraction(flat!!.id, description, date)
        message = "Thanks for sharing. Your interaction is now public."
        refreshPlace()
    }

    suspend fun addFlat(label: String): Boolean = attempt {
        val created = api.addFlat(selected!!.id, label)
        flats = api.flats(selected!!.id)
        loadFlat(flats.firstOrNull { it.id == created.id } ?: created)
        message = "Flat ${created.label} added. You can review it now."
    }

    suspend fun addPlace(address: String, buildingName: String?, at: Point, flatLabel: String): Boolean = attempt {
        val created = api.addPlace(address, buildingName, at.latitude, at.longitude, flatLabel)
        message = "Added. Share your experience of flat ${created.label}."
        select(created.location, created.id)
    }

    suspend fun requestDeletion(review: Review, reason: String): Boolean = attempt {
        api.requestDeletion(review.id, reason)
        message = "Deletion requested. An admin will decide."
        loadNotebook()
    }

    fun decide(request: Deletion, approve: Boolean) = viewModelScope.launch {
        if (attempt { api.decide(request.id, approve) }) loadNotebook()
    }

    // Discussions under a review or interaction (see ui/Discussion.kt).

    /** The discussion's comments, oldest first, or null when it could not load. */
    suspend fun comments(onReview: Boolean, subjectId: String): List<Comment>? =
        runCatching { api.comments(onReview, subjectId) }.onFailure(::fail).getOrNull()

    suspend fun postComment(onReview: Boolean, subjectId: String, body: String) =
        attempt { api.postComment(onReview, subjectId, body) }

    suspend fun editComment(comment: Comment, body: String) = attempt { api.editComment(comment.id, body) }

    suspend fun deleteComment(comment: Comment) = attempt { api.deleteComment(comment.id) }

    suspend fun reportComment(comment: Comment, reason: String) = attempt {
        api.reportComment(comment.id, reason)
        message = "Thanks. An admin will review this comment."
    }

    /** Deletes one of the visitor's comments from the notebook. */
    fun deleteOwnComment(comment: Comment) = viewModelScope.launch {
        if (deleteComment(comment)) loadNotebook()
    }

    fun decideReport(report: CommentReport, remove: Boolean) = viewModelScope.launch {
        if (attempt { api.decideReport(report.id, remove) }) loadNotebook()
    }

    suspend fun setName(name: String?): Boolean = attempt { account = api.setName(name) }

    // ----- Signing in and out -----

    fun signIn(activity: Activity) = viewModelScope.launch {
        signingIn = true
        try {
            val clientId = api.authProviders().google_client_id
            if (clientId == null) {
                message = "Google sign-in isn’t available right now. Please try again later."
                return@launch
            }
            val token = GoogleAuth(activity).idToken(clientId) ?: return@launch
            finishSignIn(token, reactivate = false)
        } catch (e: Exception) {
            fail(e)
        } finally {
            signingIn = false
        }
    }

    private suspend fun finishSignIn(credential: String, reactivate: Boolean) {
        val result = api.signInWithGoogle(credential, reactivate)
        if (result.outcome == "reactivation_required") {
            pendingCredential = credential
            reactivationPending = true
            return
        }
        app.sessions.token = result.session?.token
        account = result.account
        reactivationPending = false
        pendingCredential = null
        message = if (result.outcome == "reactivated") "Welcome back. Your account is active again."
        else "You’re signed in."
        flat?.let { loadFlat(it) }
    }

    fun confirmReactivation(confirm: Boolean) = viewModelScope.launch {
        val credential = pendingCredential
        reactivationPending = false
        pendingCredential = null
        if (confirm && credential != null) attempt { finishSignIn(credential, reactivate = true) }
    }

    fun signOut(activity: Activity) = viewModelScope.launch {
        runCatching { api.signOut() }
        GoogleAuth(activity).clear()
        app.sessions.token = null
        account = null
        ownReviews = emptyMap()
        notebook = Notebook()
        if (screen == Screen.NOTEBOOK) screen = Screen.HOME
        message = "You’re signed out."
    }

    fun deactivate(activity: Activity) = viewModelScope.launch {
        if (attempt { api.deactivate() }) {
            GoogleAuth(activity).clear()
            app.sessions.token = null
            account = null
            notebook = Notebook()
            screen = Screen.HOME
            message = "Your account is deactivated. Your reviews stay public."
        }
    }

    // ----- Notebook -----

    fun openNotebook() {
        screen = Screen.NOTEBOOK
        viewModelScope.launch { loadNotebook() }
    }

    suspend fun loadNotebook() {
        notebookLoading = true
        attempt {
            notebook = Notebook(
                reviews = api.ownReviews(),
                interactions = api.ownInteractions(),
                requests = api.ownDeletionRequests(),
                adminRequests = if (account?.isAdmin == true) api.pendingDeletionRequests() else emptyList(),
                flats = api.ownFlats(),
                comments = api.ownComments().filter { it.deleted_at == null },
                commentReports = if (account?.isAdmin == true) api.pendingCommentReports() else emptyList(),
            )
        }
        notebookLoading = false
    }

    /** Opens one of the visitor's own records on the map. */
    fun openOwn(locationId: String, flatId: String, tab: FeedbackTab) = viewModelScope.launch {
        attempt {
            val location = api.location(locationId)
            openArea(Area(location.title, location.address, Point(location.latitude, location.longitude), zoom = 17.0))
            select(location, flatId, tab)
        }
    }
}
