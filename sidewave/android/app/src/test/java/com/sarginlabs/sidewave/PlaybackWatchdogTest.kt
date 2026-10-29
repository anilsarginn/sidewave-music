package com.sarginlabs.sidewave

import androidx.media3.common.C
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class PlaybackWatchdogTest {
    private class Fixture {
        var now = 0L
        val scope = CoroutineScope(Job() + Dispatchers.Unconfined)
        val waits = mutableListOf<Pair<Long, CompletableDeferred<Unit>>>()
        val watchdog = PlaybackWatchdog(scope, { now }, { ms ->
            val gate = CompletableDeferred<Unit>()
            waits += ms to gate
            gate.await()
        })
    }

    @Test fun previousTrackCannotStopNewTrackAtItsOldDeadline() {
        val f = Fixture()
        try {
            var oldTimeouts = 0; var newTimeouts = 0
            f.watchdog.arm("old", 0L, false) { oldTimeouts++ }
            f.now = 13_230L
            f.watchdog.arm("new", f.now, false) { newTimeouts++ }
            assertEquals(listOf(15_000L,15_000L), f.waits.map { it.first })
            f.now = 15_000L
            f.waits[0].second.complete(Unit)
            assertEquals(0,oldTimeouts); assertEquals(0,newTimeouts)
            f.now = 28_230L
            f.waits[1].second.complete(Unit)
            assertEquals(0,oldTimeouts); assertEquals(1,newTimeouts)
        } finally { f.scope.cancel() }
    }

    @Test fun repeatedBufferEventsDoNotExtendStartupAndReadyCancelsDeadline() {
        val f = Fixture()
        try {
            var timeouts = 0
            f.now = 5_000L
            f.watchdog.arm("one",0L,false) { timeouts++ }
            f.now = 7_000L
            f.watchdog.arm("one",0L,false) { timeouts++ }
            assertEquals(1,f.waits.size); assertEquals(10_000L,f.waits.single().first)
            f.watchdog.cancel()
            f.waits.single().second.complete(Unit)
            assertEquals(0,timeouts)
            f.now = 60_000L
            f.watchdog.arm("one",0L,true) { timeouts++ }
            assertEquals(15_000L,f.waits.last().first)
            f.watchdog.cancel()
            f.waits.last().second.complete(Unit)
            assertEquals(0,timeouts)
        } finally { f.scope.cancel() }
    }

    @Test fun cancellationInvalidatesEvenAnAlreadyQueuedOldTimeoutCallback() {
        val scope = CoroutineScope(Job() + Dispatchers.Unconfined)
        val waits = mutableListOf<CompletableDeferred<Unit>>()
        var timeouts = 0
        val watchdog = PlaybackWatchdog(scope,{0L},{
            val gate=CompletableDeferred<Unit>();waits+=gate
            withContext(NonCancellable) { gate.await() }
        })
        try {
            watchdog.arm("old",0L,false) { timeouts++ }
            watchdog.arm("new",0L,false) { timeouts++ }
            waits[0].complete(Unit)
            assertEquals(0,timeouts)
            waits[1].complete(Unit)
            assertEquals(1,timeouts)
        } finally { waits.forEach { it.complete(Unit) }; scope.cancel() }
    }

    @Test fun unavailableOrAuthenticationFailureIsNotAutomaticallyRetried() {
        for(code in listOf("SOURCE_UNAVAILABLE","SOURCE_AUTH_REQUIRED","SOURCE_ACCESS_DENIED")) {
            val error = IOException("resolve",ApiFailure(code,"Kaynak açılamadı",false))
            assertEquals(C.TIME_UNSET,playbackRetryDelay(error,1,1000L))
            assertEquals(code,playbackApiFailure(error)?.code)
        }
    }

    @Test fun transientFailuresAllowAtMostOneRetry() {
        for(error in listOf(IOException("network"),IOException("resolve",ApiFailure("SOURCE_TIMEOUT","Zaman aşımı",true)))) {
            assertEquals(1000L,playbackRetryDelay(error,1,1000L))
            assertEquals(C.TIME_UNSET,playbackRetryDelay(error,2,2000L))
            assertEquals(C.TIME_UNSET,playbackRetryDelay(error,3,3000L))
        }
    }
}
