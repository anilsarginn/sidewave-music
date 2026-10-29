package com.sarginlabs.sidewave

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.*
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import android.widget.Toast
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import com.sarginlabs.sidewave.api.Parca
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import okhttp3.HttpUrl.Companion.toHttpUrl
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal fun widgetRecentTracks(tracks: List<Parca>, current: Parca?): List<Parca> =
    tracks.distinctBy { it.appId ?: it.key() }.filterNot { current?.sameRecording(it) == true }.take(3)

internal data class WidgetPlayback(val scope: String, val track: Parca?, val playing: Boolean = false,
    val previous: Boolean = false, val next: Boolean = false, val liked: Boolean = false)

/** Launcher receives bounded bitmaps and explicit immutable intents, never session cookies or URLs. */
@UnstableApi
internal object MusicWidgets {
    const val COMMAND = "widget.control"
    private val workers = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val renderLock = Mutex()
    @Volatile private var live: WidgetPlayback? = null
    private var listener: SharedPreferences.OnSharedPreferenceChangeListener? = null
    private val providers = listOf(MiniPlayerWidget::class.java, NowPlayingWidget::class.java, YourMusicWidget::class.java)
    private val covers = android.util.LruCache<String, Bitmap>(12)

    fun initialize(context: Context) {
        listener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
            if (key in setOf("member-cookie", "member-id", "server")) refresh(context)
        }.also { context.app.repository.prefs.registerOnSharedPreferenceChangeListener(it) }
        refresh(context)
    }

    fun publish(context: Context, player: Player, stopped: Boolean = false) {
        val repo = context.app.repository
        val track = player.currentMediaItem?.trackOrNull()
        val value = WidgetPlayback(CarArtwork.scope(repo), track, !stopped && player.isPlaying,
            track != null,
            player.hasNextMediaItem(), repo.cached("/api/favoriler")?.tracks().orEmpty().any { track?.sameRecording(it) == true })
        if (value == live) return
        val previous = live
        live = value
        if (value.playing && track != null && (previous?.scope != value.scope || previous.track?.sameRecording(track) != true)) {
            workers.launch {
                try { renderLock.withLock {
                    if (CarArtwork.scope(repo) == value.scope && signedIn(repo)) {
                        val recent = (listOf(track) + recentTracks(repo)).distinctBy { it.appId ?: it.key() }.take(20)
                        repo.save("widget-recent:${value.scope}", JSONObject().put("parcalar", recent.jsonArray()))
                    }
                    renderAll(context.applicationContext)
                } } catch (_: Exception) { /* Widget updates must never interrupt playback. */ }
            }
        } else refresh(context)
    }

    fun refresh(context: Context, finished: () -> Unit = {}) {
        val appContext = context.applicationContext
        workers.launch {
            try { renderLock.withLock { renderAll(appContext) } }
            catch (_: Exception) { /* A removed widget or temporary artwork failure never interrupts playback. */ }
            finally { finished() }
        }
    }

    fun signedIn(repo: Repository) = repo.memberCookies.loadForRequest(repo.base.toHttpUrl()).isNotEmpty() ||
        repo.memberCookies.offline && repo.prefs.getString("member-id", null) != null

    fun recentTracks(repo: Repository) = (repo.cached("widget-recent:${CarArtwork.scope(repo)}")?.tracks().orEmpty() +
        repo.cached("/api/v1/history")?.tracks().orEmpty()).distinctBy { it.appId ?: it.key() }.take(20)

    private suspend fun renderAll(context: Context) {
        val manager = AppWidgetManager.getInstance(context)
        val installed = providers.flatMap { provider -> manager.getAppWidgetIds(ComponentName(context, provider)).map { it to provider } }
        if (installed.isEmpty()) return
        val repo = context.app.repository
        val account = CarArtwork.scope(repo)
        val signed = signedIn(repo)
        val snapshot = if (!signed) WidgetPlayback(account, null) else live?.takeIf { it.scope == account } ?: run {
            val saved = repo.cached("playback")
            val queue = saved?.tracks("queue").orEmpty()
            val index = saved?.optInt("index", 0)?.coerceIn(0, (queue.size - 1).coerceAtLeast(0)) ?: 0
            val track = queue.getOrNull(index)
            WidgetPlayback(account, track, previous = track != null, next = index < queue.lastIndex,
                liked = repo.cached("/api/favoriler")?.tracks().orEmpty().any { track?.sameRecording(it) == true })
        }
        val recent = if (signed) widgetRecentTracks(recentTracks(repo), snapshot.track) else emptyList()
        val images = coroutineScope {
            (listOf(snapshot.track) + recent).distinctBy { it?.key() }.map { track -> async { track?.key() to cover(context, track) } }.awaitAll().toMap()
        }
        installed.forEach { (id, provider) ->
            val options = manager.getAppWidgetOptions(id)
            val large = provider == YourMusicWidget::class.java && options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 250) >= 230
            val layout = when { provider == MiniPlayerWidget::class.java -> R.layout.widget_mini; large -> R.layout.widget_library; else -> R.layout.widget_player }
            val view = RemoteViews(context.packageName, layout)
            val open = PendingIntent.getActivity(context, 7100, Intent(context, MainActivity::class.java).setAction("com.sarginlabs.sidewave.WIDGET_OPEN"), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            view.setOnClickPendingIntent(R.id.widget_root, open)
            view.setTextViewText(R.id.widget_title, snapshot.track?.baslik ?: "Your next favorite awaits")
            view.setTextViewText(R.id.widget_artist, snapshot.track?.sanatci?.takeIf { it.isNotBlank() } ?: if (signed) "Open Sidewave to choose a song" else "Sign in to start listening")
            view.setImageViewBitmap(R.id.widget_cover, images[snapshot.track?.key()])
            view.setContentDescription(R.id.widget_cover, snapshot.track?.let { "${it.baslik} — ${it.sanatci}" } ?: "Sidewave")
            view.setImageViewResource(R.id.widget_play, if (snapshot.playing) R.drawable.widget_pause else R.drawable.widget_play)
            view.setContentDescription(R.id.widget_play, if (snapshot.playing) "Pause" else "Play")
            view.setOnClickPendingIntent(R.id.widget_play, if (snapshot.track != null) action(context, "toggle", account) else open)
            view.setOnClickPendingIntent(R.id.widget_next, if (snapshot.track != null) action(context, "next", account) else open)
            view.setFloat(R.id.widget_next, "setAlpha", if (snapshot.next) 1f else 0.35f)
            if (layout != R.layout.widget_mini) {
                view.setTextViewText(R.id.widget_status, if (snapshot.playing) "NOW PLAYING" else "MADE FOR YOUR MOMENT")
                view.setOnClickPendingIntent(R.id.widget_previous, if (snapshot.track != null) action(context, "previous", account) else open)
                view.setFloat(R.id.widget_previous, "setAlpha", if (snapshot.previous) 1f else 0.35f)
                view.setImageViewResource(R.id.widget_like, if (snapshot.liked) R.drawable.car_heart else R.drawable.car_heart_outline)
                view.setInt(R.id.widget_like, "setColorFilter", if (snapshot.liked) Color.rgb(83, 216, 128) else Color.WHITE)
                view.setContentDescription(R.id.widget_like, if (snapshot.liked) "Remove from Liked Songs" else "Add to Liked Songs")
                view.setOnClickPendingIntent(R.id.widget_like, if (snapshot.track != null) action(context, "favorite", account) else open)
            }
            if (large) {
                val slots = listOf(Triple(R.id.widget_recent_1, R.id.widget_art_1, R.id.widget_text_1), Triple(R.id.widget_recent_2, R.id.widget_art_2, R.id.widget_text_2), Triple(R.id.widget_recent_3, R.id.widget_art_3, R.id.widget_text_3))
                view.setTextViewText(R.id.widget_recent_label, if (recent.isEmpty()) "A LITTLE MORE YOU" else "PLAY IT AGAIN")
                slots.forEachIndexed { index, (root, art, title) ->
                    val track = recent.getOrNull(index)
                    view.setTextViewText(title, track?.baslik ?: listOf("Your music", "Your rhythm", "Your moment")[index])
                    view.setImageViewBitmap(art, images[track?.key()] ?: cover(context, null))
                    view.setContentDescription(root, track?.let { "Play ${it.baslik} by ${it.sanatci}" } ?: "Open Sidewave")
                    view.setOnClickPendingIntent(root, track?.let { action(context, "recent", account, it.key()) } ?: open)
                }
            }
            // A logout/server/account switch during artwork loading must not publish the old account.
            if (CarArtwork.scope(repo) == account && signedIn(repo) == signed) manager.updateAppWidget(id, view)
        }
    }

    private fun action(context: Context, command: String, account: String, key: String? = null): PendingIntent {
        val intent = Intent(context, WidgetActionReceiver::class.java).setAction("com.sarginlabs.sidewave.WIDGET_CONTROL")
            .setData(Uri.parse("sidewave-widget://$command/$account/${digest(key.orEmpty())}"))
            .putExtra("command", command).putExtra("scope", account).putExtra("key", key)
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun cover(context: Context, track: Parca?): Bitmap {
        val repo = context.app.repository
        val key = CarArtwork.scope(repo) + ":" + (track?.key() ?: "placeholder") + ":" + System.currentTimeMillis() / 300_000
        covers.get(key)?.let { return it }
        val source = track?.let { runCatching { BitmapFactory.decodeFile(CarArtwork.open(context, CarArtwork.trackUri(repo, it)).path) }.getOrNull() }
        val bitmap = Bitmap.createBitmap(160, 160, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        canvas.drawRoundRect(0f, 0f, 160f, 160f, 16f, 16f, paint)
        paint.xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_IN)
        if (source != null) {
            val side = minOf(source.width, source.height)
            canvas.drawBitmap(source, Rect((source.width - side) / 2, (source.height - side) / 2, (source.width + side) / 2, (source.height + side) / 2), RectF(0f, 0f, 160f, 160f), paint)
            source.recycle()
        } else {
            paint.shader = LinearGradient(0f, 0f, 160f, 160f, Color.rgb(46, 100, 73), Color.rgb(13, 30, 25), Shader.TileMode.CLAMP)
            canvas.drawRect(0f, 0f, 160f, 160f, paint); paint.shader = null; paint.xfermode = null
            paint.color = Color.rgb(83, 216, 128); paint.strokeWidth = 7f; paint.strokeCap = Paint.Cap.ROUND
            listOf(15f, 29f, 42f, 24f, 12f).forEachIndexed { i, height -> canvas.drawLine(45f + i * 18, 80f - height / 2, 45f + i * 18, 80f + height / 2, paint) }
        }
        covers.put(key, bitmap)
        return bitmap
    }
}

@UnstableApi
open class MusicWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) { val pending = goAsync(); MusicWidgets.refresh(context) { pending.finish() } }
    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) { val pending = goAsync(); MusicWidgets.refresh(context) { pending.finish() } }
}
@UnstableApi class MiniPlayerWidget : MusicWidgetProvider()
@UnstableApi class NowPlayingWidget : MusicWidgetProvider()
@UnstableApi class YourMusicWidget : MusicWidgetProvider()

internal suspend fun <T> ListenableFuture<T>.widgetAwait(context: Context): T = suspendCancellableCoroutine { continuation ->
    addListener({ if (continuation.isActive) runCatching { get() }.fold({ continuation.resume(it) }, { continuation.resumeWithException(it) }) }, context.mainExecutor)
    continuation.invokeOnCancellation { cancel(false) }
}

/** Bound controller lets Media3 own foreground-service and notification lifecycles. */
@UnstableApi
class WidgetActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != "com.sarginlabs.sidewave.WIDGET_CONTROL") return
        val pending = goAsync()
        val appContext = context.applicationContext
        val work = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        work.launch {
            var connection: ListenableFuture<MediaController>? = null
            try {
                withTimeout(8000) {
                    connection = MediaController.Builder(appContext, SessionToken(appContext, ComponentName(appContext, PlaybackService::class.java))).buildAsync()
                    val controller = connection!!.widgetAwait(context)
                    val args = Bundle().apply { putString("command", intent.getStringExtra("command")); putString("scope", intent.getStringExtra("scope")); putString("key", intent.getStringExtra("key")) }
                    val result = controller.sendCustomCommand(SessionCommand(MusicWidgets.COMMAND, Bundle.EMPTY), args).widgetAwait(context)
                    if (result.resultCode != 0) Toast.makeText(context, "Open Sidewave and choose a song.", Toast.LENGTH_SHORT).show()
                }
            } catch (error: Exception) { android.util.Log.w("SidewaveWidget", "Playback control failed", error); Toast.makeText(appContext, "Open Sidewave to continue listening.", Toast.LENGTH_SHORT).show() }
            finally { connection?.let { MediaController.releaseFuture(it) }; MusicWidgets.refresh(context); pending.finish(); work.cancel() }
        }
    }
}
