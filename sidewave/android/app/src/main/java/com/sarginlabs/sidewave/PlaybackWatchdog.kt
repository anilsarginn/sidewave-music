package com.sarginlabs.sidewave

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** One deadline per playback attempt; an older song can never time out its successor. */
class PlaybackWatchdog(
    private val scope: CoroutineScope,
    private val nowMs: () -> Long,
    private val waitMs: suspend (Long) -> Unit = { delay(it) },
    private val timeoutMs: Long = 15_000L
) {
    private var job: Job? = null
    private var armedAttempt: String? = null
    private var generation = 0L

    fun arm(attempt: String, startedAtMs: Long, hasPlayed: Boolean, onTimeout: () -> Unit) {
        if(job?.isActive == true && armedAttempt == attempt) return
        cancel()
        armedAttempt = attempt
        val token = generation
        val remaining = if(hasPlayed) timeoutMs else (timeoutMs - (nowMs() - startedAtMs)).coerceAtLeast(1L)
        job = scope.launch {
            waitMs(remaining)
            if(token == generation) { job = null; onTimeout() }
        }
    }

    fun cancel() {
        generation++
        job?.cancel()
        job = null
        armedAttempt = null
    }
}
