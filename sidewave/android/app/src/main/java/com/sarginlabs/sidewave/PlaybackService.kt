package com.sarginlabs.sidewave

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.analytics.PlaybackStatsListener
import androidx.media3.common.Timeline
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.LibraryResult
import androidx.media3.session.SessionError
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import androidx.media3.session.CommandButton
import androidx.media.utils.MediaConstants
import com.google.common.util.concurrent.Futures
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.SettableFuture
import com.google.common.util.concurrent.ListenableFuture
import com.sarginlabs.sidewave.api.Parca
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject
import java.util.UUID

object PlaybackSignals {
    val deliveries = java.util.concurrent.ConcurrentHashMap<String, String>()
    val sleepUntil = MutableStateFlow(0L)
    val sleepAtEnd = MutableStateFlow(false)
}
object PlaybackNotice {
    val error = MutableStateFlow<String?>(null)
    val info = MutableStateFlow<String?>(null)
    val format = MutableStateFlow<String?>(null)
    val delivery = MutableStateFlow("online")
}

@UnstableApi
fun Parca.mediaItem(repo: Repository): MediaItem {
    val entry = entryId ?: UUID.randomUUID().toString()
    val stored = copy(entryId = entry)
    val trace = UUID.randomUUID().toString()
    val downloaded = repo.context.app.offline.downloadedItem(this)
    val compatible = repo.prefs.getBoolean("compatible:${key()}", false)
    return (downloaded?.buildUpon() ?: MediaItem.Builder().setUri("sidewave://${if(compatible) "transcode" else "track"}/${Uri.encode(key())}?trace=$trace").setCustomCacheKey(key() + if(compatible) ":mp3" else ""))
        .setMediaId(entry).setMediaMetadata(MediaMetadata.Builder()
            .setTitle(baslik).setArtist(sanatci).setAlbumTitle(album)
            .setArtworkUri(CarArtwork.trackUri(repo,this))
            .setExtras(Bundle().apply { putString("parca", stored.json().toString());if(repo.context.app.offline.completed(stored))putLong(android.support.v4.media.MediaDescriptionCompat.EXTRA_DOWNLOAD_STATUS,android.support.v4.media.MediaDescriptionCompat.STATUS_DOWNLOADED) }).build()).build()
}
fun MediaItem.trackOrNull(): Parca? = mediaMetadata.extras?.getString("parca")?.let { runCatching { JSONObject(it).track() }.getOrNull() }

@UnstableApi
class PlaybackService : MediaLibraryService() {
    private lateinit var player: ExoPlayer
    private var session: MediaLibrarySession? = null
    private lateinit var carLibrary: CarLibrary
    private val carLike=SessionCommand("car.favorite",Bundle.EMPTY)
    private val carShuffle=SessionCommand("car.shuffle",Bundle.EMPTY)
    private val carRepeat=SessionCommand("car.repeat",Bundle.EMPTY)
    private val widgetControl=SessionCommand(MusicWidgets.COMMAND,Bundle.EMPTY)
    private fun carButtons():List<CommandButton> {
        val liked=player.currentMediaItem?.trackOrNull()?.let{carLibrary.isFavorite(it)}==true
        return listOf(
            CommandButton.Builder(if(liked)CommandButton.ICON_HEART_FILLED else CommandButton.ICON_HEART_UNFILLED)
                .setDisplayName(if(liked)"Remove from liked songs" else "Like song").setSessionCommand(carLike).setCustomIconResId(if(liked)R.drawable.car_heart else R.drawable.car_heart_outline)
                .setEnabled(player.currentMediaItem!=null).setSlots(CommandButton.SLOT_BACK_SECONDARY,CommandButton.SLOT_OVERFLOW).build(),
            CommandButton.Builder(if(player.shuffleModeEnabled)CommandButton.ICON_SHUFFLE_ON else CommandButton.ICON_SHUFFLE_OFF)
                .setDisplayName(if(player.shuffleModeEnabled)"Shuffle off" else "Shuffle").setSessionCommand(carShuffle).setCustomIconResId(R.drawable.car_shuffle)
                .setSlots(CommandButton.SLOT_FORWARD_SECONDARY,CommandButton.SLOT_OVERFLOW).build(),
            CommandButton.Builder(when(player.repeatMode){Player.REPEAT_MODE_ONE->CommandButton.ICON_REPEAT_ONE;Player.REPEAT_MODE_ALL->CommandButton.ICON_REPEAT_ALL;else->CommandButton.ICON_REPEAT_OFF})
                .setDisplayName(when(player.repeatMode){Player.REPEAT_MODE_ONE->"Repeat one";Player.REPEAT_MODE_ALL->"Repeat all";else->"Repeat off"})
                .setSessionCommand(carRepeat).setCustomIconResId(R.drawable.car_repeat).setSlots(CommandButton.SLOT_OVERFLOW).build()
        )
    }
    private fun updateCarButtons() {
        if(!::carLibrary.isInitialized)return
        val buttons=carButtons();session?.setCustomLayout(buttons);session?.setMediaButtonPreferences(buttons)
    }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val nextTrackPreparer = NextTrackPreparer(scope, { SystemClock.elapsedRealtime() })
    private val watchdog = PlaybackWatchdog(scope, { SystemClock.elapsedRealtime() })
    @Volatile private var attempt = UUID.randomUUID().toString()
    private var started = SystemClock.elapsedRealtime()
    private var reported = false
    private var progressed = false
    private var progressPosition = 0L
    private var progressEntry: String? = null
    private var automatic = false
    private var failures = 0
    private var activeDevice: String? = null
    private var deviceSeen = false
    private var takeoverAt = 0L
    private var skippingFailure = false
    private var fallbackUsed = false
    private var lastEntry: String? = null
    private var queueData = org.json.JSONArray()
    private var restoreJob: Job? = null
    private var queueRequested = false
    private val repo get() = app.repository

    override fun onCreate() {
        super.onCreate()
        val resolving = ResolvingDataSource.Factory(OkHttpDataSource.Factory(repo.mediaHttp)) { spec ->
            if(spec.uri.scheme != "sidewave") spec else {
                val key = spec.uri.lastPathSegment ?: throw java.io.IOException("Missing track ID")
                val track = repo.knownTrack(key) ?: throw java.io.IOException("Track information not found")
                try {
                    val trace = spec.uri.getQueryParameter("trace") ?: UUID.randomUUID().toString()
                    val resolved = if(track.kaynak == "kutuphane") repo.absolute("/api/stream/${Uri.encode(track.id)}" + if(spec.uri.host == "transcode") "?format=mp3" else "")
                    else repo.resolveBlocking(track, trace)
                    spec.buildUpon().setUri(Uri.parse(resolved)).setHttpRequestHeaders(spec.httpRequestHeaders + ("x-request-id" to trace)).build()
                } catch(e: Exception) { throw java.io.IOException(e.message ?: "Could not open this recording", e) }
            }
        }
        val cacheSource = CacheDataSource.Factory().setCache(app.offline.cache).setUpstreamDataSourceFactory(resolving)
            .setCacheWriteDataSinkFactory(null)
        val loadPolicy = object : DefaultLoadErrorHandlingPolicy() {
            override fun getRetryDelayMsFor(info: LoadErrorHandlingPolicy.LoadErrorInfo): Long =
                playbackRetryDelay(info.exception, info.errorCount, super.getRetryDelayMsFor(info))
        }
        player = ExoPlayer.Builder(this).setMediaSourceFactory(DefaultMediaSourceFactory(cacheSource).setLoadErrorHandlingPolicy(loadPolicy))
            .setAudioAttributes(AudioAttributes.Builder().setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).setUsage(C.USAGE_MEDIA).build(), true)
            .setHandleAudioBecomingNoisy(true).setWakeMode(C.WAKE_MODE_LOCAL).build()
        player.addAnalyticsListener(PlaybackStatsListener(false) { eventTime, stats ->
            val item = if(eventTime.windowIndex in 0 until eventTime.timeline.windowCount) eventTime.timeline.getWindow(eventTime.windowIndex, Timeline.Window()).mediaItem else null
            val track = item?.trackOrNull()
            if(track != null) {
                val trace = item.localConfiguration?.uri?.getQueryParameter("trace") ?: item.mediaId
                val event = JSONObject().put("id", UUID.randomUUID().toString()).put("event", "summary").put("parca", track.json()).put("requestId", trace)
                    .put("deviceId", repo.deviceId).put("source", track.kaynak).put("playedMs", stats.totalPlayTimeMs).put("rebufferMs", stats.totalRebufferTimeMs)
                    .put("rebuffers", stats.totalRebufferCount).put("appVersion", packageManager.getPackageInfo(packageName, 0).versionName)
                scope.launch(Dispatchers.IO) { runCatching { repo.queueEvent(event) } }
            }
        })
        player.addListener(object : Player.Listener {
            override fun onEvents(player: Player, events: Player.Events) {
                prepareNextTrack()
                if(events.containsAny(Player.EVENT_MEDIA_ITEM_TRANSITION,Player.EVENT_IS_PLAYING_CHANGED,Player.EVENT_PLAYBACK_STATE_CHANGED,Player.EVENT_TIMELINE_CHANGED,Player.EVENT_AVAILABLE_COMMANDS_CHANGED))MusicWidgets.publish(this@PlaybackService,player)
                if(events.containsAny(Player.EVENT_MEDIA_ITEM_TRANSITION,Player.EVENT_SHUFFLE_MODE_ENABLED_CHANGED,Player.EVENT_REPEAT_MODE_CHANGED))updateCarButtons()
            }

            override fun onTimelineChanged(timeline: androidx.media3.common.Timeline, reason: Int) {
                if(reason == Player.TIMELINE_CHANGE_REASON_PLAYLIST_CHANGED) {
                    queueData = (0 until player.mediaItemCount).mapNotNull { player.getMediaItemAt(it).trackOrNull() }.jsonArray()
                    persist()
                }
            }
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                if(reason == Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED && mediaItem?.mediaId == lastEntry) return
                watchdog.cancel()
                lastEntry = mediaItem?.mediaId
                fallbackUsed = mediaItem?.localConfiguration?.customCacheKey?.endsWith(":mp3") == true
                automatic = skippingFailure || reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO
                skippingFailure = false
                levelVolume(mediaItem?.trackOrNull())
                if(!automatic) failures = 0
                attempt = mediaItem?.localConfiguration?.uri?.getQueryParameter("trace") ?: UUID.randomUUID().toString(); started = SystemClock.elapsedRealtime(); reported = false
                progressed = false; progressPosition = player.currentPosition; progressEntry = mediaItem?.mediaId
                if(PlaybackSignals.sleepAtEnd.value && reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO) { player.pause(); PlaybackSignals.sleepAtEnd.value = false }
                PlaybackNotice.delivery.value = if(mediaItem?.trackOrNull()?.let { app.offline.completed(it) } == true) "phone" else PlaybackSignals.deliveries[attempt] ?: if(mediaItem?.trackOrNull()?.kaynak == "kutuphane") "archive" else "online"
                PlaybackNotice.error.value = null; PlaybackNotice.format.value = null
                if(mediaItem != null && player.isPlaying) { reported = true; record("playing") }
                else if(mediaItem != null && player.playWhenReady && player.playbackState == Player.STATE_BUFFERING) armDeadline()
                persist()
            }
            override fun onPositionDiscontinuity(oldPosition: Player.PositionInfo, newPosition: Player.PositionInfo, reason: Int) {
                if(oldPosition.mediaItem?.mediaId != newPosition.mediaItem?.mediaId) {
                    // Only a song that was heard and left early is a skip. Leaving before the first second,
                    // or moving on because the source failed, says nothing about taste.
                    oldPosition.mediaItem?.trackOrNull()?.let { old ->
                        val event = when {
                            reason == Player.DISCONTINUITY_REASON_AUTO_TRANSITION -> "ended"
                            skippingFailure || oldPosition.positionMs < 1000 -> "cancelled"
                            else -> "skip"
                        }
                        record(event, old, oldPosition.positionMs, oldPosition.mediaItem?.localConfiguration?.uri?.getQueryParameter("trace"), if(event == "skip") "user" else null)
                    }
                }
            }
            override fun onTracksChanged(tracks: Tracks) {
                for(group in tracks.groups) if(group.type == C.TRACK_TYPE_AUDIO) {
                    for(index in 0 until group.length) if(group.isTrackSelected(index)) {
                        val format = group.getTrackFormat(index)
                        val codec = when(format.sampleMimeType) { "audio/mpeg" -> "MP3"; "audio/mp4a-latm" -> "AAC"; else -> format.sampleMimeType?.substringAfter('/')?.uppercase() }
                        PlaybackNotice.format.value = listOfNotNull(codec, format.averageBitrate.takeIf { it > 0 }?.let { "${it / 1000} kbps" }).joinToString(" · ").ifBlank { null }
                        return
                    }
                }
            }
            override fun onPlaybackStateChanged(state: Int) {
                when(state) {
                    Player.STATE_BUFFERING -> { if(player.playWhenReady) armDeadline(); record("buffering") }
                    Player.STATE_READY -> { watchdog.cancel() }
                    Player.STATE_ENDED -> { watchdog.cancel(); record("ended"); persist(); PlaybackSignals.sleepAtEnd.value = false }
                    Player.STATE_IDLE -> watchdog.cancel()
                }
            }
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if(isPlaying) {
                    watchdog.cancel(); failures = 0; PlaybackNotice.error.value = null
                    if(!reported) { reported = true; record("playing") }
                }
                persist()
            }
            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                if(!playWhenReady && reason==Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM) PlaybackSignals.sleepAtEnd.value=false
                if(!playWhenReady) { watchdog.cancel(); record("paused"); persist() }
                else { if(!reported) started = SystemClock.elapsedRealtime(); if(player.playbackState == Player.STATE_BUFFERING) armDeadline() }
            }
            override fun onPlayerError(error: PlaybackException) {
                watchdog.cancel()
                val current = player.currentMediaItem
                val track = current?.trackOrNull()
                if(!fallbackUsed && track?.kaynak == "kutuphane" && error.errorCode in listOf(PlaybackException.ERROR_CODE_DECODING_FAILED, PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED, PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED, PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED)) {
                    fallbackUsed = true
                    repo.prefs.edit().putBoolean("compatible:${track.key()}", true).apply()
                    val at = player.currentPosition
                    player.replaceMediaItem(player.currentMediaItemIndex, current.buildUpon().setUri("sidewave://transcode/${Uri.encode(track.key())}").setCustomCacheKey(track.key() + ":mp3").build())
                    player.seekTo(at); player.prepare(); player.play()
                    PlaybackNotice.info.value = "Trying a compatible MP3 version."
                    return
                }
                val api = playbackApiFailure(error)
                val message = api?.message ?: when(error.errorCode) {
                    PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED, PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT -> "Could not connect. Listen to your downloads or try again."
                    PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS -> "This recording is currently unavailable."
                    PlaybackException.ERROR_CODE_DECODING_FAILED, PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED -> "This audio format could not play on your phone."
                    else -> "Could not play this track. Try again or skip to the next song."
                }
                fail(message, api?.code ?: error.errorCodeName)
            }
        })
        carLibrary = CarLibrary(repo, scope) { parent, count -> session?.notifyChildrenChanged(parent, count, null) }
        session = MediaLibrarySession.Builder(this, player, object : MediaLibrarySession.Callback {
                override fun onGetLibraryRoot(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, params: LibraryParams?): ListenableFuture<LibraryResult<MediaItem>> = libraryResult {
                    val root=if(params?.isRecent==true)CarIds.RECENT else if(params?.isOffline==true)CarIds.DOWNLOADS else CarIds.ROOT
                    LibraryResult.ofItem(carLibrary.folder(root,"Sidewave"),carLibrary.rootParams(params))
                }
                override fun onGetItem(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, mediaId: String): ListenableFuture<LibraryResult<MediaItem>> = libraryResult {
                    carLibrary.item(mediaId)?.let { LibraryResult.ofItem(it, null) } ?: LibraryResult.ofError(SessionError.ERROR_BAD_VALUE)
                }
                override fun onGetChildren(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, parentId: String, page: Int, pageSize: Int, params: LibraryParams?): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> = libraryResult {
                    LibraryResult.ofItemList(CarIds.page(carLibrary.children(parentId), page, pageSize), params)
                }
                override fun onSubscribe(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, parentId: String, params: LibraryParams?): ListenableFuture<LibraryResult<Void>> = libraryResult {
                    val count = carLibrary.children(parentId).size
                    withContext(Dispatchers.Main) { session.notifyChildrenChanged(browser, parentId, count, params) }
                    LibraryResult.ofVoid(params)
                }
                override fun onSearch(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, query: String, params: LibraryParams?): ListenableFuture<LibraryResult<Void>> = libraryResult {
                    val count = carLibrary.search(query).size
                    withContext(Dispatchers.Main) { session.notifySearchResultChanged(browser, query, count, params) }
                    LibraryResult.ofVoid(params)
                }
                override fun onGetSearchResult(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, query: String, page: Int, pageSize: Int, params: LibraryParams?): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> = libraryResult {
                    LibraryResult.ofItemList(CarIds.page(carLibrary.search(query), page, pageSize), params)
                }
                override fun onSetMediaItems(mediaSession: MediaSession, controller: MediaSession.ControllerInfo, mediaItems: MutableList<MediaItem>, startIndex: Int, startPositionMs: Long): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
                    val selected = mediaItems.singleOrNull()
                    if(selected == null || !selected.mediaId.startsWith("car:") && selected.requestMetadata.searchQuery.isNullOrBlank())
                        return super.onSetMediaItems(mediaSession, controller, mediaItems, startIndex, startPositionMs)
                    queueRequested = true; restoreJob?.cancel()
                    return future {
                        val (items, index) = selected.requestMetadata.searchQuery?.takeIf { it.isNotBlank() }?.let { carLibrary.search(it) to 0 } ?: carLibrary.queue(selected.mediaId)
                        require(items.isNotEmpty()) { "No matching recording in your saved library" }
                        MediaSession.MediaItemsWithStartPosition(items.map { item->
                            val playable=requireNotNull(item.trackOrNull()).mediaItem(repo)
                            playable.buildUpon().setMediaMetadata(playable.mediaMetadata.buildUpon().setExtras(Bundle(playable.mediaMetadata.extras).apply{putString(MediaConstants.METADATA_KEY_CONTENT_ID,item.mediaId)}).build()).build()
                        }, index, 0)
                    }
                }
                override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult {
                    val car = controller.packageName == "com.google.android.projection.gearhead" &&
                        packageManager.getPackagesForUid(controller.uid)?.contains(controller.packageName) == true
                    if(controller.packageName != packageName && !controller.isTrusted && !car)return MediaSession.ConnectionResult.reject()
                    val base=super.onConnect(session,controller)
                    return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                        .setAvailableSessionCommands(base.availableSessionCommands.buildUpon().add(carLike).add(carShuffle).add(carRepeat).apply{if(controller.packageName==packageName)add(widgetControl)}.build())
                        .setAvailablePlayerCommands(base.availablePlayerCommands).build()
                }
                override fun onCustomCommand(session:MediaSession,controller:MediaSession.ControllerInfo,customCommand:SessionCommand,args:Bundle):ListenableFuture<SessionResult> {
                    when(customCommand.customAction) {
                        widgetControl.customAction -> {
                            if(controller.packageName!=packageName)return Futures.immediateFuture(SessionResult(SessionError.ERROR_PERMISSION_DENIED))
                            return widgetCommand(args)
                        }
                        carShuffle.customAction -> {player.shuffleModeEnabled=!player.shuffleModeEnabled;updateCarButtons();return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))}
                        carRepeat.customAction -> {player.repeatMode=when(player.repeatMode){Player.REPEAT_MODE_OFF->Player.REPEAT_MODE_ALL;Player.REPEAT_MODE_ALL->Player.REPEAT_MODE_ONE;else->Player.REPEAT_MODE_OFF};updateCarButtons();return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))}
                        carLike.customAction -> {
                            val track=player.currentMediaItem?.trackOrNull() ?: return Futures.immediateFuture(SessionResult(SessionError.ERROR_INVALID_STATE))
                            val value=!carLibrary.isFavorite(track)
                            return future {
                                try {repo.favorite(track,value);withContext(Dispatchers.Main){carLibrary.favoriteChanged();updateCarButtons()};SessionResult(SessionResult.RESULT_SUCCESS)}
                                catch(e:CancellationException){throw e}
                                catch(_:Exception){SessionResult(SessionError.ERROR_IO)}
                            }
                        }
                    }
                    return super.onCustomCommand(session,controller,customCommand,args)
                }
                override fun onAddMediaItems(mediaSession: MediaSession, controller: MediaSession.ControllerInfo, mediaItems: MutableList<MediaItem>): ListenableFuture<MutableList<MediaItem>> {
                    queueRequested = true
                    restoreJob?.cancel()
                    val result = SettableFuture.create<MutableList<MediaItem>>()
                    val job = scope.launch {
                        try {
                            val prepared = withContext(Dispatchers.IO) {
                                mediaItems.map { item ->
                                    val track = requireNotNull(item.trackOrNull() ?: carLibrary.item(item.mediaId)?.trackOrNull()) { "Track information not found" }
                                    ensureActive()
                                    repo.saveTrack(track)
                                    track.mediaItem(repo)
                                }.toMutableList()
                            }
                            result.set(prepared)
                        } catch(e: CancellationException) { result.cancel(false) }
                        catch(e: Exception) {
                            PlaybackNotice.error.value = "Could not prepare your queue. Check available storage and try again."
                            result.setException(e)
                        }
                    }
                    result.addListener({ if(result.isCancelled) job.cancel() }, mainExecutor)
                    return result
                }
            }).setCustomLayout(carButtons()).setMediaButtonPreferences(carButtons()).setSessionExtras(Bundle().apply {
                putBoolean(MediaConstants.SESSION_EXTRAS_KEY_SLOT_RESERVATION_SKIP_TO_PREV,true)
                putBoolean(MediaConstants.SESSION_EXTRAS_KEY_SLOT_RESERVATION_SKIP_TO_NEXT,true)
            }).setSessionActivity(PendingIntent.getActivity(this, 0,
                Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)).build()
        restore()
        scope.launch { repo.favoriteChanges.collect { MusicWidgets.publish(this@PlaybackService,player) } }
        scope.launch {
            app.offline.items.collect { items ->
                val count=items.count { it.state==androidx.media3.exoplayer.offline.Download.STATE_COMPLETED }
                session?.notifyChildrenChanged(CarIds.DOWNLOADS,minOf(count,CarIds.WINDOW)+(if(count>CarIds.WINDOW)1 else 0),null)
            }
        }
        scope.launch {
            while(isActive) {
                delay(200)
                player.pauseAtEndOfMediaItems=PlaybackSignals.sleepAtEnd.value
                if(PlaybackSignals.sleepUntil.value > 0 && SystemClock.elapsedRealtime() >= PlaybackSignals.sleepUntil.value) { player.pause(); PlaybackSignals.sleepUntil.value = 0 }
                if(!progressed && player.isPlaying && player.currentMediaItem?.mediaId == progressEntry && player.currentPosition > progressPosition + 25) {
                    progressed = true; PlaybackNotice.delivery.value = PlaybackSignals.deliveries[attempt] ?: PlaybackNotice.delivery.value
                    record("progress")
                }
                if(PlaybackSignals.deliveries.size > 200) PlaybackSignals.deliveries.keys.filter { it != attempt }.take(100).forEach { PlaybackSignals.deliveries.remove(it) }
            }
        }
        scope.launch {
            while(isActive) {
                delay(5000)
                prepareNextTrack()
                persist()
                runCatching { syncDevice() }
                runCatching { repo.flushEvents(); repo.syncFavorites() }
            }
        }
    }
    private fun prepareNextTrack() {
        // Media3 supplies the actual next entry, including shuffle and repeat-all.
        val index = if(player.isPlaying && player.repeatMode != Player.REPEAT_MODE_ONE) player.nextMediaItemIndex else C.INDEX_UNSET
        val item = if(index != C.INDEX_UNSET) player.getMediaItemAt(index) else null
        val track = item?.trackOrNull()?.takeIf { it.kaynak == "youtube" && it.key() != player.currentMediaItem?.trackOrNull()?.key() }
        nextTrackPreparer.schedule(track?.let { repo.base + ":" + it.key() }) {
            if(track != null) withContext(Dispatchers.IO) {
                if(app.offline.downloadedItem(track) == null) repo.prefetch(track)
            }
        }
    }
    private fun widgetCommand(args:Bundle):ListenableFuture<SessionResult> {
        val result=SettableFuture.create<SessionResult>()
        scope.launch {
            try {
                restoreJob?.join()
                require(args.getString("scope")==CarArtwork.scope(repo) && MusicWidgets.signedIn(repo))
                when(args.getString("command")) {
                    "toggle" -> {
                        require(player.mediaItemCount>0)
                        if(player.isPlaying || player.playWhenReady && player.playbackState==Player.STATE_BUFFERING)player.pause() else {
                            if(player.playbackState==Player.STATE_ENDED)player.seekToDefaultPosition()
                            startWidgetPlayback()
                        }
                    }
                    "next" -> if(player.hasNextMediaItem())player.seekToNextMediaItem()
                    "previous" -> if(player.currentPosition>3000 || !player.hasPreviousMediaItem())player.seekTo(0) else player.seekToPreviousMediaItem()
                    "favorite" -> {
                        val track=requireNotNull(player.currentMediaItem?.trackOrNull())
                        withContext(Dispatchers.IO){repo.favorite(track,!carLibrary.isFavorite(track))}
                        carLibrary.favoriteChanged();updateCarButtons()
                    }
                    "recent" -> {
                        val (items,index)=withContext(Dispatchers.IO){
                            val tracks=MusicWidgets.recentTracks(repo)
                            val index=tracks.indexOfFirst{it.key()==args.getString("key")}
                            require(index>=0)
                            tracks.map{repo.saveTrack(it);it.mediaItem(repo)} to index
                        }
                        require(args.getString("scope")==CarArtwork.scope(repo) && MusicWidgets.signedIn(repo))
                        queueRequested=true;restoreJob?.cancel();player.setMediaItems(items,index,0);startWidgetPlayback()
                    }
                    else -> throw IllegalArgumentException("Unknown widget command")
                }
                MusicWidgets.publish(this@PlaybackService,player)
                result.set(SessionResult(SessionResult.RESULT_SUCCESS))
            } catch(e:CancellationException){result.cancel(false)}
            catch(_:Exception){result.set(SessionResult(SessionError.ERROR_INVALID_STATE))}
        }
        return result
    }
    private suspend fun startWidgetPlayback() {
        if(player.playbackState==Player.STATE_IDLE || player.playbackState==Player.STATE_ENDED)player.prepare()
        // Android 15 requires an active media foreground service before audio focus.
        // Media3 normally promotes after play(); a cold widget must promote first.
        if(android.os.Build.VERSION.SDK_INT>=35 && !isPlaybackOngoing) {
            withTimeout(2500) {
                while(!isPlaybackOngoing) { onUpdateNotification(requireNotNull(session),true);delay(50) }
            }
        }
        player.play()
    }
    private fun armDeadline() {
        val expectedAttempt = attempt
        watchdog.arm(expectedAttempt, started, reported) {
            if(attempt == expectedAttempt && player.playWhenReady && player.playbackState == Player.STATE_BUFFERING) {
                val stalled = reported
                player.stop()
                fail(if(stalled) "Playback has stalled. Try again or skip to the next song."
                    else "This track could not start. Try again or skip to the next song.",
                    if(stalled) "BUFFER_TIMEOUT" else "START_TIMEOUT")
            }
        }
    }
    private fun fail(message: String, code: String = "PLAYBACK_FAILED") {
        val trace = attempt
        val elapsed = SystemClock.elapsedRealtime() - started
        scope.launch(Dispatchers.IO) { app.diagnostics.recordPlaybackFailure(code, trace, elapsed) }
        record("error"); failures++
        PlaybackNotice.error.value = message
        if(automatic && failures < 3 && player.hasNextMediaItem()) {
            PlaybackNotice.info.value = "$message Next tracks deneniyor."
            skippingFailure = true; player.seekToNextMediaItem(); automatic = true; player.prepare(); player.play()
        } else { player.pause(); if(failures >= 3) PlaybackNotice.error.value = "Three tracks could not play. Check your connection and try again." }
    }
    private fun record(event: String, trackOverride: Parca? = null, positionOverride: Long? = null, traceOverride: String? = null, reason: String? = null) {
        val track = trackOverride ?: player.currentMediaItem?.trackOrNull() ?: return
        val eventId = UUID.randomUUID().toString()
        val data = JSONObject().put("id", eventId).put("eventId", eventId).put("requestId", traceOverride ?: attempt)
            .put("occurredAt", System.currentTimeMillis()).put("deviceId", repo.deviceId).put("event", event).put("trackId", track.appId ?: track.key())
            .put("appVersion", packageManager.getPackageInfo(packageName, 0).versionName).put("delivery", PlaybackNotice.delivery.value).put("source", track.kaynak).put("elapsedMs", SystemClock.elapsedRealtime() - started)
            .put("position", (positionOverride ?: player.currentPosition) / 1000.0).put("parca", track.json())
        if(reason != null) data.put("reason", reason)
        if(event in listOf("playing", "paused", "ended")) { val state = snapshot(); data.put("queue", state.getJSONArray("queue")).put("index", state.getInt("index")) }
        scope.launch(Dispatchers.IO) { runCatching { repo.queueEvent(data); repo.flushEvents() }.onFailure { PlaybackNotice.info.value = "Could not save listening history. Check available storage." } }
    }
    private fun snapshot(): JSONObject {
        return JSONObject().put("queue", queueData).put("index", player.currentMediaItemIndex.coerceAtLeast(0))
            .put("position", player.currentPosition / 1000.0).put("repeat", player.repeatMode)
            .put("shuffle", player.shuffleModeEnabled).put("volume", player.volume.toDouble())
            .put("state", if(player.isPlaying) "playing" else "paused")
    }
    private fun persist() { if(::player.isInitialized) { val data = snapshot(); scope.launch(Dispatchers.IO) { runCatching { repo.save("playback", data) } } } }
    private fun restore() {
        restoreJob = scope.launch {
            try {
                val restored = withContext(Dispatchers.IO) {
                    val state = repo.cached("playback") ?: return@withContext null
                    val tracks = state.tracks("queue")
                    if(tracks.isEmpty()) return@withContext null
                    val items = tracks.map { track -> ensureActive(); repo.saveTrack(track); track.mediaItem(repo) }
                    state to items
                } ?: return@launch
                if(queueRequested || player.mediaItemCount != 0) return@launch
                val (state, items) = restored
                val position = state.optDouble("position", 0.0).takeIf { it.isFinite() && it >= 0 } ?: 0.0
                player.setMediaItems(items, state.optInt("index").coerceIn(items.indices), (position * 1000).toLong())
                player.repeatMode = state.optInt("repeat", Player.REPEAT_MODE_OFF).coerceIn(0, 2)
                player.shuffleModeEnabled = state.optBoolean("shuffle")
                player.volume = state.optDouble("volume", 1.0).takeIf { it.isFinite() }?.toFloat()?.coerceIn(0f,1f) ?: 1f
                player.playWhenReady = false
            } catch(e: CancellationException) { throw e }
            catch(_: Exception) { PlaybackNotice.info.value = "Could not restore your queue. Choose a song to continue." }
        }
    }
    // Even volume: attenuate loud recordings towards -14 LUFS using the server's loudness value.
    // Without a value (offline, unknown) the track plays unchanged.
    private var levelJob: Job? = null
    private fun levelVolume(track: Parca?) {
        levelJob?.cancel()
        if(track == null || !repo.prefs.getBoolean("evenVolume", true)) { player.volume = 1f; return }
        levelJob = scope.launch {
            val gain = runCatching { repo.fetch("/api/v1/playback/loudness?kaynak=${java.net.URLEncoder.encode(track.kaynak, "UTF-8")}&id=${java.net.URLEncoder.encode(track.id, "UTF-8")}").optDouble("gain", 1.0) }.getOrDefault(1.0)
            player.volume = gain.toFloat().takeIf { it.isFinite() }?.coerceIn(0.05f, 1f) ?: 1f
        }
    }
    private suspend fun syncDevice() {
        val data = snapshot().put("name", "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}")
        val expectedRevision=repo.prefs.getInt("queueRevision", 0)
        data.put("queueRevision", expectedRevision)
        val saved = try { repo.fetch("/api/v1/devices/${repo.deviceId}", "PUT", data) } catch(e: ApiFailure) {
            // A web tab or reinstall advanced this device's revision. Adopt the server's revision so the
            // next heartbeat succeeds instead of failing on every sync.
            if(e.code != "DEVICE_CONFLICT") throw e
            val server = repo.fetch("/api/v1/devices").optJSONArray("devices")?.let { list -> (0 until list.length()).map { list.getJSONObject(it) }.firstOrNull { it.optString("id") == repo.deviceId } }
            if(repo.prefs.getInt("queueRevision",0)==expectedRevision) repo.prefs.edit().putInt("queueRevision", server?.optInt("queueRevision") ?: 0).apply()
            return
        }
        if(repo.prefs.getInt("queueRevision",0)==expectedRevision) repo.prefs.edit().putInt("queueRevision", saved.optInt("queueRevision")).apply()
        val devices = repo.fetch("/api/v1/devices")
        val current = devices.textOrNull("activeDeviceId")
        val changedAt = devices.optLong("takeoverAt", 0L)
        if(deviceSeen && changedAt > takeoverAt && current != null && current != repo.deviceId && player.isPlaying) {
            player.pause(); PlaybackNotice.info.value = "Music is playing on another device."
        }
        activeDevice = current; takeoverAt = changedAt; deviceSeen = true
    }
    private fun <T> future(block: suspend () -> T): ListenableFuture<T> {
        val result = SettableFuture.create<T>()
        val job = scope.launch(Dispatchers.IO) {
            try { result.set(block()) }
            catch(e: CancellationException) { result.cancel(false) }
            catch(e: Exception) { result.setException(e) }
        }
        result.addListener({ if(result.isCancelled) job.cancel() }, mainExecutor)
        return result
    }
    private fun <T : Any> libraryResult(block: suspend () -> LibraryResult<T>): ListenableFuture<LibraryResult<T>> {
        val result = SettableFuture.create<LibraryResult<T>>()
        val job = scope.launch(Dispatchers.IO) {
            try { result.set(block()) }
            catch(e: CancellationException) { result.cancel(false) }
            catch(_: IllegalArgumentException) { result.set(LibraryResult.ofError<T>(SessionError.ERROR_BAD_VALUE)) }
            catch(e: ApiFailure) { result.set(LibraryResult.ofError<T>(SessionError(if(e.code=="AUTH_REQUIRED")SessionError.ERROR_SESSION_AUTHENTICATION_EXPIRED else SessionError.ERROR_IO,e.message ?: "Could not connect."))) }
            catch(_: Exception) { result.set(LibraryResult.ofError<T>(SessionError(SessionError.ERROR_IO,"Connect or open Downloads."))) }
        }
        result.addListener({ if(result.isCancelled) job.cancel() }, mainExecutor)
        return result
    }
    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? = session
    override fun onDestroy() {
        if(::player.isInitialized) { MusicWidgets.publish(this,player,stopped=true);runCatching { repo.save("playback", snapshot()) }; player.release() }
        nextTrackPreparer.cancel(); watchdog.cancel(); session?.release(); scope.cancel(); super.onDestroy()
    }
}
