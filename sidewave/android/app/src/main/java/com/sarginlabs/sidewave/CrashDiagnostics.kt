package com.sarginlabs.sidewave

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import android.os.Process
import org.json.JSONObject
import java.io.File
import kotlin.system.exitProcess

/** Deliberately exclude exception messages, URLs, song metadata and arbitrary logcat text. */
fun failureFrames(error: Throwable): String = buildString {
    var cause: Throwable? = error
    val seen = java.util.Collections.newSetFromMap(java.util.IdentityHashMap<Throwable, Boolean>())
    repeat(6) {
        val current = cause ?: return@buildString
        if(!seen.add(current)) return@buildString
        if(it > 0) append("Caused by: ")
        appendLine(current.javaClass.name)
        current.stackTrace.take(32).forEach { frame -> appendLine("  at $frame") }
        cause = current.cause
    }
}.take(24_000)

class CrashDiagnostics(private val context: Context) {
    private val file = File(context.filesDir, "last-crash.json")
    private val playbackFile = File(context.filesDir, "last-playback-error.json")
    private val version = runCatching {
        context.packageManager.getPackageInfo(context.packageName, 0).versionName
    }.getOrNull() ?: "unknown"

    fun install() {
        val original = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            try {
                runCatching {
                    val record = JSONObject().put("version", version).put("time", System.currentTimeMillis())
                        .put("mainThread", thread === android.os.Looper.getMainLooper().thread)
                        .put("frames", failureFrames(error))
                    val temporary = File(file.path + ".tmp")
                    temporary.writeText(record.toString())
                    temporary.renameTo(file)
                }
            } finally {
                if(original != null) original.uncaughtException(thread, error)
                else { Process.killProcess(Process.myPid()); exitProcess(10) }
            }
        }
    }

    @Synchronized fun recordPlaybackFailure(code: String, requestId: String, elapsedMs: Long) {
        runCatching {
            val record = JSONObject().put("version", version).put("time", System.currentTimeMillis())
                .put("code", code.takeIf { it.matches(Regex("[A-Z0-9_]{1,80}")) } ?: "PLAYBACK_FAILED")
                .put("requestId", requestId.takeIf { it.matches(Regex("[A-Za-z0-9_-]{1,80}")) } ?: "unknown")
                .put("elapsedMs", elapsedMs.coerceAtLeast(0))
            val temporary = File(playbackFile.path + ".tmp")
            temporary.writeText(record.toString()); temporary.renameTo(playbackFile)
        }
    }

    private val uploadedFile = File(context.filesDir, "last-crash.uploaded")

    /**
     * The last crash, once, for the owner's server. It carries only what [failureFrames] keeps
     * (class names and stack frames) plus app version and device model: no messages, URLs or songs.
     */
    fun pendingCrash(): JSONObject? = runCatching {
        val record = file.takeIf { it.length() in 1..40_000 }?.readText()?.let(::JSONObject) ?: return null
        if(uploadedFile.takeIf { it.exists() }?.readText()?.toLongOrNull() == record.optLong("time")) return null
        record.put("device", "${Build.MANUFACTURER} ${Build.MODEL}".take(80)).put("sdk", Build.VERSION.SDK_INT)
    }.getOrNull()

    fun markUploaded(record: JSONObject) { runCatching { uploadedFile.writeText(record.optLong("time").toString()) } }

    /** Local, user-initiated copy. OS exit reasons also cover ANRs and low-memory termination. */
    fun report(): String = buildString {
        appendLine("Sidewave $version · Android ${Build.VERSION.SDK_INT}")
        appendLine("${Build.MANUFACTURER} ${Build.MODEL}")
        val playback = runCatching {
            playbackFile.takeIf { it.length() in 1..4000 }?.readText()?.let(::JSONObject)
        }.getOrNull()
        if(playback != null) appendLine("Last playback error: ${playback.optString("code")}; version=${playback.optString("version")}; time=${playback.optLong("time")}; elapsed=${playback.optLong("elapsedMs")} ms; request=${playback.optString("requestId")}")
        val previous = runCatching {
            file.takeIf { it.length() in 1..40_000 }?.readText()?.let(::JSONObject)
        }.getOrNull()
        if(previous != null) {
            appendLine("Historical crash — version: ${previous.optString("version")}; time: ${previous.optLong("time")}; main thread: ${previous.optBoolean("mainThread")}")
            appendLine(previous.optString("frames"))
        } else appendLine("No local crash report.")
        if(Build.VERSION.SDK_INT >= 30) {
            runCatching {
                val manager = context.getSystemService(ActivityManager::class.java)
                manager.getHistoricalProcessExitReasons(context.packageName, 0, 5).forEach { exit ->
                    val reason = when(exit.reason) {
                        ApplicationExitInfo.REASON_SIGNALED -> "signal"
                        ApplicationExitInfo.REASON_LOW_MEMORY -> "low-memory"
                        ApplicationExitInfo.REASON_CRASH -> "Java/Kotlin crash"
                        ApplicationExitInfo.REASON_CRASH_NATIVE -> "native crash"
                        ApplicationExitInfo.REASON_ANR -> "ANR"
                        ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "excessive-resource-use"
                        ApplicationExitInfo.REASON_USER_REQUESTED -> "user-requested"
                        else -> "reason-${exit.reason}"
                    }
                    appendLine("Android: $reason; time=${exit.timestamp}; durum=${exit.status}; PSS=${exit.pss} KB; RSS=${exit.rss} KB")
                }
            }.onFailure { appendLine("Could not read Android exit history.") }
        }
    }.take(32_000)
}
