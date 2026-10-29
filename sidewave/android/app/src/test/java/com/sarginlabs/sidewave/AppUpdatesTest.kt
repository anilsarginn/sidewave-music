package com.sarginlabs.sidewave

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class AppUpdatesTest {
    private fun manifest()=JSONObject().put("packageName","com.sarginlabs.sidewave").put("versionCode",5).put("versionName","1.2.1").put("minSdk",29)
        .put("sizeBytes",12345).put("sha256","a".repeat(64)).put("certificateSha256","b".repeat(64)).put("url","/downloads/sidewave-5.apk")
        .put("notes","Yeni sürüm").put("publishedAt","2026-10-18T00:00:00Z")
    @Test fun releaseUsesVersionedSameServerPath() {
        val release=manifest().androidRelease();assertEquals(5,release.versionCode);assertEquals("/downloads/sidewave-5.apk",release.url)
    }
    @Test fun untrustedReleaseRejectsForeignPackagesPathsOverflowAndInvalidHashes() {
        for((key,value) in listOf("packageName" to "other.app","url" to "https://other.example/app.apk","url" to "/downloads/../app.apk","versionCode" to 4,"versionCode" to 4294967301L,"sizeBytes" to 0,"sizeBytes" to 999999999L,"sha256" to "wrong","publishedAt" to "not-a-date")) {
            assertTrue("Rejected $key=$value",runCatching {manifest().put(key,value).androidRelease()}.isFailure)
        }
    }
    @Test fun checksumDetectsSameSizeArtifactCorruption() {
        val file=File.createTempFile("update-test",".apk")
        try{file.writeText("abc");val good=fileSha256(file);assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",good);file.writeText("abd");assertNotEquals(good,fileSha256(file))}finally{file.delete()}
    }
}
