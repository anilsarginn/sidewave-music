package com.sarginlabs.sidewave

import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class NextTrackPreparerTest {
    private class Fixture {
        var now = 0L
        val scope = CoroutineScope(Job() + Dispatchers.Unconfined)
        val waits = mutableListOf<CompletableDeferred<Unit>>()
        val preparer = NextTrackPreparer(scope, { now }, { waits.add(CompletableDeferred()); waits.last().await() })
    }
    @Test fun rapidQueueChangesOnlyPrepareLatestAndDuplicateEventsCoalesce() {
        val f = Fixture(); val calls = mutableListOf<String>()
        try {
            f.preparer.schedule("old") { calls += "old" }
            f.preparer.schedule("next") { calls += "next" }
            f.preparer.schedule("next") { calls += "duplicate" }
            f.waits.forEach { it.complete(Unit) }
            assertEquals(listOf("next"), calls)
            f.preparer.schedule("next") { calls += "duplicate" }
            assertEquals(2, f.waits.size)
        } finally { f.scope.cancel() }
    }
    @Test fun pauseOrQueueEndCancelsInFlightPreparation() {
        val f = Fixture(); val gate = CompletableDeferred<Unit>(); var cancelled = false
        try {
            f.preparer.schedule("next") { try { gate.await() } finally { cancelled = true } }
            f.waits.single().complete(Unit)
            f.preparer.schedule(null) { fail("nothing to prepare") }
            assertTrue(cancelled)
        } finally { f.scope.cancel() }
    }
    @Test fun failuresAreSilentAndThrottledWhileSuccessfulPreparationExpires() {
        val f = Fixture(); var calls = 0
        try {
            fun schedule(fail: Boolean) { f.preparer.schedule("next") { calls++; if(fail) throw java.io.IOException() } }
            schedule(true); f.waits.last().complete(Unit)
            schedule(true); assertEquals(1, f.waits.size)
            f.now = 30_001L; schedule(false); f.waits.last().complete(Unit)
            assertEquals(2, calls)
            f.now += 59_999; schedule(false); assertEquals(2, f.waits.size)
            f.now += 2; schedule(false); f.waits.last().complete(Unit); assertEquals(3,calls)
        } finally { f.scope.cancel() }
    }
    @Test fun lateCancelledCompletionCannotMarkReplacementPrepared() {
        val f = Fixture(); val stale = CompletableDeferred<Unit>()
        try {
            f.preparer.schedule("old") { withContext(NonCancellable) { stale.await() } }
            f.waits.last().complete(Unit)
            f.preparer.schedule("next") {}
            f.waits.last().complete(Unit)
            stale.complete(Unit)
            f.preparer.schedule("old") {}
            assertEquals(3,f.waits.size)
        } finally { stale.complete(Unit); f.scope.cancel() }
    }
}
