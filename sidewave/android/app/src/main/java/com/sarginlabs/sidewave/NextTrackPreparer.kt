package com.sarginlabs.sidewave

import kotlinx.coroutines.*

/** One speculative request at a time; observes one shared, verified server audio preparation. */
internal class NextTrackPreparer(
    private val scope: CoroutineScope,
    private val nowMs: () -> Long,
    private val waitMs: suspend (Long) -> Unit = { delay(it) }
) {
    private var job: Job? = null
    private var pending: String? = null
    private var completed: String? = null
    private var completedAt = 0L
    private var failed: String? = null
    private var failedAt = 0L
    private var generation = 0L

    fun schedule(key: String?, prepare: suspend () -> Unit) {
        if(key == null) { cancel(); return }
        if(pending == key && job?.isActive == true) return
        cancel()
        if(completed == key && nowMs() - completedAt < 60_000L) return
        if(failed == key && nowMs() - failedAt < 30_000L) return
        val token = generation
        pending = key
        job = scope.launch {
            try {
                // Rapid skips/queue edits settle before sending speculative work.
                waitMs(250L)
                ensureActive()
                prepare()
                if(token == generation) { completed = key; completedAt = nowMs(); failed = null }
            } catch(e: CancellationException) { throw e }
            catch(_: Exception) {
                if(token == generation) { failed = key; failedAt = nowMs() }
            } finally { if(token == generation) pending = null }
        }
    }

    fun cancel() { generation++; job?.cancel(); job = null; pending = null }
}
