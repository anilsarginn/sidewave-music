package com.sarginlabs.sidewave

import com.sarginlabs.sidewave.api.Parca
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.File

class AppearanceTest {
    @Test fun devicePreferencesAreIndependentAndClearingNeverRestoresTheSharedImage() {
        val directory=File("/missing")
        val computer=JSONObject().put("dim",20).put("transparency",50)
        val phone=JSONObject().put("dim",45).put("transparency",85)
        assertEquals(.2f,computer.deviceAppearanceState(directory).dim)
        assertEquals(.45f,phone.deviceAppearanceState(directory).dim)
        assertEquals(.85f,phone.deviceAppearanceState(directory).transparency)
        assertNull(phone.deviceAppearanceState(directory).wallpaper)
        phone.put("wallpaperName","../../outside.jpg")
        assertThrows(IllegalArgumentException::class.java){phone.deviceAppearanceState(directory)}
    }
    @Test fun missingArtworkUsesTheRecordingButPreservesExplicitArt() {
        val song=Parca("zdOLaYSgkSM","Song","youtube")
        assertEquals("https://i.ytimg.com/vi/zdOLaYSgkSM/hqdefault.jpg",recordingThumbnail(song))
        assertEquals("https://example.com/art",recordingThumbnail(song.copy(kapakUrl="https://example.com/art")))
        assertNull(recordingThumbnail(song.copy(id="MPREb_piinMLxuFsh")))
        assertNull(recordingThumbnail(song.copy(kaynak="kutuphane")))
    }
    @Test fun albumsAreRecentDistinctAndKeepSourceIdentity() {
        val song=Parca("one","Song","youtube",albumId="same",album="Album")
        assertEquals(listOf("youtube","kutuphane"),recentAlbumTracks(listOf(song,song.copy(id="two"),song.copy(kaynak="kutuphane"),song.copy(albumId=null))).map{it.kaynak})
    }
    @Test fun rejectsUnboundedImportsBeforeWritingTheOverflowChunk() {
        val output=ByteArrayOutputStream()
        assertThrows(IllegalArgumentException::class.java){copyBoundedImage(ByteArray(9).inputStream(),output,8)}
        assertEquals(0,output.size())
        copyBoundedImage(byteArrayOf(1,2,3).inputStream(),output,3)
        assertArrayEquals(byteArrayOf(1,2,3),output.toByteArray())
    }
    @Test fun serverSettingsAreFiniteAndOnlyAcceptImmutableWallpaperPaths() {
        val data=JSONObject().put("dim",Double.POSITIVE_INFINITY.toString()).put("transparency",200)
        val result=data.appearanceState(File("/missing"))
        assertEquals(.35f,result.dim);assertEquals(.9f,result.transparency);assertFalse(result.enabled)
        data.put("wallpaperUrl","https://other.example/image.jpg")
        assertThrows(IllegalArgumentException::class.java){data.appearanceState(File("/missing"))}
        data.put("wallpaperUrl","/api/v1/appearance/wallpaper/"+"a".repeat(64)+".jpg")
        assertNotNull(data.appearanceState(File("/missing")).wallpaperUrl)
    }
}
