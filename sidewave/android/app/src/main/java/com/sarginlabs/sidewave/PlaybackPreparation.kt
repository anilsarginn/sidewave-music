package com.sarginlabs.sidewave

import com.sarginlabs.sidewave.api.Parca
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.util.UUID

/** Filesystem/artwork/download lookups must never run on the player's application looper. */
suspend fun <T> preparePlaybackQueue(tracks: List<Parca>, createItem: (Parca) -> T): List<T> =
    withContext(Dispatchers.IO) {
        tracks.map { track ->
            ensureActive()
            createItem(track.copy(entryId = UUID.randomUUID().toString()))
        }
    }

fun safePositionMillis(seconds: Double): Long =
    if(seconds.isFinite() && seconds > 0) (seconds * 1000).toLong() else 0L
