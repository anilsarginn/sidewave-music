package com.sarginlabs.sidewave

import android.app.Application
import android.app.Notification
import android.content.Context
import android.net.Uri
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.NoOpCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.offline.DownloadManager
import androidx.media3.exoplayer.offline.DownloadNotificationHelper
import androidx.media3.exoplayer.offline.DownloadRequest
import androidx.media3.exoplayer.offline.DownloadService
import androidx.media3.exoplayer.scheduler.PlatformScheduler
import androidx.media3.exoplayer.scheduler.Requirements
import androidx.media3.exoplayer.scheduler.Scheduler
import com.sarginlabs.sidewave.api.Parca
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File
import java.util.concurrent.Executors

@UnstableApi
class SidewaveApplication : Application() {
    lateinit var diagnostics: CrashDiagnostics; private set
    lateinit var repository: Repository; private set
    lateinit var offline: OfflineLibrary; private set
    override fun onCreate() { super.onCreate(); diagnostics = CrashDiagnostics(this).also { it.install() }; repository = Repository(this); coil.Coil.setImageLoader(coil.ImageLoader.Builder(this).okHttpClient(repository.http).build()); offline = OfflineLibrary(this, repository); MusicWidgets.initialize(this) }
}
@get:UnstableApi
val Context.app: SidewaveApplication get() = applicationContext as SidewaveApplication

data class OfflineItem(val track: Parca, val state: Int, val bytes: Long, val percent: Float, val stopped: Boolean, val failure: Int)

@UnstableApi
class OfflineLibrary(private val context: Context, private val repo: Repository) {
    private val database = StandaloneDatabaseProvider(context)
    val cache = SimpleCache(File(context.filesDir, "downloads"), NoOpCacheEvictor(), database)
    private val upstream = OkHttpDataSource.Factory(repo.mediaHttp).setUserAgent("Sidewave/1.0 Android")
    val manager = DownloadManager(context, database, cache, upstream, Executors.newFixedThreadPool(2))
    private val _items = MutableStateFlow<List<OfflineItem>>(emptyList())
    val items = _items.asStateFlow()
    val bytes get() = cache.cacheSpace
    var wifiOnly: Boolean
        get() = repo.prefs.getBoolean("wifiOnly", true)
        set(value) {
            repo.prefs.edit().putBoolean("wifiOnly", value).apply()
            DownloadService.sendSetRequirements(context, OfflineDownloadService::class.java, requirements(value), false)
        }
    init {
        manager.maxParallelDownloads = 2
        manager.minRetryCount = 2
        manager.setRequirements(requirements(wifiOnly))
        manager.addListener(object : DownloadManager.Listener {
            override fun onInitialized(downloadManager: DownloadManager) { refresh() }
            override fun onDownloadChanged(downloadManager: DownloadManager, download: Download, finalException: Exception?) { refresh() }
            override fun onDownloadRemoved(downloadManager: DownloadManager, download: Download) { refresh() }
        })
        refresh()
    }
    private fun requirements(wifi: Boolean) = Requirements(Requirements.NETWORK or (if(wifi) Requirements.NETWORK_UNMETERED else 0))
    fun refresh() {
        runCatching {
            val output = mutableListOf<OfflineItem>()
            manager.downloadIndex.getDownloads().use { cursor ->
                while(cursor.moveToNext()) {
                    val d = cursor.download
                    val track = runCatching { org.json.JSONObject(String(d.request.data)).track() }.getOrNull() ?: continue
                    output += OfflineItem(track, d.state, d.bytesDownloaded, d.percentDownloaded, d.stopReason != 0, d.failureReason)
                }
            }
            _items.value = output
        }
    }
    fun completed(key: String) = runCatching { manager.downloadIndex.getDownload(key)?.state == Download.STATE_COMPLETED }.getOrDefault(false)
    private fun downloadedKey(track: Parca): String? {
        if(completed(track.key())) return track.key()
        if(track.appId == null) return null
        return _items.value.firstOrNull { it.state == Download.STATE_COMPLETED && it.track.appId == track.appId }?.track?.key()
    }
    fun completed(track: Parca) = downloadedKey(track) != null
    fun downloadedItem(track: Parca) = downloadedKey(track)?.let { key -> runCatching { manager.downloadIndex.getDownload(key)?.request?.toMediaItem() }.getOrNull() }
    fun download(track: Parca, compatible: Boolean = false) {
        require(track.kaynak == "kutuphane") { "Save to your library before downloading to your phone." }
        repo.saveTrack(track)
        val transcode = compatible || repo.prefs.getBoolean("compatible:${track.key()}", false)
        val cacheKey = track.key() + if(transcode) ":mp3" else ""
        val previous = runCatching { manager.downloadIndex.getDownload(track.key()) }.getOrNull()
        if(previous != null && previous.request.customCacheKey != cacheKey) remove(track)
        val request = DownloadRequest.Builder(track.key(), Uri.parse(repo.absolute("/api/stream/${Uri.encode(track.id)}" + if(transcode) "?format=mp3" else "")))
            .setCustomCacheKey(cacheKey).setData(track.json().toString().toByteArray()).build()
        DownloadService.sendAddDownload(context, OfflineDownloadService::class.java, request, false)
    }
    fun pause(track: Parca, paused: Boolean) = DownloadService.sendSetStopReason(context, OfflineDownloadService::class.java, track.key(), if(paused) 1 else 0, false)
    fun remove(track: Parca) = DownloadService.sendRemoveDownload(context, OfflineDownloadService::class.java, (downloadedKey(track) ?: track.key()), false)
}

@UnstableApi
class OfflineDownloadService : DownloadService(202, DEFAULT_FOREGROUND_NOTIFICATION_UPDATE_INTERVAL, "sidewave-downloads", R.string.downloads_channel, 0) {
    private val notificationHelper by lazy { DownloadNotificationHelper(this, "sidewave-downloads") }
    override fun getDownloadManager() = app.offline.manager
    override fun getScheduler(): Scheduler = PlatformScheduler(this, 203)
    override fun getForegroundNotification(downloads: MutableList<Download>, notMetRequirements: Int): Notification =
        notificationHelper.buildProgressNotification(this, R.drawable.ic_music, null,
            if(notMetRequirements != 0) "Waiting for Wi-Fi" else "Preparing offline music", downloads, notMetRequirements)
}
