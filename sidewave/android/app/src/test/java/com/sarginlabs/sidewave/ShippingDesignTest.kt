package com.sarginlabs.sidewave

import com.sarginlabs.sidewave.api.Parca
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class ShippingDesignTest {
    @Test fun presetsAreBoundedAndRemovalCannotRestoreAnOlderSelection() {
        val state=JSONObject().put("preset","midnight-coast").deviceAppearanceState(File("/missing"))
        assertTrue(state.enabled);assertEquals("file:///android_asset/artwork/wallpapers/midnight-coast-v1.webp",state.imageModel)
        assertFalse(JSONObject().deviceAppearanceState(File("/missing")).enabled)
        assertThrows(IllegalArgumentException::class.java){JSONObject().put("preset","../../private").deviceAppearanceState(File("/missing"))}
        assertNull(sessionArtwork("../../private"));assertEquals(8,sessionIds.size);assertEquals(4,signatureBackgrounds.size)
    }
    @Test fun detailedArtPreservesRecordingCropAndDoesNotRewriteOtherHosts() {
        assertEquals("https://lh3.googleusercontent.com/album=w800-h800-l90-rj",detailedThumbnail("https://lh3.googleusercontent.com/album=w120-h120-l90-rj",800))
        assertEquals("https://yt3.ggpht.com/album=s1200-c-rj",detailedThumbnail("https://yt3.ggpht.com/album=s120-c-rj",5000))
        for(url in listOf("https://example.com/album=s120","https://googleusercontent.com.example.com/album=s120","https://i.ytimg.com/vi/zdOLaYSgkSM/hqdefault.jpg"))assertEquals(url,detailedThumbnail(url,800))
    }
    @Test fun personalPlaylistAliasesAreExcludedWithoutRequiringDuration() {
        val owned=Parca("one","Café","youtube",sanatci="Artist",appId="canonical")
        val alias=owned.copy(id="alias",baslik="Cafe",sure=123.0,appId=null)
        val another=owned.copy(id="new",baslik="New song",appId="new-canonical")
        assertEquals(listOf(another),outsidePersonalPlaylists(listOf(owned,alias,another),listOf(owned)))
    }
}
