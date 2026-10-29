package com.sarginlabs.sidewave

import android.app.Application
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.*
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.sarginlabs.sidewave.api.Parca
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import org.json.JSONObject
import java.util.UUID

@UnstableApi
class MusicViewModel(application: Application) : AndroidViewModel(application) {
    val repo = application.app.repository
    val appearance = AppearanceManager(repo)
    val offline = application.app.offline
    val updates = AppUpdates(repo)
    private var updateDownload:Job?=null
    fun checkUpdates(automatic:Boolean=false) {viewModelScope.launch {updates.checkForUpdates(automatic)}}
    fun downloadUpdate() {if(updateDownload?.isActive!=true)updateDownload=viewModelScope.launch {updates.download()}}
    fun cancelUpdateDownload() {updateDownload?.cancel()}
    fun installUpdate(context:Context) {viewModelScope.launch {
        try {
            val file=updates.readyArtifact()
            val uri=FileProvider.getUriForFile(context,context.packageName+".updates",file)
            context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
        }catch(_:Exception){notice="Could not open the installer. Download the update and try again."}
    }}
    var controller by mutableStateOf<MediaController?>(null); private set
    var tab by mutableIntStateOf(0)
    var busy by mutableStateOf(false); private set
    var notice by mutableStateOf<String?>(null)
    var networkError by mutableStateOf<String?>(null); private set
    var query by mutableStateOf(""); private set
    var recentSearches by mutableStateOf(repo.prefs.getString("recentSearches", "")!!.split("\n").filter{it.isNotBlank()}); private set
    var rediscover by mutableStateOf<List<Parca>>(emptyList()); private set
    var homeWarning by mutableStateOf<String?>(null); private set
    var homeIntro by mutableStateOf<JSONObject?>(null); private set
    private var introJob:Job?=null
    fun claimHomeIntro() {
        introJob?.cancel()
        val visitId=UUID.randomUUID().toString()
        introJob=viewModelScope.launch {
            runCatching {repo.fetch("/api/v1/home/intro","POST",JSONObject().put("visitId",visitId))}.onSuccess {homeIntro=it}
        }
    }
    var searchBusy by mutableStateOf(false); private set
    var searchError by mutableStateOf<String?>(null); private set
    var searchTracks by mutableStateOf<List<Parca>>(emptyList()); private set
    var searchAlbums by mutableStateOf<List<JSONObject>>(emptyList()); private set
    var searchArtists by mutableStateOf<List<JSONObject>>(emptyList()); private set
    var history by mutableStateOf(repo.cached("/api/v1/history")?.tracks().orEmpty()); private set
    var recommendations by mutableStateOf<List<Parca>>(emptyList()); private set
    var favorites by mutableStateOf(repo.cached("/api/favoriler")?.tracks().orEmpty()); private set
    var playlists by mutableStateOf(repo.cached("/api/listeler")?.optJSONArray("listeler")?.objects().orEmpty()); private set
    // Shared playlists you follow (id "share:<token>"); collaborative ones also accept songs.
    var sharedPlaylists by mutableStateOf(repo.cached("/api/v1/shared")?.optJSONArray("listeler")?.objects().orEmpty()); private set
    fun openShared(list: JSONObject) = openDetail("/api/v1/shared/${Uri.encode(list.optString("token"))}", list.optString("ad"))
    var editorialCollections by mutableStateOf(repo.cached("/api/v1/collections")?.optJSONArray("listeler")?.objects()?.mapNotNull{runCatching{it.editorialSelection()}.getOrNull()}.orEmpty()); private set
    var trends by mutableStateOf<List<Parca>>(emptyList()); private set
    var recentAlbums by mutableStateOf<List<JSONObject>>(emptyList()); private set
    var followedReleases by mutableStateOf(repo.cached("/api/v1/library/releases")?.optJSONArray("items")?.objects().orEmpty()); private set
    var libraryArtists by mutableStateOf(repo.cached("/api/v1/library")?.optJSONArray("sanatcilar")?.objects().orEmpty()); private set
    var libraryAlbums by mutableStateOf(repo.cached("/api/v1/library")?.optJSONArray("albumler")?.objects().orEmpty()); private set
    var sonicStart by mutableStateOf<Parca?>(null); private set
    var sonicResult by mutableStateOf<JSONObject?>(null); private set
    var sonicMode by mutableStateOf(""); private set
    var detailArtists by mutableStateOf<List<JSONObject>>(emptyList()); private set
    var detailData by mutableStateOf<JSONObject?>(null); private set
    var detailKind by mutableStateOf(""); private set
    var detailSaving by mutableStateOf(false); private set
    private var detailPath: String? = null
    private var detailGeneration=0
    private data class DetailSnapshot(val path:String?,val title:String,val kind:String,val playlist:String?,val data:JSONObject?,val tracks:List<Parca>,val albums:List<JSONObject>,val artists:List<JSONObject>,val sonic:JSONObject?,val mode:String,val error:String?)
    private val detailHistory=ArrayDeque<DetailSnapshot>()
    private fun rememberDetail(nextPath:String?) {
        val title=detailTitle ?: return
        if(detailPath==nextPath)return
        if(detailHistory.size>=30)detailHistory.removeFirst()
        detailHistory.addLast(DetailSnapshot(detailPath,title,detailKind,detailPlaylist,detailData?.let {JSONObject(it.toString())},detailTracks,detailAlbums,detailArtists,sonicResult,sonicMode,detailError))
    }
    fun backDetail() {
        if(detailHistory.isEmpty()) {closeDetail();return}
        ++detailGeneration;detailJob?.cancel()
        val old=detailHistory.removeLast();detailPath=old.path;detailTitle=old.title;detailKind=old.kind;detailPlaylist=old.playlist;detailData=old.data;detailTracks=old.tracks;detailAlbums=old.albums;detailArtists=old.artists;sonicResult=old.sonic;sonicMode=old.mode;detailError=old.error;detailBusy=false;detailSaving=false
    }

    var detailTitle by mutableStateOf<String?>(null); private set
    var detailTracks by mutableStateOf<List<Parca>>(emptyList()); private set
    var detailAlbums by mutableStateOf<List<JSONObject>>(emptyList()); private set
    var detailPlaylist by mutableStateOf<String?>(null); private set
    var detailError by mutableStateOf<String?>(null); private set
    var detailBusy by mutableStateOf(false); private set
    var devices by mutableStateOf<List<JSONObject>>(emptyList()); private set
    var queue by mutableStateOf<List<Parca>>(emptyList()); private set
    var current by mutableStateOf<Parca?>(null); private set
    var playing by mutableStateOf(false); private set
    var buffering by mutableStateOf(false); private set
    var position by mutableLongStateOf(0); private set
    var duration by mutableLongStateOf(0); private set
    var repeat by mutableIntStateOf(Player.REPEAT_MODE_OFF); private set
    var shuffle by mutableStateOf(false); private set
    var radioEnabled by mutableStateOf(repo.prefs.getBoolean("radioEnabled", false)); private set
    var archiveJobs by mutableStateOf<List<JSONObject>>(emptyList()); private set
    var importPreview by mutableStateOf<JSONObject?>(null); private set
    private var searchJob: Job? = null
    private var detailJob: Job? = null
    private val listSyncSlots = Semaphore(2)
    private var radioBusy = false
    private var playJob: Job? = null
    private var lastPlayerItem: MediaItem? = null
    private var importJob: Job? = null
    private val future = MediaController.Builder(application, SessionToken(application, ComponentName(application, PlaybackService::class.java))).buildAsync()
    private val listener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) { updatePlayer(events.contains(Player.EVENT_TIMELINE_CHANGED)); maybeRadio() }
    }
    init {
        viewModelScope.launch { repo.favoriteChanges.collect { favorites=repo.cached("/api/favoriler")?.tracks().orEmpty() } }
        future.addListener({
            runCatching { future.get() }.onSuccess { value -> controller = value; value.addListener(listener); updatePlayer(refreshQueue = true) }
                .onFailure { notice = "Could not start the player. Reopen the app." }
        }, ContextCompat.getMainExecutor(application))
        refresh()
        viewModelScope.launch {updates.restore();updates.checkForUpdates(automatic=true)}
        // Send the last crash report (stack frames only) once, so it reaches the owner without a phone at hand.
        viewModelScope.launch { getApplication<SidewaveApplication>().diagnostics.pendingCrash()?.let { crash -> runCatching { repo.fetch("/api/v1/diagnostics", "POST", crash) }.onSuccess { getApplication<SidewaveApplication>().diagnostics.markUploaded(crash) } } }
        viewModelScope.launch { while(isActive) { updatePlayer(); offline.refresh(); delay(1000) } }
        viewModelScope.launch { while(isActive) { delay(15_000); if(archiveJobs.isNotEmpty()) refreshArchives() } }
    }
    private fun updatePlayer(refreshQueue: Boolean = false) {
        controller?.let { p ->
            val item = p.currentMediaItem
            if(item != lastPlayerItem) { lastPlayerItem = item; current = item?.trackOrNull() }
            playing = p.isPlaying
            current?.takeIf {playing && history.firstOrNull()?.key()!=it.key()}?.let {track -> history=(listOf(track)+history.filterNot {it.key()==track.key()}).take(50)}
            buffering = p.playbackState == Player.STATE_BUFFERING
            position = p.currentPosition.coerceAtLeast(0); duration = p.duration.coerceAtLeast(0)
            if(refreshQueue) queue = (0 until p.mediaItemCount).mapNotNull { p.getMediaItemAt(it).trackOrNull() }
            repeat = p.repeatMode; shuffle = p.shuffleModeEnabled
        }
    }
    private fun maybeRadio() {
        val player = controller ?: return
        if(!radioEnabled || radioBusy || player.playbackState != Player.STATE_ENDED) return
        val track = current ?: return
        radioBusy = true
        viewModelScope.launch {
            try {
                val data = repo.fetch("/api/v1/radio", "POST", JSONObject().put("parca", track.json()))
                val candidates = data.tracks().filterNot { next -> queue.any { it.key() == next.key() } }.take(20)
                if(candidates.isNotEmpty()) { val index = player.mediaItemCount; player.addMediaItems(withContext(Dispatchers.IO) { candidates.map { it.copy(entryId = UUID.randomUUID().toString()).mediaItem(repo) } }); player.seekTo(index, 0); player.prepare(); player.play() }
                else notice = "No new radio suggestions found."
            } catch(_: Exception) { notice = "Connect to start song radio." } finally { radioBusy = false }
        }
    }
    fun setRadio(enabled: Boolean) { radioEnabled = enabled; repo.prefs.edit().putBoolean("radioEnabled", enabled).apply() }
    var evenVolume by mutableStateOf(repo.prefs.getBoolean("evenVolume", true)); private set
    // Applied by the playback service from the next track onwards.
    fun changeEvenVolume(enabled: Boolean) { evenVolume = enabled; repo.prefs.edit().putBoolean("evenVolume", enabled).apply() }
    fun refresh() {
        viewModelScope.launch {
            busy = true; networkError = null
            runCatching { repo.syncFavorites(); repo.flushEvents() }
            supervisorScope {
                listOf(
                    async { runCatching { repo.read("/api/v1/home") }.onSuccess { data ->
                        val sections=data.optJSONObject("sections")
                        rediscover=sections?.optJSONObject("rediscover")?.optJSONArray("data")?.objects()?.mapNotNull{runCatching{it.track()}.getOrNull()}.orEmpty()
                        val selected=sections?.optJSONObject("forYou")
                        selected?.optJSONArray("data")?.objects()?.mapNotNull{runCatching{it.track()}.getOrNull()}?.let{recommendations=it}
                        homeWarning=if(selected?.optString("state")=="stale") "Showing your last available personal mix." else null
                    } },
                    async { runCatching { repo.read("/api/v1/history") }.onSuccess { history = it.tracks() } },
                    async { runCatching { repo.read("/api/v1/mixes") }.onSuccess { dailyMixes = it.optJSONArray("mixes")?.objects().orEmpty() } },
                    async { runCatching { repo.read("/api/v1/shared") }.onSuccess { sharedPlaylists = it.optJSONArray("listeler")?.objects().orEmpty() } },
                    async { runCatching {repo.read("/api/v1/collections")}.onSuccess {editorialCollections=it.optJSONArray("listeler")?.objects()?.mapNotNull{d->runCatching{d.editorialSelection()}.getOrNull()}.orEmpty()} },
                    async { if(!repo.pendingFavorites()) runCatching { repo.read("/api/favoriler") }.onSuccess { if(!repo.pendingFavorites()) favorites = it.tracks() } },
                    async { runCatching { repo.read("/api/listeler") }.onSuccess { playlists = it.optJSONArray("listeler")?.objects().orEmpty(); cachePlaylistDetails() }.onFailure { networkError = "Could not connect. Showing your saved library." } },
                    async { runCatching { reloadLibrary() } },
                    async { runCatching { repo.read("/api/v1/library/releases") }.onSuccess {followedReleases=it.optJSONArray("items")?.objects().orEmpty()} },
                    async { runCatching { repo.read("/api/kesfet") }.onSuccess { recentAlbums = it.optJSONArray("albumler")?.objects().orEmpty(); trends = it.tracks("trendParcalar") } }
                ).awaitAll()
            }
            busy = false
        }
    }
    fun search(text: String) {
        query = text; searchJob?.cancel(); searchTracks=emptyList();searchAlbums=emptyList();searchArtists=emptyList();searchError=null
        if(text.trim().isEmpty()) { searchTracks = emptyList(); searchAlbums = emptyList(); searchArtists = emptyList(); searchBusy = false; return }
        searchBusy = true; searchError = null
        searchJob = viewModelScope.launch {
            delay(350)
            try {
                val data = repo.fetch("/api/ara?q=${Uri.encode(text.trim())}")
                ensureActive(); if(query != text) return@launch
                recentSearches=(listOf(text.trim())+recentSearches.filter{it!=text.trim()}).take(8);repo.prefs.edit().putString("recentSearches",recentSearches.joinToString("\n")).apply()
                searchTracks = data.tracks(); searchAlbums = data.optJSONArray("albumler")?.objects().orEmpty(); searchArtists = data.optJSONArray("sanatcilar")?.objects().orEmpty()
                if(data.optJSONObject("hata")?.let { obj -> obj.keys().asSequence().any { !obj.isNull(it) && obj.opt(it) != false } } == true) searchError = "Some results are unavailable. Showing what we found."
            } catch(e: CancellationException) { throw e } catch(_: Exception) { searchError = "Search is unavailable. Check your connection and try again."; searchTracks = emptyList() }
            finally { if(query == text) searchBusy = false }
        }
    }
    fun play(tracks: List<Parca>, index: Int = 0, atSeconds: Double = 0.0) {
        if(tracks.isEmpty()) return
        val p = controller ?: run { notice = "Getting your player ready…"; return }
        playJob?.cancel()
        playJob = viewModelScope.launch {
            try {
                val items = preparePlaybackQueue(tracks) { it.mediaItem(repo) }
                ensureActive()
                if(!p.isConnected) { notice = "The player disconnected. Reopen the app."; return@launch }
                PlaybackNotice.error.value = null
                p.setMediaItems(items, index.coerceIn(items.indices), safePositionMillis(atSeconds))
                p.prepare(); p.play(); updatePlayer(refreshQueue = true)
            } catch(e: CancellationException) { throw e }
            catch(_: Exception) { PlaybackNotice.error.value = "Could not prepare your queue. Try again and check available storage." }
        }
    }
    fun toggle() { if(PlaybackNotice.error.value!=null){retry();return};controller?.let { if(it.isPlaying || it.playWhenReady && buffering) it.pause() else { PlaybackNotice.error.value = null; if(it.playbackState == Player.STATE_ENDED) it.seekToDefaultPosition(); if(it.playbackState == Player.STATE_IDLE || it.playbackState == Player.STATE_ENDED) it.prepare(); it.play() } } }
    fun retry() {
        val p=controller ?: return
        val previous=p.currentMediaItem ?: return
        val track=previous.trackOrNull() ?: return
        val index=p.currentMediaItemIndex;val position=p.currentPosition
        playJob?.cancel();playJob=viewModelScope.launch {
            try {
                val replacement=withContext(Dispatchers.IO){track.copy(entryId=UUID.randomUUID().toString()).mediaItem(repo)}
                if(p.currentMediaItem?.mediaId!=previous.mediaId)return@launch
                PlaybackNotice.error.value=null;p.replaceMediaItem(index,replacement);p.seekTo(index,position);p.prepare();p.play()
            }catch(e:CancellationException){throw e}catch(_:Exception){PlaybackNotice.error.value="Could not prepare this track again."}
        }
    }
    fun next() { controller?.let { if(it.hasNextMediaItem()) { it.seekToNextMediaItem(); it.prepare(); it.play() } else notice = "You have reached the end of the queue." } }
    fun previous() { controller?.seekToPrevious() }
    fun seek(value: Long) { controller?.seekTo(value) }
    fun toggleShuffle() { controller?.let { it.shuffleModeEnabled = !it.shuffleModeEnabled } }
    fun toggleRepeat() { controller?.let { it.repeatMode = (it.repeatMode + 1) % 3 } }
    fun addQueue(track: Parca) { viewModelScope.launch {
        try {
            val item = withContext(Dispatchers.IO) { track.copy(entryId = UUID.randomUUID().toString()).mediaItem(repo) }
            val player = controller ?: return@launch
            player.addMediaItem(item); notice = "Added to queue."
        } catch(e: CancellationException) { throw e }
        catch(_: Exception) { notice = "Could not add to queue. Please try again." }
    } }
    private var removedQueueItem: Pair<Int, androidx.media3.common.MediaItem>? = null
    fun undoQueueRemoval() { removedQueueItem?.let { (index, item) -> controller?.let { it.addMediaItem(index.coerceAtMost(it.mediaItemCount), item) } }; removedQueueItem = null }
    fun removeQueue(index: Int) { controller?.let { removedQueueItem = index to it.getMediaItemAt(index); if(index == it.currentMediaItemIndex && index == it.mediaItemCount - 1) it.pause(); it.removeMediaItem(index) } }
    fun moveQueue(index: Int, to: Int) { controller?.let { if(to in 0 until it.mediaItemCount) it.moveMediaItem(index, to) } }
    fun selectQueue(index: Int) { controller?.let { it.seekTo(index, 0); it.prepare(); it.play() } }
    fun isFavorite(track: Parca) = favorites.any { it.sameRecording(track) }
    fun favorite(track: Parca) {
        val value = !isFavorite(track)
        val previousFavorites = favorites
        favorites = favorites.filterNot { it.sameRecording(track) }.let { if(value) it + track else it }
        viewModelScope.launch { runCatching { repo.favorite(track, value) }.onFailure { favorites = previousFavorites; notice = "Could not save your like. Check available storage." } }
    }
    fun showFavorites() { sonicResult=null; detailArtists=emptyList(); detailJob?.cancel(); detailData = null; detailKind = ""; detailPath = null; detailTitle = "Liked Songs"; detailTracks = favorites; detailAlbums = emptyList(); detailPlaylist = null; detailBusy = false; detailError = null }
    fun closeDetail() { ++detailGeneration;detailHistory.clear();sonicResult=null; detailArtists=emptyList(); detailJob?.cancel(); detailTitle = null; detailData = null; detailKind = ""; detailPath = null }
    fun playVoiceSearch(query: String) {
        val player=controller ?: return
        if(query.isBlank()) {
            if(player.mediaItemCount>0) { player.prepare(); player.play() }
            else { val tracks=offline.items.value.filter { it.state==androidx.media3.exoplayer.offline.Download.STATE_COMPLETED }.map { it.track }.ifEmpty { favorites }; if(tracks.isNotEmpty()) play(tracks) else notice="No recording available to play." }
            return
        }
        player.setMediaItem(MediaItem.Builder().setRequestMetadata(MediaItem.RequestMetadata.Builder().setSearchQuery(query.take(200)).build()).build())
        player.prepare();player.play()
    }
    fun openWeekly() = openDetail("/api/v1/discovery/weekly","Discover Weekly")
    // Daily mixes use the generic track detail: the mix response carries "ad" and "parcalar".
    var dailyMixes by mutableStateOf(repo.cached("/api/v1/mixes")?.optJSONArray("mixes")?.objects().orEmpty()); private set
    fun openMix(mix: JSONObject) = openDetail("/api/v1/mixes/${Uri.encode(mix.optString("id"))}", mix.optString("ad", "Daily Mix"))
    fun openEditorials() = openDetail("/api/v1/collections","Sidewave Sessions")
    fun openEditorial(id:String,title:String) = openDetail("/api/v1/collections/${Uri.encode(id)}",title)
    fun reloadDetail() {detailPath?.let{openDetail(it,detailTitle ?: "Session",detailPlaylist)}}
    fun openPlaylist(id: String, title: String) = openDetail("/api/liste/${Uri.encode(id)}", title, id)
    fun openAlbum(album: JSONObject) {
        val id = album.optString("id")
        val online = album.optString("kaynak") == "youtube" || id.startsWith("MPRE") || id.startsWith("OLAK")
        openDetail(if(online) "/api/yt/album/${Uri.encode(id)}" else "/api/library/album/${Uri.encode(id)}", album.optString("ad", album.optString("baslik", "Album")))
    }
    fun openArtist(artist: JSONObject) {
        val id = artist.optString("id")
        openDetail(if(artist.optString("kaynak") == "youtube" || id.startsWith("UC")) "/api/yt/sanatci/${Uri.encode(id)}" else "/api/library/artist/${Uri.encode(id)}", artist.optString("ad", "Artist"))
    }
    private fun openDetail(path: String, title: String, playlist: String? = null) {
        rememberDetail(path);val generation=++detailGeneration
        sonicResult=null; detailArtists=emptyList(); detailJob?.cancel(); detailPath = path; detailTitle = title; detailPlaylist = playlist; detailError = null
        detailKind = if(path=="/api/v1/collections") "collections" else if(path.startsWith("/api/v1/collections/")) "editorial" else if(path=="/api/v1/discovery/weekly") "weekly" else if(path.contains("/sanatci/") || path.contains("/artist/")) "artist" else if(path.contains("/album/")) "album" else ""
        detailData = null; detailSaving = false
        val cache = repo.cached(path); detailData = cache; detailTracks = cache?.profileTracks().orEmpty(); detailAlbums = cache?.optJSONArray("albumler")?.objects().orEmpty()
        if(detailKind=="collections") editorialCollections=cache?.optJSONArray("listeler")?.objects()?.mapNotNull{runCatching{it.editorialSelection()}.getOrNull()}.orEmpty()
        detailBusy = true
        detailJob = viewModelScope.launch {
            try {
                val data=repo.read(path);ensureActive();if(generation!=detailGeneration)return@launch
                if(detailKind in listOf("editorial","weekly"))data.editorialSelection()
                if(detailKind=="collections")editorialCollections=data.optJSONArray("listeler")?.objects()?.map{it.editorialSelection()}.orEmpty()
                detailData=data;detailTitle=data.textOrNull("ad") ?: title;detailTracks=data.profileTracks();detailAlbums=data.optJSONArray("albumler")?.objects().orEmpty()
            }
            catch(e: CancellationException) { throw e } catch(_: Exception) { detailError = if(cache != null) "Showing saved content while offline." else "Could not load this page. Connect and try again." }
            finally {if(generation==detailGeneration) detailBusy = false}
        }
    }
    private suspend fun reloadLibrary() {
        val data = repo.read("/api/v1/library")
        libraryArtists = data.optJSONArray("sanatcilar")?.objects().orEmpty()
        libraryAlbums = data.optJSONArray("albumler")?.objects().orEmpty()
        (libraryArtists.map { a -> (if(a.optString("kaynak")=="youtube") "/api/yt/sanatci/" else "/api/library/artist/") + Uri.encode(a.optString("id")) } +
            libraryAlbums.map { a -> (if(a.optString("kaynak")=="youtube") "/api/yt/album/" else "/api/library/album/") + Uri.encode(a.optString("id")) }).forEach { path ->
            viewModelScope.launch { listSyncSlots.withPermit { runCatching { repo.read(path) } } }
        }
    }
    fun chooseSonicStart(track: Parca) { sonicStart=track; notice="Start: ${track.baslik}. Choose Create a journey to this track from your destination song’s menu." }
    fun sonic(track: Parca, mode: String) {
        val start=sonicStart
        if(mode=="path" && start==null) {chooseSonicStart(track);return}
        val body=if(mode=="path") JSONObject().put("start",start!!.json()).put("end",track.json()) else JSONObject().put("parca",track.json())
        sonicRequest("/api/v1/discovery/$mode",body,when(mode){"path"->"Sound journey";"similar-tracks"->"Similar tracks";else->"Instant mix"},mode)
    }
    fun similarArtists() { val id=detailData?.textOrNull("appId") ?: return; sonicRequest("/api/v1/discovery/artists/${Uri.encode(id)}",null,"Similar artists","artists") }
    private fun sonicRequest(path: String, body: JSONObject?, title: String, mode: String) {
        rememberDetail(path);val generation=++detailGeneration
        detailJob?.cancel(); detailPath=path; detailKind=""; detailTitle=title; detailPlaylist=null; detailTracks=emptyList(); detailAlbums=emptyList(); detailArtists=emptyList(); detailData=null; sonicResult=null; sonicMode=mode; detailError=null; detailBusy=true
        detailJob=viewModelScope.launch {
            try {
                var result=repo.fetch(path,if(body==null) "GET" else "POST",body)
                while(true) {
                    ensureActive(); if(generation!=detailGeneration) return@launch
                    detailTracks=result.tracks(); detailArtists=result.optJSONArray("sanatcilar")?.objects().orEmpty(); sonicResult=result
                    detailError=null; detailBusy=false
                    val analysis=result.optJSONObject("analysis")
                    if(analysis==null || analysis.optString("state") !in listOf("analyzing","waiting")) break
                    kotlinx.coroutines.delay(4000)
                    result=repo.fetch("/api/v1/discovery/sessions/${Uri.encode(analysis.getString("id"))}?mix=${mode=="instant-mix"}")
                }
            } catch(e: CancellationException) {throw e} catch(e: Exception) {if(generation==detailGeneration) detailError=(e as? ApiFailure)?.message ?: "Connect to discover similar sounds."}
            finally {if(generation==detailGeneration) detailBusy=false}
        }
    }
    fun retrySonicAnalysis() {
        val id=sonicResult?.optJSONObject("analysis")?.textOrNull("id") ?: return
        val mix=sonicMode=="instant-mix"
        viewModelScope.launch {
            try { repo.fetch("/api/v1/discovery/sessions/${Uri.encode(id)}/retry","POST",JSONObject())
                if(sonicResult?.optJSONObject("analysis")?.optString("id")==id)
                    sonicRequest("/api/v1/discovery/sessions/${Uri.encode(id)}?mix=$mix",null,detailTitle ?: "Similar tracks",sonicMode)
            } catch(_:Exception) { notice="Could not restart sound analysis. Try again shortly." }
        }
    }
    fun sonicScore(track: Parca): Double? {
        if(sonicMode!="similar-tracks")return null
        val match=sonicResult?.optJSONArray("matches")?.objects()?.firstOrNull {it.optJSONObject("parca")?.optString("id")==track.id} ?: return null
        if(match.isNull("similarity"))return null
        return match.optDouble("similarity").takeIf {it.isFinite() && it in 0.0..1.0}
    }
    fun expandDiscography() {
        val data=detailData ?: return
        val id=data.textOrNull("appId") ?: return
        val path=detailPath ?: return
        if(detailBusy || detailKind!="artist") return
        detailBusy=true
        detailJob=viewModelScope.launch {
            try {
                var page=repo.fetch("/api/v1/artists/${Uri.encode(id)}/releases?type=all&limit=100&expand=true")
                val albums=page.optJSONArray("items")?.objects().orEmpty().toMutableList()
                while(!page.isNull("nextOffset")) {
                    page=repo.fetch("/api/v1/artists/${Uri.encode(id)}/releases?type=all&limit=100&offset=${page.getInt("nextOffset")}")
                    albums.addAll(page.optJSONArray("items")?.objects().orEmpty())
                }
                ensureActive()
                val next=JSONObject(data.toString()).put("albumler",org.json.JSONArray(albums)).put("diskografiTam",page.optBoolean("complete"))
                repo.save(path,next)
                if(detailPath==path) {detailData=next;detailAlbums=albums}
            } catch(e: CancellationException) {throw e} catch(_: Exception) {if(detailPath==path) detailError="Could not load more releases. Your current view is preserved."}
            finally {if(detailPath==path) detailBusy=false}
        }
    }
    fun toggleDetailSaved() {
        val data = detailData ?: return
        val id = data.textOrNull("appId") ?: return
        val kind = detailKind; val path = detailPath ?: return
        if(detailSaving || kind !in listOf("artist","album")) return
        detailSaving = true
        viewModelScope.launch {
            try {
                val field = if(kind=="artist") "takip" else "kayitli"
                val endpoint = if(kind=="artist") "/api/v1/artists/${Uri.encode(id)}/follow" else "/api/v1/albums/${Uri.encode(id)}/save"
                val result = repo.fetch(endpoint,"PUT",JSONObject().put(field,!data.optBoolean(field)))
                repo.save(path,result)
                if(detailPath==path) detailData=result
                reloadLibrary()
            } catch(e: CancellationException) { throw e } catch(_: Exception) { notice="Connect to save your changes. Your previous selection is preserved." }
            finally { if(detailPath==path) detailSaving=false }
        }
    }
    fun openTrackArtist(track: Parca) { track.sanatciId?.let { openArtist(JSONObject().put("id",it).put("ad",track.sanatci).put("kaynak",track.kaynak)) } }
    fun openTrackAlbum(track: Parca) { track.albumId?.let { openAlbum(JSONObject().put("id",it).put("ad",track.album).put("kaynak",track.kaynak)) } }
    fun createPlaylist(name: String) = action {
        repo.fetch("/api/liste", "POST", JSONObject().put("ad", name.trim())); reloadPlaylists(); notice = "Playlist created."
    }
    private fun cachePlaylistDetails() {
        playlists.forEach { list -> viewModelScope.launch { listSyncSlots.withPermit { runCatching { repo.read("/api/liste/${Uri.encode(list.getString("id"))}") }.onSuccess {recommendations=outsidePersonalPlaylists(recommendations,it.tracks())} } } }
    }
    private suspend fun reloadPlaylists() { playlists = repo.read("/api/listeler").optJSONArray("listeler")?.objects().orEmpty(); cachePlaylistDetails() }
    /** Creates (or reuses) a song link and hands it to the system share sheet. */
    fun shareTrack(track: Parca, context: android.content.Context) = viewModelScope.launch {
        runCatching { repo.fetch("/api/v1/tracks/share", "POST", JSONObject().put("parca", track.json())).getString("url") }
            .onSuccess { url -> context.startActivity(android.content.Intent.createChooser(android.content.Intent(android.content.Intent.ACTION_SEND).setType("text/plain").putExtra(android.content.Intent.EXTRA_SUBJECT, "${track.baslik} · ${track.sanatci}").putExtra(android.content.Intent.EXTRA_TEXT, "${track.baslik} · ${track.sanatci}\n$url"), "Share song").addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)) }
            .onFailure { notice = "Could not create a song link. Check your connection." }
    }
    fun addPlaylist(id: String, tracks: List<Parca>) = action {
        if(id.startsWith("share:")) repo.fetch("/api/v1/shared/${Uri.encode(id.removePrefix("share:"))}/tracks", "POST", JSONObject().put("parcalar", tracks.jsonArray()))
        else { repo.fetch("/api/liste/${Uri.encode(id)}/ekle", "POST", JSONObject().put("parcalar", tracks.jsonArray())); repo.read("/api/liste/${Uri.encode(id)}") }
        reloadPlaylists(); notice = if(tracks.size == 1) "Added to the playlist." else "${tracks.size} songs added to the playlist."
        recommendations=outsidePersonalPlaylists(recommendations,tracks)
    }
    fun renamePlaylist(id: String, name: String) = action {
        repo.fetch("/api/liste/${Uri.encode(id)}", "PATCH", JSONObject().put("ad", name.trim())); detailTitle = name.trim(); reloadPlaylists()
    }
    fun removeFromPlaylist(track: Parca) = action {
        val id = detailPlaylist ?: return@action
        repo.fetch("/api/liste/${Uri.encode(id)}/cikar", "POST", JSONObject().put("entryId", track.entryId)); detailTracks = repo.read("/api/liste/${Uri.encode(id)}").tracks()
    }
    fun removePlaylistEntries(tracks: List<Parca>) = action {
        val id = detailPlaylist ?: return@action
        val entries=tracks.mapNotNull { it.entryId }
        if(entries.isEmpty()) return@action
        repo.fetch("/api/liste/${Uri.encode(id)}/cikar", "POST", JSONObject().put("entryIds", org.json.JSONArray(entries)))
        val updated=repo.read("/api/liste/${Uri.encode(id)}").tracks()
        if(detailPlaylist==id) detailTracks=updated
        reloadPlaylists(); notice="${entries.size} playlist entries removed."
    }
    fun movePlaylist(index: Int, target: Int) = action {
        val id = detailPlaylist ?: return@action
        if(target !in detailTracks.indices) return@action
        val reordered = detailTracks.toMutableList().apply { add(target, removeAt(index)) }
        repo.fetch("/api/liste/${Uri.encode(id)}", "PATCH", JSONObject().put("entryIds", org.json.JSONArray(reordered.map { it.entryId }))); detailTracks = repo.read("/api/liste/${Uri.encode(id)}").tracks()
    }
    fun deletePlaylist(id: String) = action { repo.fetch("/api/liste/${Uri.encode(id)}", "DELETE"); closeDetail(); reloadPlaylists() }
    fun chooseArchive(id: String, candidateId: String) = action { repo.fetch("/api/v1/archive/jobs/${Uri.encode(id)}/select", "POST", JSONObject().put("candidateId", candidateId)); refreshArchives() }
    fun loadArchives() = action { refreshArchives() }
    fun download(track: Parca, compatible: Boolean = false) {
        if(track.kaynak != "kutuphane") { notice = "Save this recording to your library first. You can download it when it is ready."; return }
        runCatching { offline.download(track, compatible) }.onFailure { notice = it.message ?: "Could not start the download." }
        viewModelScope.launch { repo.saveArtwork(track) }
    }
    fun archive(track: Parca) = action {
        val job = repo.fetch("/api/arsive-ekle", "POST", track.json().put("parca", track.json()))
        notice = "Preparing your recording. Download it once it is ready in your library."
        refreshArchives()
    }
    private suspend fun refreshArchives() { runCatching { repo.fetch("/api/v1/archive/jobs") }.onSuccess { archiveJobs = it.optJSONArray("jobs")?.objects().orEmpty() } }
    fun loadDevices() = action { devices = repo.fetch("/api/v1/devices").optJSONArray("devices")?.objects().orEmpty() }
    fun takeover() = action {
        val data = repo.fetch("/api/v1/devices/${repo.deviceId}/takeover", "POST", JSONObject().put("commandId", UUID.randomUUID().toString()))
        repo.prefs.edit().putInt("queueRevision", data.optInt("queueRevision")).apply()
        play(data.tracks("queue"), data.optInt("index"), data.optDouble("position", 0.0)); notice = "Bu cihazda devam ediliyor."
    }
    fun previewImport(text: String, format: String) {
        importJob?.cancel()
        importJob = viewModelScope.launch {
            try {
                require(text.length <= 2_000_000) { "Files must be no larger than 2 MB." }
                var result = repo.fetch("/api/v1/import/preview", "POST", JSONObject().put("text", text).put("format", format))
                importPreview = result
                val jobId = result.textOrNull("jobId")
                while(jobId != null && result.optBoolean("pending")) {
                    delay(1000)
                    result = repo.fetch("/api/v1/import/preview/${Uri.encode(jobId)}")
                    ensureActive(); importPreview = result
                }
            } catch(e: CancellationException) { throw e } catch(e: Exception) { notice = e.message ?: "Could not load this preview." }
        }
    }
    fun closeImport() {
        val pending = importPreview?.takeIf { it.optBoolean("pending") }?.textOrNull("jobId")
        importJob?.cancel(); importPreview = null
        pending?.let { action { repo.fetch("/api/v1/import/preview/${Uri.encode(it)}", "DELETE") } }
    }
    fun commitImport(name: String, tracks: List<Parca>) = action {
        val data = repo.fetch("/api/v1/import/commit", "POST", JSONObject().put("name", name).put("parcalar", tracks.jsonArray()))
        importPreview = null; reloadPlaylists(); openPlaylist(data.getString("id"), name); notice = "Playlist imported."
    }
    fun setServer(value: String) {
        runCatching { repo.base = value }.onSuccess { notice = "Sunucu kaydedildi."; refresh() }.onFailure { notice = it.message }
    }
    fun radio(track: Parca) = action {
        val data = repo.fetch("/api/v1/radio", "POST", JSONObject().put("parca", track.json()))
        val tracks = data.tracks().filterNot { it.key() == track.key() }
        if(tracks.isEmpty()) notice = "No radio suggestions for this track yet." else { setRadio(true); play(listOf(track) + tracks) }
    }
    fun suppress(track: Parca) = action {
        repo.fetch("/api/v1/recommendations/dismiss", "POST", JSONObject().put("parca", track.json())); recommendations = recommendations.filterNot { it.key() == track.key() }; notice = "Removed from your recommendations."
    }
    private fun action(block: suspend () -> Unit) { viewModelScope.launch { try { block() } catch(_: CancellationException) { } catch(e: Exception) { notice = (e as? ApiFailure)?.message ?: "Could not complete this action. Connect and try again." } } }
    override fun onCleared() { controller?.removeListener(listener); MediaController.releaseFuture(future); super.onCleared() }
}
