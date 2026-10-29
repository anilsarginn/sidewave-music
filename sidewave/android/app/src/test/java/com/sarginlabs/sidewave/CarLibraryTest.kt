package com.sarginlabs.sidewave
import org.junit.Assert.*
import org.junit.Test
class CarLibraryTest {
    @Test fun occurrenceIdsPreserveDuplicatesUnicodeAndParentAcrossReconnects() {
        val first = CarIds.song("car:playlist:çığ/ı", "entry:1")
        val second = CarIds.song("car:playlist:çığ/ı", "entry:2")
        assertNotEquals(first, second)
        assertEquals("car:playlist:çığ/ı" to "entry:1", CarIds.songParts(first))
        assertEquals(first,CarIds.song("car:playlist:çığ/ı","entry:1"))
        assertNull(CarIds.songParts("car:song:invalid"))
        assertNull(CarIds.songParts("untrusted:foo:bar"))
    }
    @Test fun browserPagingHandlesHugeLegacyPageSizesWithoutOverflowOrDuplicates() {
        val items = (0 until 756).toList()
        assertEquals(items, (0..15).flatMap { CarIds.page(items,it,50) })
        assertEquals(items,CarIds.page(items,0,Int.MAX_VALUE))
        assertTrue(CarIds.page(items,Int.MAX_VALUE,Int.MAX_VALUE).isEmpty())
        assertThrows(IllegalArgumentException::class.java) { CarIds.page(items,-1,50) }
        assertThrows(IllegalArgumentException::class.java) { CarIds.page(items,0,0) }
    }
    @Test fun flatWindowsExposeAllTracksOnceWithoutNumericFolders() {
        val songs=(0 until 756).toList();val visited=mutableListOf<Int>();var offset=0
        while(true) {
            val (visible,next)=CarIds.window(songs,offset);assertTrue(visible.size<=80);visited+=visible
            if(next==null)break
            val link=CarIds.more("car:playlist:çığ/ı",next)
            assertEquals("car:playlist:çığ/ı" to next,CarIds.moreParts(link));offset=CarIds.moreParts(link)!!.second
        }
        assertEquals(songs,visited);assertEquals(songs.size,visited.distinct().size)
        assertNull(CarIds.window(songs,Int.MAX_VALUE).second)
        assertTrue(CarIds.window(songs,Int.MAX_VALUE).first.isEmpty())
    }
    @Test fun malformedContinuationCannotEscapeIntoAnotherKindOfId() {
        listOf("car:more:broken:80","car:more:Y2FyOnJvb3Q:-1","car:more:Y2FyOnJvb3Q:2147483648","car:more:Y2FyOnJvb3Q:0","car:root").forEach {assertNull(it,CarIds.moreParts(it))}
        assertThrows(IllegalArgumentException::class.java){CarIds.window(listOf(1),-1)}
        assertThrows(IllegalArgumentException::class.java){CarIds.more("car:root",0)}
    }
}
