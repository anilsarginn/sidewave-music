package com.sarginlabs.sidewave

import android.content.Context
import android.net.Uri
import com.sarginlabs.sidewave.api.Parca
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.URI
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.TimeUnit

fun Parca.key() = "$kaynak:$id"
fun Parca.sameRecording(other: Parca) = key() == other.key() || appId != null && appId == other.appId
fun Parca.json() = JSONObject().apply {
    put("id", id); put("baslik", baslik); put("sanatci", sanatci); put("album", album)
    put("sure", sure); put("kaynak", kaynak); put("kapakId", kapakId); put("kapakUrl", kapakUrl)
    put("entryId", entryId); put("appId", appId); put("bicim", bicim); put("bitrate", bitrate)
    put("sanatciId", sanatciId); put("albumId", albumId); put("favori", favori)
    put("reason", reason); put("reasonType", reasonType); put("kapak", kapak); put("parcaNo", parcaNo); put("disk", disk); put("yil", yil)
}
fun JSONObject.track() = Parca(
    id = getString("id"), baslik = optString("baslik", "Untitled track"),
    sanatci = optString("sanatci", ""), album = textOrNull("album"),
    sure = if (has("sure") && !isNull("sure")) optDouble("sure").takeIf { it.isFinite() } else null,
    kaynak = optString("kaynak", "kutuphane"), kapakId = textOrNull("kapakId"),
    kapakUrl = textOrNull("kapakUrl") ?: textOrNull("kapak"), entryId = textOrNull("entryId"), appId = textOrNull("appId"),
    bicim = textOrNull("bicim"), bitrate = if(has("bitrate")) optDouble("bitrate").takeIf { it.isFinite() } else null,
    sanatciId = textOrNull("sanatciId"), albumId = textOrNull("albumId"), favori = optBoolean("favori", false),
    reason = textOrNull("reason"), reasonType = textOrNull("reasonType"), kapak = textOrNull("kapak"), parcaNo = if(has("parcaNo") && !isNull("parcaNo")) optInt("parcaNo") else null,
    disk = if(has("disk") && !isNull("disk")) optInt("disk") else null, yil = if(has("yil") && !isNull("yil")) optInt("yil") else null
)
fun JSONObject.textOrNull(key: String) = if (isNull(key)) null else optString(key).takeIf { it.isNotBlank() && it != "null" }
fun JSONArray.objects() = (0 until length()).mapNotNull { optJSONObject(it) }
fun JSONObject.tracks(key: String = "parcalar") = optJSONArray(key)?.objects()?.mapNotNull { runCatching { it.track() }.getOrNull() }.orEmpty()
fun Iterable<Parca>.jsonArray() = JSONArray().apply { forEach { put(it.json()) } }
fun digest(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }

const val DEFAULT_SERVER_URL = "http://127.0.0.1:4444"

fun upgradedServerAddress(saved: String?): String =
    saved?.takeIf { it.isNotBlank() } ?: DEFAULT_SERVER_URL

/** A user-chosen HTTPS origin, or HTTP on a private LAN / loopback address. */
fun validateServerAddress(value: String): String {
    val uri = runCatching { URI(value.trim()) }.getOrElse { throw IllegalArgumentException("Enter a valid server address.") }
    require(uri.scheme in listOf("http", "https") && !uri.host.isNullOrBlank() && uri.userInfo == null && uri.query == null && uri.fragment == null && uri.path.orEmpty() in listOf("", "/")) { "Enter your server origin, for example https://music.example.com" }
    val parts = uri.host.orEmpty().split('.').map { it.toIntOrNull() ?: -1 }
    val privateAddress = parts.size == 4 && parts.all { it in 0..255 } && (parts[0] == 10 || (parts[0] == 192 && parts[1] == 168) || (parts[0] == 172 && parts[1] in 16..31) || parts[0] == 127)
    require(uri.scheme == "https" || privateAddress || uri.host.equals("localhost", ignoreCase = true)) { "Use HTTPS for a public server, or HTTP with a private IPv4 address." }
    require(uri.port == -1 || uri.port in 1..65535) { "Port must be between 1 and 65535." }
    return "${uri.scheme}://${uri.host.lowercase()}" + (if(uri.port == -1 || (uri.scheme == "https" && uri.port == 443)) "" else ":${uri.port}")
}

class ApiFailure(val code: String, message: String, val retryable: Boolean = false) : Exception(message)

class Repository(val context: Context) {
    private val eventLock = Mutex()
    val prefs = context.getSharedPreferences("sidewave", Context.MODE_PRIVATE)
    val memberCookies = MemberCookies(prefs) { base }
    val favoriteChanges = kotlinx.coroutines.flow.MutableSharedFlow<Unit>(extraBufferCapacity=1)
    val http = createApiHttpClient().newBuilder().cookieJar(memberCookies).addInterceptor { chain ->
        val response=chain.proceed(chain.request())
        if(response.code==401 && !memberCookies.offline && !chain.request().url.encodedPath.startsWith("/api/auth/")) memberCookies.required=true
        response
    }.build()
    // Audio bodies can last hours. Only API/resolve requests have a total deadline.
    val mediaHttp = createMediaHttpClient(http)
    private val storage = File(context.filesDir, "library").apply { mkdirs() }
    private val artwork = File(context.filesDir, "artwork").apply { mkdirs() }
    var base: String
        get() = prefs.getString("server", DEFAULT_SERVER_URL)!!
        set(value) { prefs.edit().putString("server", validateServerAddress(value)).apply() }
    val deviceId: String = prefs.getString("deviceId", null) ?: UUID.randomUUID().toString().also { prefs.edit().putString("deviceId", it).apply() }
    fun absolute(path: String): String {
        require(path.startsWith("/") && !path.startsWith("//")) { "The server returned an invalid link." }
        return base + path
    }
    private fun cacheFile(key: String) = File(storage, digest(key) + ".json")
    @Synchronized fun cached(key: String): JSONObject? = runCatching { JSONObject(cacheFile(key).readText()) }.getOrNull()
    @Synchronized fun save(key: String, data: JSONObject) {
        val file = cacheFile(key)
        val temp = File(file.path + ".tmp")
        temp.writeText(data.toString()); check(temp.renameTo(file)) { "Could not save local data." }
    }
    fun saveTrack(track: Parca) = save("track:${track.key()}", track.json())
    fun knownTrack(key: String) = cached("track:$key")?.let { runCatching { it.track() }.getOrNull() }
    fun fetchBlocking(path: String, method: String = "GET", body: JSONObject? = null): JSONObject {
        val request = Request.Builder().url(absolute(path)).apply {
            body?.textOrNull("requestId")?.let { header("x-request-id", it) }
            if (method != "GET") method(method, (body ?: JSONObject()).toString().toRequestBody("application/json".toMediaType()))
        }.build()
        http.newCall(request).execute().use { response ->
            val data = runCatching { JSONObject(response.body?.string().orEmpty()) }.getOrElse { JSONObject() }
            if(!response.isSuccessful) {
                val error = data.optJSONObject("error") ?: data
                throw ApiFailure(error.optString("code", "NETWORK"), error.textOrNull("message") ?: data.textOrNull("hata") ?: "Could not connect (${response.code}).", error.optBoolean("retryable", response.code >= 500))
            }
            return data
        }
    }
    suspend fun fetch(path: String, method: String = "GET", body: JSONObject? = null) = withContext(Dispatchers.IO) { fetchBlocking(path, method, body) }
    suspend fun read(path: String, key: String = path): JSONObject = withContext(Dispatchers.IO) {
        fetchBlocking(path).also { data -> save(key, data); data.profileTracks().forEach(::saveTrack) }
    }
    fun resolveBlocking(track: Parca, requestId: String): String {
        val result = fetchBlocking("/api/v1/playback/resolve", "POST", JSONObject().put("parca", track.json()).put("requestId", requestId))
        PlaybackSignals.deliveries[requestId] = result.optString("delivery", "online")
        val url = result.getString("url")
        return if (url.startsWith("/")) absolute(url) else {
            require(url.startsWith("$base/")) { "The playback link is invalid." }; url
        }
    }
    /** A subscription completes only when the server verifies the whole recording. */
    suspend fun prefetch(track: Parca) {
        var subscription: String? = null
        try {
            var result = cancellableFetch("/api/v1/playback/prepare", "POST", JSONObject().put("parca", track.json()).put("priority", "next"))
            subscription = result.textOrNull("id")
            withTimeout(180_000) {
                while(result.optString("state") in listOf("accepted", "warming")) {
                    delay(2000)
                    result = cancellableFetch("/api/v1/playback/preparations/${Uri.encode(subscription)}")
                }
                if(result.optString("state") !in listOf("ready", "disabled")) throw java.io.IOException("Could not prepare the next track")
            }
        } finally {
            subscription?.let { id -> withContext(NonCancellable) { runCatching { cancellableFetch("/api/v1/playback/preparations/${Uri.encode(id)}", "DELETE") } } }
        }
    }
    private suspend fun cancellableFetch(path: String, method: String = "GET", body: JSONObject = JSONObject()): JSONObject = suspendCancellableCoroutine { continuation ->
        val request = Request.Builder().url(absolute(path)).apply {
            if(method != "GET") method(method, body.toString().toRequestBody("application/json".toMediaType()))
        }.build()
        val call = http.newCall(request); call.timeout().timeout(3, TimeUnit.SECONDS)
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : okhttp3.Callback {
            override fun onFailure(call: okhttp3.Call, error: java.io.IOException) { if(continuation.isActive) continuation.resumeWithException(error) }
            override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) {
                response.use {
                    val result = runCatching { if(!it.isSuccessful) throw java.io.IOException("Could not reach the playback service"); JSONObject(it.body?.string().orEmpty()) }
                    if(continuation.isActive) result.fold({ continuation.resume(it) }, { continuation.resumeWithException(it) })
                }
            }
        })
    }
    fun coverUrl(track: Parca,size:Int=500): String? = track.kapakId?.let { absolute("/api/cover/${Uri.encode(it)}?size=${size.coerceIn(64,1200)}") }
        ?: recordingThumbnail(track)?.let { absolute("/api/yt/kapak?u=${Uri.encode(detailedThumbnail(it,size))}") }
        ?: if(track.kaynak=="kutuphane")absolute("/api/cover/${Uri.encode(track.albumId ?: track.id)}?size=${size.coerceIn(64,1200)}") else null
    fun coverModel(track: Parca): Any? {
        val file = File(artwork, digest(track.key()))
        return file.takeIf { it.exists() && it.length() > 0 } ?: coverUrl(track)
    }
    suspend fun saveArtwork(track: Parca) = withContext(Dispatchers.IO) {
        val url = coverUrl(track) ?: return@withContext
        runCatching { http.newCall(Request.Builder().url(url).build()).execute().use { response ->
            if(response.isSuccessful && response.header("Content-Type").orEmpty().startsWith("image/")) {
                val bytes = response.body?.bytes() ?: return@use
                if (bytes.size < 5_000_000) File(artwork, digest(track.key())).writeBytes(bytes)
            }
        } }
    }
    @Synchronized fun queueEvent(event: JSONObject) {
        val entries = cached("event-outbox")?.optJSONArray("items") ?: JSONArray()
        entries.put(event)
        save("event-outbox", JSONObject().put("items", JSONArray(entries.objects().takeLast(2000))))
    }
    suspend fun flushEvents() = eventLock.withLock { withContext(Dispatchers.IO) {
        val pending = synchronized(this@Repository) { cached("event-outbox")?.optJSONArray("items")?.objects().orEmpty() }
        for(item in pending) {
            try { fetchBlocking("/api/v1/events", "POST", item) } catch(_: Exception) { break }
            synchronized(this@Repository) {
                val current = cached("event-outbox")?.optJSONArray("items")?.objects().orEmpty()
                save("event-outbox", JSONObject().put("items", JSONArray(current.filterNot { it.optString("eventId") == item.optString("eventId") })))
            }
        }
    }
    }
    suspend fun favorite(track: Parca, value: Boolean) = withContext(Dispatchers.IO) {
        val existing = cached("/api/favoriler")?.tracks().orEmpty().filterNot { it.sameRecording(track) }
        save("/api/favoriler", JSONObject().put("parcalar", (if(value) existing + track else existing).jsonArray()))
        saveTrack(track)
        synchronized(this@Repository) {
            val pending = cached("favorite-outbox") ?: JSONObject()
            pending.put(track.key(), JSONObject().put("parca", track.json()).put("favori", value))
            save("favorite-outbox", pending)
        }
        favoriteChanges.tryEmit(Unit)
        syncFavorites()
    }
    suspend fun syncFavorites() = withContext(Dispatchers.IO) {
        val pending = synchronized(this@Repository) { cached("favorite-outbox") ?: JSONObject() }
        for(key in pending.keys()) {
            val item = pending.getJSONObject(key)
            try { fetchBlocking("/api/favori", "POST", item) } catch(_: Exception) { return@withContext }
            synchronized(this@Repository) {
                val current = cached("favorite-outbox") ?: JSONObject()
                if(current.optJSONObject(key)?.toString() == item.toString()) current.remove(key)
                save("favorite-outbox", current)
            }
        }
    }
    fun pendingFavorites() = cached("favorite-outbox")?.length()?.let { it > 0 } ?: false
}

fun readLimited(input: java.io.InputStream, maxBytes: Int = 2_000_000): String {
    val output = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    while(true) {
        val count = input.read(buffer)
        if(count < 0) break
        require(output.size() + count <= maxBytes) { "Files must be no larger than 2 MB." }
        output.write(buffer, 0, count)
    }
    return output.toString(Charsets.UTF_8.name())
}

internal fun createApiHttpClient(): OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(5, TimeUnit.SECONDS).readTimeout(12, TimeUnit.SECONDS)
    .callTimeout(14, TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).build()
internal fun createMediaHttpClient(api: OkHttpClient): OkHttpClient = api.newBuilder()
    .callTimeout(0, TimeUnit.MILLISECONDS).readTimeout(30, TimeUnit.SECONDS).build()

/** The same track extraction must be used for live and cached artist profiles. */
fun JSONObject.profileTracks(): List<Parca> = tracks().ifEmpty { tracks("enCokDinlenen") }
