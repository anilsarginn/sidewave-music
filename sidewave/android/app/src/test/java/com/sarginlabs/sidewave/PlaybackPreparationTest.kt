package com.sarginlabs.sidewave

import com.sarginlabs.sidewave.api.Parca
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class PlaybackPreparationTest {
    @Test fun preparesEntireLikedLibraryOffCallerThreadWithDistinctQueueIdentity() = runBlocking {
        val caller = Thread.currentThread()
        val tracks = (0 until 756).map { Parca(id="${it % 700}", baslik="Parça $it", kaynak="youtube", appId="app-${it % 700}", entryId="old") }
        val prepared = preparePlaybackQueue(tracks) {
            assertNotSame(caller, Thread.currentThread())
            it
        }
        assertEquals(756, prepared.size)
        assertEquals(tracks.map { it.key() }, prepared.map { it.key() })
        assertEquals(tracks.map { it.appId }, prepared.map { it.appId })
        assertEquals(756, prepared.map { it.entryId }.toSet().size)
        assertTrue(prepared.none { it.entryId == "old" })
        assertEquals("Parça 755", prepared[755].baslik)
    }

    @Test fun cancelledPreparationCannotReplaceLaterSelection() = runBlocking {
        val started = CountDownLatch(1)
        val unblock = CountDownLatch(1)
        var oldPublished = false
        val old = launch {
            preparePlaybackQueue(List(756) { Parca(id="$it",baslik="Eski",kaynak="youtube") }) {
                started.countDown()
                check(unblock.await(5, TimeUnit.SECONDS))
                it
            }
            oldPublished = true
        }
        withContext(Dispatchers.IO) { check(started.await(5, TimeUnit.SECONDS)) }
        old.cancel()
        val next = preparePlaybackQueue(listOf(Parca(id="new",baslik="Yeni",kaynak="youtube"))) { it }
        unblock.countDown(); old.join()
        assertFalse(oldPublished)
        assertEquals("new", next.single().id)
    }

    @Test fun invalidSeekPositionsNeverReachPlayer() {
        listOf(Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY, -1.0).forEach { assertEquals(0L,safePositionMillis(it)) }
        assertEquals(1250L,safePositionMillis(1.25))
    }

    @Test fun diagnosticFramesExcludeSensitiveExceptionMessagesAndBoundCauseCycles() {
        val error = IllegalStateException("https://provider.test/signed?token=PRIVATE artist: PRIVATE")
        val nested = java.io.IOException("PRIVATE", error)
        error.initCause(nested)
        val report = failureFrames(error)
        assertTrue(report.contains("IllegalStateException"))
        assertTrue(report.contains("IOException"))
        assertFalse(report.contains("PRIVATE"))
        assertFalse(report.contains("https://"))
        assertTrue(report.length < 24001)
    }
}
