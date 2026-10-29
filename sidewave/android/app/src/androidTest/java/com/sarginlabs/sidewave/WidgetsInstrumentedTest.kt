package com.sarginlabs.sidewave

import android.appwidget.AppWidgetHost
import android.appwidget.AppWidgetHostView
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.widget.TextView
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionToken
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.sarginlabs.sidewave.api.Parca
import okhttp3.Cookie
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.ServerSocket
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Real launcher RemoteViews and background Media3 controls, using isolated on-device audio. */
@RunWith(AndroidJUnit4::class)
@UnstableApi
class WidgetsInstrumentedTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val repo get() = context.app.repository
    private fun <T> main(block: () -> T): T { var result: T? = null; instrumentation.runOnMainSync { result = block() }; @Suppress("UNCHECKED_CAST") return result as T }
    private fun until(label: String, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + 12000
        while (System.currentTimeMillis() < deadline) { if (condition()) return; Thread.sleep(100) }
        fail("Timed out: $label")
    }

    @Test fun launcherWidgetsRenderResizeAndControlAColdPlaybackServiceWithoutOpeningTheApp() {
        val server = AudioServer(context)
        val previousServer = repo.base
        val output = File(context.getExternalFilesDir(null), "widget-evidence").apply { mkdirs() }
        val host = main { AppWidgetHost(context, 9022).apply { startListening() } }
        var controller: MediaController? = null
        try {
            main { repo.base = "http://127.0.0.1:${server.port}" }
            val url = "${repo.base}/api/auth/login".toHttpUrl()
            main {
                repo.prefs.edit().putString("member-id", "widget-qa").commit()
                repo.memberCookies.saveFromResponse(url, listOf(Cookie.parse(url, "sidewave_music_session=widget-qa; Path=/; HttpOnly; Max-Age=3600")!!))
                repo.memberCookies.required = false
            }
            val tracks = listOf(Parca(id="night", baslik="Night Drive", sanatci="Sidewave Sessions", kaynak="kutuphane"), Parca(id="hours", baslik="After Hours", sanatci="The Evening Edit", kaynak="kutuphane"), Parca(id="focus", baslik="Soft Focus", sanatci="Slow Sundays", kaynak="kutuphane"), Parca(id="morning", baslik="Morning Light", sanatci="Fresh Starts", kaynak="kutuphane"))
            tracks.forEach(repo::saveTrack)
            repo.save("playback", JSONObject().put("queue", tracks.jsonArray()).put("index", 0).put("position", 0).put("volume", 0))
            repo.save("/api/v1/history", JSONObject().put("parcalar", tracks.jsonArray()))
            repo.save("/api/favoriler", JSONObject().put("parcalar", emptyList<Parca>().jsonArray()))
            val widgets = listOf(Triple(MiniPlayerWidget::class.java, 344 to 80, "mini"), Triple(NowPlayingWidget::class.java, 344 to 184, "player"), Triple(YourMusicWidget::class.java, 344 to 300, "library")).map { (provider, size, name) ->
                val id = main { host.allocateAppWidgetId() }
                val manager = AppWidgetManager.getInstance(context)
                val options = Bundle().apply { putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, size.first); putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, size.first); putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, size.second); putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, size.second) }
                assertTrue("Widget binding permission missing", main { manager.bindAppWidgetIdIfAllowed(id, ComponentName(context, provider), options) })
                val view = main { host.createView(context, id, manager.getAppWidgetInfo(id)) }
                MusicWidgets.refresh(context)
                until("$name populated") { main { view.findViewById<TextView>(R.id.widget_title)?.text == "Night Drive" } }
                screenshot(view, size.first, size.second, File(output, "$name.png"))
                Triple(id, view, name)
            }
            val playerView = widgets[1].second
            // No Activity or controller is open when this immutable PendingIntent is dispatched.
            main { playerView.findViewById<View>(R.id.widget_play).performClick() }
            until("widget starts playback without an observing controller") { main { playerView.findViewById<View>(R.id.widget_play).contentDescription == "Pause" } }
            val future = main { MediaController.Builder(context, SessionToken(context, ComponentName(context, PlaybackService::class.java))).buildAsync() }
            controller = future.get(15, TimeUnit.SECONDS)
            val active = controller!!
            until("cold widget playback") { main { active.isPlaying } }
            assertEquals("night", main { active.currentMediaItem?.trackOrNull()?.id })
            main { playerView.findViewById<View>(R.id.widget_next).performClick() }
            until("next") { main { active.currentMediaItem?.trackOrNull()?.id == "hours" } }
            main { playerView.findViewById<View>(R.id.widget_previous).performClick() }
            until("previous") { main { active.currentMediaItem?.trackOrNull()?.id == "night" } }
            main { playerView.findViewById<View>(R.id.widget_play).performClick() }
            until("pause") { main { !active.playWhenReady } }
            main { playerView.findViewById<View>(R.id.widget_like).performClick() }
            until("liked") { repo.cached("/api/favoriler")?.tracks().orEmpty().any { it.id == "night" } }
            val library = widgets[2].second
            until("recent tile") { main { library.findViewById<TextView>(R.id.widget_text_1)?.text == "After Hours" } }
            main { library.findViewById<View>(R.id.widget_recent_1).performClick() }
            until("recent starts playback") { main { active.currentMediaItem?.trackOrNull()?.id == "hours" && active.isPlaying } }
            main { active.pause() }
            val manager = AppWidgetManager.getInstance(context)
            main { manager.updateAppWidgetOptions(widgets[2].first, Bundle().apply { putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 160) }) }
            MusicWidgets.refresh(context)
            until("resize hides recent cards") { main { library.findViewById<View>(R.id.widget_recent_1) == null && library.findViewById<View>(R.id.widget_play) != null } }
            screenshot(library, 344, 160, File(output, "resized.png"))
            val staleScope = CarArtwork.scope(repo)
            main { repo.memberCookies.clear() }
            until("logout removes track") { main { widgets.all { it.second.findViewById<TextView>(R.id.widget_title)?.text == "Your next favorite awaits" } } }
            screenshot(playerView, 344, 184, File(output, "signed-out.png"))
            val denied = main { active.sendCustomCommand(SessionCommand(MusicWidgets.COMMAND, Bundle.EMPTY), Bundle().apply { putString("command", "toggle"); putString("scope", staleScope) }) }.get(10, TimeUnit.SECONDS)
            assertTrue("Stale widget control must be rejected", denied.resultCode != 0)
            File(output, "result.json").writeText("""{"variants":3,"coldPlayback":true,"next":true,"previous":true,"pause":true,"favorite":true,"recentPlayback":true,"resize":true,"logoutClearsInformation":true,"staleControlRejected":true,"productionAccountUsed":false}""")
        } finally {
            controller?.let { main { it.pause(); it.clearMediaItems(); it.release() } }
            main { host.deleteHost(); host.stopListening(); repo.memberCookies.clear(); repo.base = previousServer }
            context.stopService(Intent(context, PlaybackService::class.java))
            server.close()
        }
    }

    private fun screenshot(view: AppWidgetHostView, width: Int, height: Int, file: File) = main {
        val density = context.resources.displayMetrics.density
        val w = (width * density).toInt(); val h = (height * density).toInt()
        view.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
        view.layout(0, 0, w, h)
        val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        view.draw(Canvas(bitmap)); file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }; bitmap.recycle()
    }

    private class AudioServer(context: Context) : AutoCloseable {
        private val socket = ServerSocket(0, 50, java.net.InetAddress.getByName("127.0.0.1"))
        private val workers = Executors.newCachedThreadPool()
        val port get() = socket.localPort
        private val sound = ByteBuffer.allocate(44 + 16000 * 120).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray()); putInt(capacity() - 8); put("WAVEfmt ".toByteArray()); putInt(16); putShort(1); putShort(1); putInt(16000); putInt(16000); putShort(1); putShort(8); put("data".toByteArray()); putInt(capacity() - 44)
            while (hasRemaining()) put(128.toByte())
        }.array()
        private val artwork = listOf("electronic-horizons", "jazz-after-hours", "slow-motion", "soul-colors").map { context.assets.open("artwork/sessions/$it-v1.webp").use { stream -> stream.readBytes() } }
        init {
            workers.execute {
                while (!socket.isClosed) {
                    val client = runCatching { socket.accept() }.getOrNull() ?: break
                    workers.execute {
                        runCatching { client.use {
                            val reader = it.getInputStream().bufferedReader(); val request = reader.readLine().orEmpty(); var length = 0
                            while (true) { val line = reader.readLine(); if (line.isNullOrEmpty()) break; if (line.startsWith("Content-Length:",true)) length = line.substringAfter(':').trim().toInt() }
                            repeat(length) { reader.read() }
                            val path = request.split(' ').getOrNull(1).orEmpty()
                            val artIndex = when { path.contains("hours") -> 1; path.contains("focus") -> 2; path.contains("morning") -> 3; else -> 0 }
                            val bytes = when { path.startsWith("/api/stream/") -> sound; path.startsWith("/api/cover/") -> artwork[artIndex]; else -> "{}".toByteArray() }
                            val type = when { path.startsWith("/api/stream/") -> "audio/wav"; path.startsWith("/api/cover/") -> "image/webp"; else -> "application/json" }
                            it.getOutputStream().apply { write("HTTP/1.1 200 OK\r\nContent-Type: $type\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray()); write(bytes); flush() }
                        } }
                    }
                }
            }
        }
        override fun close() { socket.close(); workers.shutdownNow() }
    }
}
