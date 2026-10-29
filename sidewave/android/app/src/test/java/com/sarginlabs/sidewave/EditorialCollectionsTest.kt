package com.sarginlabs.sidewave

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class EditorialCollectionsTest {
    private fun selection()=JSONObject().put("id","jazz-after-hours").put("ad","Geceye Jazz").put("owner","Sidewave").put("editable",false)
    @Test fun collectionSummaryDoesNotInventCountsOrTracks() {
        val item=selection().put("parcaSayisi",JSONObject.NULL).put("tur","Jazz").editorialSelection()
        assertNull(item.count);assertTrue(item.tracks.isEmpty());assertEquals("Jazz",item.genre)
    }
    @Test fun rejectsPersonalOrMalformedOwnership() {
        assertThrows(IllegalArgumentException::class.java){selection().put("editable",true).editorialSelection()}
        val missing=selection();missing.remove("editable");assertThrows(IllegalArgumentException::class.java){missing.editorialSelection()}
        assertThrows(IllegalArgumentException::class.java){selection().put("id","../private-playlist").editorialSelection()}
    }
    @Test fun weeklySnapshotKeepsSourceTracksAndStaleState() {
        val track=JSONObject().put("id","abcdefghijk").put("baslik","Road Song").put("sanatci","Ikebe Shakedown").put("kaynak","youtube")
        val item=selection().put("id","weekly").put("ad","Haftalık Keşif").put("parcalar",JSONArray().put(track)).put("personalized",true).put("stale",true).put("message","Son başarılı seçki gösteriliyor.").put("refreshAt",Instant.parse("2026-10-25T21:00:00Z").toEpochMilli()).editorialSelection()
        assertEquals(1,item.count);assertEquals("abcdefghijk",item.tracks.single().id);assertTrue(item.stale);assertEquals(true,item.personalized)
        assertEquals("Son başarılı seçki gösteriliyor.",item.message)
    }
    @Test fun refreshDateUsesIstanbulMondayInsteadOfDeviceTimezone() {
        assertEquals("26 October",editorialRefreshLabel(Instant.parse("2026-10-25T21:00:00Z").toEpochMilli()))
    }
}
