package com.boringman.rentalreview.ui

import android.app.Activity
import android.app.Application
import android.content.Context
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
import com.boringman.rentalreview.data.Permissions
import com.boringman.rentalreview.data.Review
import com.boringman.rentalreview.maps.MapProvider
import com.boringman.rentalreview.search.Area
import com.boringman.rentalreview.search.Areas
import com.boringman.rentalreview.search.Bounds
import com.boringman.rentalreview.search.Point
import com.boringman.rentalreview.search.Region
import com.boringman.rentalreview.search.ReviewedArea
import com.boringman.rentalreview.search.SearchService
import com.boringman.rentalreview.search.approximateBounds
import com.boringman.rentalreview.search.distanceMeters
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import org.maplibre.android.module.http.HttpRequestUtil

/** The bottom navigation's tabs. */
enum class Tab { EXPLORE, ADD, NOTEBOOK }
enum class FeedbackTab { TENANT, INTERACTION }

/**
 * What the one shared map is showing. [HIDDEN] keeps the map (once created) but
 * stops drawing it; screens without a map never create it (see MapLayer).
 */
enum class MapMode { HIDDEN, RESULTS, ADD_PLACE, MOVE_PIN }

enum class SortOrder(val label: String) {
    NEAREST("Nearest"), RATING("Highest rated"), REVIEWED("Most reviewed")
}

/** What to do once the visitor has signed in. */
enum class Pending { NONE, REVIEW, INTERACTION, ADD_FLAT, ADD_PLACE, NOTEBOOK }

/** The review / interaction form: a new one for the selected flat, or an edit. */
data class Form(val kind: FeedbackTab, val editing: Review? = null)

/** "Edit what you added": the fields as the visitor is changing them. */
data class PlaceDraft(val name: String, val address: String, val flatLabel: String)

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
    private val prefs = application.getSharedPreferences("ui", Context.MODE_PRIVATE)

    // ----- Account -----
    var account by mutableStateOf<Account?>(null); private set
    var signingIn by mutableStateOf(false); private set
    /** Set when a deactivated account must confirm reactivation. */
    var reactivationPending by mutableStateOf(false); private set
    private var pendingCredential: String? = null
    /** The sign-in sheet is open, to then do this. */
    var signInFor by mutableStateOf<Pending?>(null); private set
    private var afterSignIn = Pending.NONE

    // ----- Navigation and feedback -----
    var tab by mutableStateOf(Tab.EXPLORE); private set
    /** Explore shows the map and results instead of the home page. */
    var resultsOpen by mutableStateOf(false); private set
    private var addReturnTab = Tab.EXPLORE
    var message by mutableStateOf<String?>(null)

    // ----- The map (one per session; see MapLayer) -----
    var provider by mutableStateOf<MapProvider?>(null); private set
    var mapUnavailable by mutableStateOf(false); private set
    /** Results without the map at all; remembered across launches. */
    var listOnly by mutableStateOf(prefs.getBoolean(KEY_LIST_ONLY, false)); private set
    /** Latched once the visitor first asks for the map; until then no map exists. */
    var mapStarted by mutableStateOf(false); private set
    var area by mutableStateOf<Area?>(null); private set
    var focus by mutableStateOf<Focus?>(null); private set
    /** The last focus the map has moved to. */
    var appliedFocus = 0
    /** The searched building, marked on the map. */
    var searched by mutableStateOf<Area?>(null); private set
    var locations by mutableStateOf(emptyList<Location>()); private set
    var partial by mutableStateOf(false); private set
    var loadingPlaces by mutableStateOf(false); private set
    var mapCenter by mutableStateOf(Region.defaultCenter); private set
    var mapZoom = 12.0; private set
    private var viewportJob: Job? = null
    private var focusKey = 0

    // ----- Results list -----
    var sort by mutableStateOf(SortOrder.NEAREST)
    var onlyReviewed by mutableStateOf(false)
    var onlyFourUp by mutableStateOf(false)
    var onlyInteractions by mutableStateOf(false)
    /** The place last opened from the results, highlighted in the list. */
    var lastViewedId by mutableStateOf<String?>(null); private set

    // ----- Home -----
    var areas by mutableStateOf(emptyList<ReviewedArea>()); private set
    var areasLoading by mutableStateOf(true); private set

    // ----- Adding a place -----
    var draftPin by mutableStateOf<Point?>(null); private set
    var nearby by mutableStateOf(emptyList<Location>()); private set
    private var nearbyJob: Job? = null

    // ----- Selected place -----
    var selected by mutableStateOf<Location?>(null); private set
    var flats by mutableStateOf(emptyList<Flat>()); private set
    var flat by mutableStateOf<Flat?>(null); private set
    var feedbackTab by mutableStateOf(FeedbackTab.TENANT)
    var reviews by mutableStateOf(emptyList<Review>()); private set
    var interactions by mutableStateOf(emptyList<Interaction>()); private set
    /** The viewer's own reviews of the selected flat, by id (for Edit). */
    var ownReviews by mutableStateOf(emptyMap<String, Review>()); private set
    var permissions by mutableStateOf<Permissions?>(null); private set
    var detailLoading by mutableStateOf(false); private set
    /** A review or interaction opened on its own page: (is it a review, its id). */
    var post by mutableStateOf<Pair<Boolean, String>?>(null)
    var form by mutableStateOf<Form?>(null)
    var addingFlat by mutableStateOf(false)
    var editDraft by mutableStateOf<PlaceDraft?>(null)
    /** Moving the selected place's pin on the map. */
    var movePin by mutableStateOf<Point?>(null); private set

    // ----- Notebook -----
    var notebook by mutableStateOf(Notebook()); private set
    var notebookLoading by mutableStateOf(false); private set

    private val http: OkHttpClient = ApiClient.defaultHttp
    val search = SearchService(
        listed = { api.searchListed(it) },
        provider = { (provider ?: MapProvider.Osm).search(http) },
    )

    init {
        // Only which provider to use: no style or tiles are fetched until a map is shown.
        viewModelScope.launch {
            runCatching { api.mapConfig() }
                .onSuccess { config -> useProvider(MapProvider.from(config)) }
                .onFailure { useProvider(MapProvider.Osm) }
        }
        if (app.sessions.token != null) viewModelScope.launch {
            account = runCatching { api.me() }.getOrNull()
        }
        loadAreas()
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

    /** The error to show for a failed request; a lapsed session also signs out. */
    private fun errorText(e: Throwable): String {
        if (e is ApiException && e.status == 401 && account != null) {
            account = null
            ownReviews = emptyMap()
            permissions = null
            return "Your session has ended. Please sign in again."
        }
        return (e as? ApiException)?.message ?: e.message ?: "Something went wrong. Please try again."
    }

    private fun fail(e: Throwable) {
        if (e is CancellationException) return
        message = errorText(e)
    }

    // ----- Navigation -----

    /** What the map shows now; screens drawn over it hide it. */
    val mapMode: MapMode
        get() = when {
            movePin != null -> MapMode.MOVE_PIN
            selected != null || form != null -> MapMode.HIDDEN
            tab == Tab.ADD -> MapMode.ADD_PLACE
            tab == Tab.EXPLORE && resultsOpen && !listOnly -> MapMode.RESULTS
            else -> MapMode.HIDDEN
        }

    fun markMapStarted() {
        if (!mapStarted) mapStarted = true
    }

    /** Full-screen pages (results, place, forms, adding) hide the bottom bar. */
    val showsBottomBar: Boolean
        get() = selected == null && form == null && movePin == null && editDraft == null &&
            tab != Tab.ADD && !(tab == Tab.EXPLORE && resultsOpen)

    fun selectTab(next: Tab) {
        when (next) {
            Tab.EXPLORE -> {
                if (tab == Tab.EXPLORE) resultsOpen = false
                tab = Tab.EXPLORE
            }
            Tab.ADD -> requireSignIn(Pending.ADD_PLACE)
            Tab.NOTEBOOK -> {
                tab = Tab.NOTEBOOK
                if (account == null) signInFor = Pending.NOTEBOOK else openNotebook()
            }
        }
    }

    val canGoBack: Boolean
        get() = signInFor != null || form != null || movePin != null || editDraft != null || post != null ||
            selected != null || tab != Tab.EXPLORE || resultsOpen

    /** The system back button: closes the topmost page. */
    fun back() {
        when {
            signInFor != null -> signInFor = null
            form != null -> form = null
            movePin != null -> movePin = null
            editDraft != null -> editDraft = null
            post != null -> post = null
            selected != null -> closePlace()
            tab == Tab.ADD -> closeAddPlace()
            tab == Tab.NOTEBOOK -> tab = Tab.EXPLORE
            resultsOpen -> resultsOpen = false
        }
    }

    fun goHome() {
        tab = Tab.EXPLORE
        resultsOpen = false
    }

    // ----- Home: areas with reviews -----

    fun loadAreas() = viewModelScope.launch {
        areasLoading = true
        runCatching { Areas.from(api.reviewedLocations()) }.onSuccess { areas = it }
        areasLoading = false
    }

    // ----- Areas and the map -----

    /** Opens the results on an area: on the map, or as a list when the map is off. */
    fun openArea(next: Area) {
        area = next
        searched = if (next.exact) next else null
        mapCenter = next.center
        mapZoom = next.zoom
        focus = Focus(++focusKey, next)
        tab = Tab.EXPLORE
        resultsOpen = true
        if (listOnly) loadAround(next)
    }

    /** "Open the map": the visitor asked for the map itself. */
    fun openMap() {
        if (listOnly) useListOnly(false)
        val current = area
        if (current != null) openArea(current)
        else openArea(Area(Region.DEFAULT_NAME, center = Region.defaultCenter, zoom = 12.0))
    }

    fun useListOnly(value: Boolean) {
        listOnly = value
        prefs.edit().putBoolean(KEY_LIST_ONLY, value).apply()
        if (value && locations.isEmpty()) area?.let(::loadAround)
    }

    /** Moves the map without changing the area being explored. */
    private fun moveCamera(to: Area) {
        mapCenter = to.center
        focus = Focus(++focusKey, to)
    }

    /** The visible map area changed: load its places after the camera settles. */
    fun onViewport(bounds: Bounds, center: Point, zoom: Double) {
        mapCenter = center
        mapZoom = zoom
        load(bounds)
    }

    /** Places around an area, for the list when no map is shown. */
    private fun loadAround(target: Area) {
        load(target.bounds ?: approximateBounds(target.center, target.zoom))
    }

    private fun load(bounds: Bounds) {
        viewportJob?.cancel()
        viewportJob = viewModelScope.launch {
            delay(250)
            loadingPlaces = true
            runCatching { api.locationsIn(bounds.west, bounds.south, bounds.east, bounds.north) }
                .onSuccess { (rows, more) -> locations = rows; partial = more }
                .onFailure(::fail)
            loadingPlaces = false
        }
    }

    fun distanceTo(location: Location) = distanceMeters(mapCenter, Point(location.latitude, location.longitude))

    /** The results list: filtered, then sorted as chosen. */
    fun visiblePlaces(): List<Location> {
        val filtered = locations.filter { l ->
            val s = l.summary
            (!onlyReviewed || (s?.tenant_review_count ?: 0) > 0) &&
                (!onlyFourUp || (s?.average_rating ?: 0.0) >= 4.0) &&
                (!onlyInteractions || (s?.interaction_review_count ?: 0) > 0)
        }
        return when (sort) {
            SortOrder.NEAREST -> filtered.sortedBy(::distanceTo)
            SortOrder.RATING -> filtered.sortedWith(
                compareByDescending<Location> { it.summary?.average_rating ?: -1.0 }.thenBy(::distanceTo),
            )
            SortOrder.REVIEWED -> filtered.sortedWith(
                compareByDescending<Location> { (it.summary?.tenant_review_count ?: 0) + (it.summary?.interaction_review_count ?: 0) }
                    .thenBy(::distanceTo),
            )
        }
    }

    // ----- Adding a place (on the same map as the results) -----

    private fun openAddPlace() {
        if (tab != Tab.ADD) addReturnTab = tab
        tab = Tab.ADD
        nearby = emptyList()
        // Close enough to tell buildings apart.
        if (mapZoom < 16) {
            mapZoom = 17.0
            moveCamera(Area("Add a place", center = mapCenter, zoom = 17.0))
        }
        moveDraft(mapCenter)
    }

    /** From the results' "+": come back to them on cancel. */
    fun startAddPlace() = requireSignIn(Pending.ADD_PLACE)

    fun closeAddPlace() {
        tab = addReturnTab
        draftPin = null
        nearby = emptyList()
    }

    /** The draft "+ New" pin moved: look for places already within 100 m of it. */
    fun moveDraft(at: Point) {
        draftPin = at
        nearbyJob?.cancel()
        nearbyJob = viewModelScope.launch {
            delay(400)
            val d = 0.0012 // about 130 m
            runCatching { api.locationsAround(at.longitude - d, at.latitude - d, at.longitude + d, at.latitude + d) }
                .onSuccess { rows ->
                    nearby = rows.filter { distanceMeters(at, Point(it.latitude, it.longitude)) <= 100.0 }
                        .sortedBy { distanceMeters(at, Point(it.latitude, it.longitude)) }
                }
        }
    }

    /** Adds the building at the draft pin, then opens the review form for its flat. */
    suspend fun addPlace(address: String, buildingName: String?, flatLabel: String): String? {
        val at = draftPin ?: return "Put the pin on the building first."
        return write {
            val created = api.addPlace(address, buildingName, at.latitude, at.longitude, flatLabel)
            draftPin = null
            nearby = emptyList()
            tab = Tab.EXPLORE
            resultsOpen = true
            area = Area(created.location.title, created.location.address, at, zoom = 17.0)
            moveCamera(Area(created.location.title, center = at, zoom = 17.0))
            if (listOnly) loadAround(area!!)
            loadPlace(created.location, created.id)
            lastViewedId = created.location.id
            message = "Added. Share your experience of flat ${created.label}."
            form = Form(FeedbackTab.TENANT)
        }
    }

    // ----- A place, its flats and their reviews -----

    fun select(location: Location, flatId: String? = null, tab: FeedbackTab? = null) {
        tab?.let { feedbackTab = it }
        lastViewedId = location.id
        viewModelScope.launch { loadPlace(location, flatId) }
    }

    private suspend fun loadPlace(location: Location, flatId: String?) {
        selected = location
        post = null
        flats = emptyList()
        flat = null
        permissions = null
        detailLoading = true
        runCatching { api.flats(location.id) }
            .onSuccess { list ->
                flats = list
                (list.firstOrNull { it.id == flatId } ?: list.firstOrNull())?.let { loadFlat(it) }
            }
            .onFailure(::fail)
        loadPermissions()
        detailLoading = false
    }

    private suspend fun loadPermissions() {
        val place = selected ?: return
        permissions = if (account != null) runCatching { api.permissions(place.id) }.getOrNull() else null
    }

    fun closePlace() {
        selected = null
        post = null
        editDraft = null
        addingFlat = false
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

    /** Refreshes the flat's lists (e.g. comment counts) without a loading state. */
    fun refreshFlatLists() = viewModelScope.launch {
        val current = flat ?: return@launch
        runCatching {
            reviews = api.tenantReviews(current.id)
            interactions = api.interactions(current.id)
        }
    }

    private suspend fun refreshPlace() {
        flat?.let { f ->
            loadFlat(flats.firstOrNull { it.id == f.id } ?: f)
            runCatching { api.flats(f.location.id) }.onSuccess { list ->
                flats = list
                list.firstOrNull { it.id == f.id }?.let { flat = it }
            }
        }
        selected?.let { s -> runCatching { api.location(s.id) }.onSuccess { selected = it } }
        val updated = selected
        if (updated != null) locations = locations.map { l -> if (l.id == updated.id) updated else l }
    }

    /** Opens the share forms, asking to sign in first. */
    fun share(kind: FeedbackTab) = requireSignIn(if (kind == FeedbackTab.TENANT) Pending.REVIEW else Pending.INTERACTION)

    fun askAddFlat() = requireSignIn(Pending.ADD_FLAT)

    // ----- Writing: each returns null on success, or the error to show in the form -----

    private suspend fun write(action: suspend () -> Unit): String? = try {
        action()
        null
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        errorText(e)
    }

    /** Runs [action], reporting failure in the snackbar; returns whether it succeeded. */
    private suspend fun attempt(action: suspend () -> Unit): Boolean =
        write(action)?.let { message = it; false } ?: true

    suspend fun postReview(rating: Int, feedback: String, start: String, end: String): String? = write {
        api.postReview(flat!!.id, rating, feedback, start, end)
        message = "Thanks for sharing. Your experience is now public."
        feedbackTab = FeedbackTab.TENANT
        refreshPlace()
    }

    suspend fun editReview(review: Review, rating: Int, feedback: String): String? = write {
        api.editReview(review.id, rating, feedback)
        message = "Your review was updated."
        if (selected != null) refreshPlace()
        if (tab == Tab.NOTEBOOK) loadNotebook()
    }

    suspend fun postInteraction(description: String, date: String): String? = write {
        api.postInteraction(flat!!.id, description, date)
        message = "Thanks for sharing. Your interaction is now public."
        feedbackTab = FeedbackTab.INTERACTION
        refreshPlace()
    }

    /** Adds the visitor's flat, then goes straight to the review form. */
    suspend fun addFlat(label: String): Boolean = attempt {
        val created = api.addFlat(selected!!.id, label)
        flats = api.flats(selected!!.id)
        loadFlat(flats.firstOrNull { it.id == created.id } ?: created)
        loadPermissions()
        message = "Flat ${created.label} added. You can review it now."
        form = Form(FeedbackTab.TENANT)
    }

    // ----- Editing what you added -----

    val canEditPlace: Boolean get() = permissions?.can_edit_location == true
    val canEditFlat: Boolean get() = flat?.id?.let { it in permissions?.editable_flat_ids.orEmpty() } == true

    fun startEditPlace() {
        val place = selected ?: return
        editDraft = PlaceDraft(place.building_name ?: "", place.address, if (canEditFlat) flat?.label ?: "" else "")
    }

    suspend fun saveEditPlace(draft: PlaceDraft): String? = write {
        val place = selected!!
        val name = draft.name.trim()
        val address = draft.address.trim()
        if (canEditPlace && (name != (place.building_name ?: "") || address != place.address)) {
            selected = api.editLocation(
                place.id,
                address = address.takeIf { it != place.address },
                buildingName = name.takeIf { it.isNotEmpty() && it != place.building_name },
                clearName = name.isEmpty() && place.building_name != null,
            )
        }
        val current = flat
        if (canEditFlat && current != null && draft.flatLabel.trim() != current.label) {
            api.editFlat(current.id, draft.flatLabel.trim())
        }
        refreshPlace()
        loadPermissions()
        editDraft = null
        message = "Your place was updated."
    }

    /** "Move the pin on the map": the shared map opens on the place. */
    fun startMovePin() {
        val place = selected ?: return
        val at = Point(place.latitude, place.longitude)
        movePin = at
        moveCamera(Area(place.title, center = at, zoom = 18.0))
    }

    fun dragMovePin(at: Point) {
        if (movePin != null) movePin = at
    }

    fun cancelMovePin() {
        movePin = null
    }

    suspend fun saveMovePin(): String? {
        val at = movePin ?: return null
        val place = selected ?: return null
        return write {
            selected = api.editLocation(place.id, at = at.latitude to at.longitude)
            locations = locations.map { l -> if (l.id == place.id) selected!! else l }
            movePin = null
            message = "The pin was moved."
        }
    }

    // ----- Deletion requests and admin -----

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

    /** Does [then] now if signed in, else opens the sign-in sheet and does it afterwards. */
    fun requireSignIn(then: Pending) {
        if (account != null) resume(then) else signInFor = then
    }

    fun dismissSignIn() {
        signInFor = null
        if (tab == Tab.NOTEBOOK && account == null) tab = Tab.EXPLORE
    }

    private fun resume(action: Pending) {
        when (action) {
            Pending.NONE -> Unit
            Pending.REVIEW -> if (flat != null) form = Form(FeedbackTab.TENANT)
            Pending.INTERACTION -> if (flat != null) form = Form(FeedbackTab.INTERACTION)
            Pending.ADD_FLAT -> if (selected != null) addingFlat = true
            Pending.ADD_PLACE -> openAddPlace()
            Pending.NOTEBOOK -> openNotebook()
        }
    }

    fun signIn(activity: Activity) = viewModelScope.launch {
        afterSignIn = signInFor ?: Pending.NONE
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
            signInFor = null
            return
        }
        app.sessions.token = result.session?.token
        account = result.account
        reactivationPending = false
        pendingCredential = null
        signInFor = null
        message = if (result.outcome == "reactivated") "Welcome back. Your account is active again."
        else "You’re signed in."
        flat?.let { loadFlat(it) }
        loadPermissions()
        val next = afterSignIn
        afterSignIn = Pending.NONE
        resume(next)
    }

    fun confirmReactivation(confirm: Boolean) = viewModelScope.launch {
        val credential = pendingCredential
        reactivationPending = false
        pendingCredential = null
        if (confirm && credential != null) attempt { finishSignIn(credential, reactivate = true) }
        else {
            afterSignIn = Pending.NONE
            if (tab == Tab.NOTEBOOK && account == null) tab = Tab.EXPLORE
        }
    }

    private fun signedOut() {
        app.sessions.token = null
        account = null
        ownReviews = emptyMap()
        permissions = null
        editDraft = null
        movePin = null
        notebook = Notebook()
        if (tab != Tab.EXPLORE) tab = Tab.EXPLORE
    }

    fun signOut(activity: Activity) = viewModelScope.launch {
        runCatching { api.signOut() }
        GoogleAuth(activity).clear()
        signedOut()
        message = "You’re signed out."
    }

    fun deactivate(activity: Activity) = viewModelScope.launch {
        if (attempt { api.deactivate() }) {
            GoogleAuth(activity).clear()
            signedOut()
            resultsOpen = false
            message = "Your account is deactivated. Your reviews stay public."
        }
    }

    // ----- Notebook -----

    private fun openNotebook() {
        tab = Tab.NOTEBOOK
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

    /** Opens one of the visitor's own records: the place page, with no map. */
    fun openOwn(locationId: String, flatId: String, tab: FeedbackTab) = viewModelScope.launch {
        feedbackTab = tab
        attempt { loadPlace(api.location(locationId), flatId) }
    }

    private companion object {
        const val KEY_LIST_ONLY = "list_only"
    }
}
