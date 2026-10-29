package com.sarginlabs.sidewave

import com.sarginlabs.sidewave.api.Parca
import org.junit.Assert.*
import org.junit.Test

class MusicWidgetsTest {
    private fun song(id: String, appId: String? = null, source: String = "kutuphane") = Parca(id = id, baslik = id, kaynak = source, appId = appId)

    @Test fun recentTilesExcludeCurrentRecordingAndSourceAliasesPreservingListeningOrder() {
        val current = song("local", "recording-1")
        val tracks = listOf(song("online", "recording-1", "youtube"), song("second", "recording-2"), song("alias", "recording-2", "youtube"), song("third"), song("fourth"), song("fifth"))
        assertEquals(listOf("second", "third", "fourth"), widgetRecentTracks(tracks, current).map { it.id })
    }

    @Test fun emptyLibraryAndQueueWithoutCurrentSongHaveStableBoundedTiles() {
        assertTrue(widgetRecentTracks(emptyList(), null).isEmpty())
        assertEquals(listOf("one", "two"), widgetRecentTracks(listOf(song("one"), song("one"), song("two")), null).map { it.id })
        assertEquals(3, widgetRecentTracks((1..100).map { song(it.toString()) }, null).size)
    }
}
