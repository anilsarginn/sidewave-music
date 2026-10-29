package com.sarginlabs.sidewave

import androidx.compose.ui.semantics.ProgressBarRangeInfo
import org.junit.Assert.*
import org.junit.Test

class ProgressValuesTest {
    @Test fun reproducesReportedSemanticsCrashWhenDurationResetsAfterComposition() {
        var position = 0L
        var duration = 180_000L
        val originalCallback = { (position.toFloat() / duration).coerceIn(0f, 1f) }
        val fixedCallback = progressSnapshot(position.toDouble(), duration.toDouble())
        // Changing tracks invalidates duration before the previous indicator's semantics is read.
        duration = 0L
        assertTrue(originalCallback().isNaN())
        assertThrows(IllegalArgumentException::class.java) { ProgressBarRangeInfo(originalCallback(), 0f..1f) }
        assertEquals(0f, ProgressBarRangeInfo(fixedCallback(), 0f..1f).current, 0f)
        val unknown = progressSnapshot(position.toDouble(), duration.toDouble())
        position = 20_000L; duration = 240_000L
        assertEquals(0f, ProgressBarRangeInfo(unknown(), 0f..1f).current, 0f)
        assertEquals(20_000.0f / 240_000f, progressSnapshot(position.toDouble(),duration.toDouble())(),0.000001f)
    }

    @Test fun callbacksStayFiniteAndBoundedForUnavailableAndMalformedProgress() {
        val values = listOf(Double.NaN, Double.NEGATIVE_INFINITY, Double.POSITIVE_INFINITY,
            -9223372036854775807.0, -1.0, 0.0, Double.MIN_VALUE, 1.0, 500.0, Long.MAX_VALUE.toDouble(), Double.MAX_VALUE)
        for(completed in values) for(total in values) {
            val value = progressSnapshot(completed,total)()
            assertTrue("$completed / $total -> $value", value.isFinite() && value in 0f..1f)
            ProgressBarRangeInfo(value,0f..1f)
        }
        assertEquals(0.5f,progressSnapshot(50.0,100.0)(),0f)
        assertEquals(1f,progressSnapshot(120.0,100.0)(),0f)
        assertEquals(0f,progressSnapshot(-1.0,100.0)(),0f)
    }

    @Test fun rapidTrackChangesAndUnknownDurationRemainValidForComposeSemantics() {
        repeat(10_000) { index ->
            val duration = if(index % 3 == 0) 0L else if(index % 3 == 1) -9223372036854775807L else 240_000L
            val callback = progressSnapshot((index * 100L).toDouble(),duration.toDouble())
            val info = ProgressBarRangeInfo(callback(),0f..1f)
            assertTrue(info.current.isFinite() && info.current in 0f..1f)
        }
    }

    @Test fun seekValuesRemainWithinNewTrackRangeWhenDurationChangesDuringDragging() {
        val dragging = 210_000f
        assertEquals(120_000f,seekSliderValue(dragging,120_000L),0f)
        assertEquals(0f,seekSliderValue(dragging,0L),0f)
        assertEquals(0f,seekSliderValue(dragging,-9223372036854775807L),0f)
        listOf(Float.NaN,Float.NEGATIVE_INFINITY,Float.POSITIVE_INFINITY,-1f).forEach {
            assertEquals(0f,seekSliderValue(it,240_000L),0f)
        }
    }
}
