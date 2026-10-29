package com.sarginlabs.sidewave

import com.sarginlabs.sidewave.api.Parca
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ContractTest {
    @Test fun acceptsPrivateHttpAndUserHostedHttpsOrigins() {
        listOf("http://192.168.1.10:4444/" to "http://192.168.1.10:4444", "https://music.example.com/" to "https://music.example.com", "https://MUSIC.EXAMPLE.COM:443/" to "https://music.example.com", "https://music.example.com:8443" to "https://music.example.com:8443", "http://localhost:4444" to "http://localhost:4444", "http://10.0.0.2:4444" to "http://10.0.0.2:4444").forEach { (input, expected) -> assertEquals(expected, validateServerAddress(input)) }
    }
    @Test fun rejectsCredentialsPathsAndInsecurePublicServers() {
        listOf("http://example.com", "http://8.8.8.8", "http://172.32.0.1", "http://192.168.1.1/evil", "https://user:secret@example.com", "file:///etc/passwd", "http://192.168.1.1?target=public", "http://192.168.1.999", "http://192.168.1.1:0", "https://example.com/#fragment", "https://example.com/api", "https://example.com:65536").forEach { value ->
            assertThrows("Should reject $value", IllegalArgumentException::class.java) { validateServerAddress(value) }
        }
    }
    @Test fun usesLocalDefaultWithoutMigratingUserServers() {
        assertEquals(DEFAULT_SERVER_URL, upgradedServerAddress(null))
        assertEquals(DEFAULT_SERVER_URL, upgradedServerAddress(""))
        listOf("https://music.example.com", "http://192.168.1.10:4444").forEach { assertEquals(it, upgradedServerAddress(it)) }
    }
    @Test fun preservesProviderAndApplicationIdentityOnOfflineRoundTrip() {
        val original = Parca(id="source-1", baslik="Bir Şarkı (Live)", kaynak="youtube", sanatci="Bir Sanatçı", sure=241.5, appId="track-123", entryId="queue-789", kapakUrl="https://example.com/art.jpg", album="Canlı", favori=true)
        assertEquals(original, JSONObject(original.json().toString()).track())
        assertNotEquals(original.key(), original.copy(kaynak="kutuphane").key())
        assertEquals(original.key(), original.copy(entryId="another-queue-entry").key())
    }
    @Test fun nullDurationAndOptionalFieldsRemainNull() {
        val decoded = JSONObject("""{"id":"one","baslik":"İsim","kaynak":"kutuphane","sure":null,"kapakUrl":null}""").track()
        assertNull(decoded.sure); assertNull(decoded.kapakUrl); assertEquals("", decoded.sanatci)
        assertFalse(decoded.json().has("kapakUrl"))
    }
    @Test fun ignoresCorruptCachedEntriesWithoutDroppingValidOnes() {
        val data = JSONObject("""{"parcalar":[{"id":"1","baslik":"A","kaynak":"kutuphane"},{"baslik":"Broken"},{"id":"2","baslik":"B","kaynak":"youtube"}]}""")
        assertEquals(listOf("1", "2"), data.tracks().map {it.id})
    }
    @Test fun boundsImportedContentBeforeParsing() {
        assertEquals("hello", readLimited("hello".byteInputStream(), 8))
        assertThrows(IllegalArgumentException::class.java) { readLimited("123456789".byteInputStream(), 8) }
    }
    @Test fun cachedArtistProfileRetainsPopularTracksAndAlbumTracksTakePrecedence() {
        val artist = JSONObject("""{"enCokDinlenen":[{"id":"a","baslik":"Hiraeth","kaynak":"youtube"}],"albumler":[]}""")
        assertEquals(listOf("a"), JSONObject(artist.toString()).profileTracks().map { it.id })
        artist.put("parcalar", org.json.JSONArray("""[{"id":"b","baslik":"Bliss","kaynak":"youtube"}]"""))
        assertEquals(listOf("b"), artist.profileTracks().map { it.id })
    }
}
