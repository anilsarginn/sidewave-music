package com.sarginlabs.sidewave

import android.content.ComponentName
import android.graphics.BitmapFactory
import android.os.Bundle
import androidx.media.utils.MediaConstants
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaBrowser
import androidx.media3.session.SessionToken
import androidx.media3.session.SessionCommand
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.common.util.concurrent.ListenableFuture
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.TimeUnit

/** Exercises the real service, legacy browse contract and local artwork on an Android runtime. */
@RunWith(AndroidJUnit4::class)
@UnstableApi
class CarBrowseInstrumentedTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context=instrumentation.targetContext
    private val repo get()=context.app.repository
    private fun <T> main(block:()->T):T { var result:T?=null;instrumentation.runOnMainSync{result=block()};@Suppress("UNCHECKED_CAST") return result as T }
    private fun <T> await(block:()->ListenableFuture<T>):T = main(block).get(30,TimeUnit.SECONDS)

    @Test fun realCarLibraryHasArtworkFlatSongsWorkingQueueAndPlaybackActions() {
        val args=InstrumentationRegistry.getArguments()
        repo.base=requireNotNull(args.getString("server"))
        val user=repo.fetchBlocking("/api/auth/login","POST",JSONObject().put("username",args.getString("username")).put("password",args.getString("password"))).getJSONObject("user")
        repo.prefs.edit().putString("member-id",user.getString("id")).putString("member-name",user.getString("username")).commit()
        repo.memberCookies.required=false;repo.memberCookies.offline=false
        listOf("/api/favoriler","/api/listeler","/api/v1/history","/api/v1/collections","/api/v1/discovery/weekly","/api/v1/home").forEach{path->repo.save(path,repo.fetchBlocking(path))}
        repo.cached("/api/favoriler")!!.tracks().forEach(repo::saveTrack)
        val browser=await {MediaBrowser.Builder(context,SessionToken(context,ComponentName(context,PlaybackService::class.java))).buildAsync()}
        try {
            val root=await {browser.getLibraryRoot(null)}
            assertEquals(0,root.resultCode)
            assertEquals(2,root.params!!.extras.getInt(MediaConstants.DESCRIPTION_EXTRAS_KEY_CONTENT_STYLE_BROWSABLE))
            assertTrue(root.params!!.extras.getBoolean(MediaConstants.BROWSER_SERVICE_EXTRAS_KEY_SEARCH_SUPPORTED))
            val tabs=await{browser.getChildren(CarIds.ROOT,0,Int.MAX_VALUE,null)}.value!!
            assertEquals(listOf("Home","Discover","Your library","Downloads"),tabs.map{it.mediaMetadata.title.toString()})
            assertTrue(tabs.all{it.mediaMetadata.isBrowsable==true && it.mediaMetadata.artworkUri!!.scheme=="android.resource"})
            val home=await{browser.getChildren(CarIds.HOME,0,Int.MAX_VALUE,null)}.value!!
            assertTrue(home.any{it.mediaId==CarIds.WEEKLY})
            assertTrue(home.any{it.mediaMetadata.extras!!.getString(MediaConstants.DESCRIPTION_EXTRAS_KEY_CONTENT_STYLE_GROUP_TITLE)=="Made for you"})
            val discovery=await{browser.getChildren(CarIds.DISCOVER,0,Int.MAX_VALUE,null)}.value!!
            assertEquals(10,discovery.size)
            assertEquals(8,discovery.count{it.mediaId.startsWith("car:editorial:")})
            val cover=discovery.first{it.mediaId.startsWith("car:editorial:")}.mediaMetadata.artworkUri!!
            assertEquals("content",cover.scheme)
            context.contentResolver.openInputStream(cover).use {val bitmap=requireNotNull(BitmapFactory.decodeStream(it));assertNotNull(bitmap);assertEquals(512,bitmap.width);bitmap.recycle()}
            try {context.contentResolver.openFileDescriptor(cover,"rw");fail("Artwork provider allowed writing")} catch(_:java.io.FileNotFoundException){}
            val first=await{browser.getChildren(CarIds.FAVORITES,0,Int.MAX_VALUE,null)}.value!!
            assertEquals(81,first.size)
            assertTrue(first.take(80).all{it.mediaMetadata.isPlayable==true})
            assertEquals("More songs",first.last().mediaMetadata.title.toString())
            assertFalse(first.any{it.mediaId.startsWith("car:group:")})
            val second=await{browser.getChildren(first.last().mediaId,0,Int.MAX_VALUE,null)}.value!!
            assertTrue(second.isNotEmpty());assertTrue(second.all{it.mediaMetadata.isPlayable==true})
            assertTrue(first.take(80).map{it.mediaId}.intersect(second.map{it.mediaId}.toSet()).isEmpty())
            val selected=second.first()
            // Preparing a queue does not request sound or resolve/download any recording.
            main {browser.setMediaItem(MediaItem.Builder().setMediaId(selected.mediaId).build())}
            val deadline=System.currentTimeMillis()+10_000
            while(main{browser.mediaItemCount}<81 && System.currentTimeMillis()<deadline)Thread.sleep(100)
            assertEquals(repo.cached("/api/favoriler")!!.tracks().size,main{browser.mediaItemCount})
            assertEquals(80,main{browser.currentMediaItemIndex})
            assertEquals(selected.mediaMetadata.title,main{browser.currentMediaItem!!.mediaMetadata.title})
            assertEquals("content",main{browser.currentMediaItem!!.mediaMetadata.artworkUri!!.scheme})
            val connected=java.util.concurrent.CountDownLatch(1)
            val legacy=main {android.support.v4.media.MediaBrowserCompat(context,ComponentName(context,PlaybackService::class.java),object:android.support.v4.media.MediaBrowserCompat.ConnectionCallback(){override fun onConnected(){connected.countDown()}},null).apply{connect()}}
            assertTrue(connected.await(10,TimeUnit.SECONDS))
            try {
                val compat=main{android.support.v4.media.session.MediaControllerCompat(context,legacy.sessionToken)}
                val actions=main{compat.playbackState!!.customActions.map{it.action}}
                assertTrue(actions.toString(),actions.containsAll(listOf("car.favorite","car.shuffle","car.repeat")))
                assertEquals(2,main{legacy.extras!!.getInt(MediaConstants.DESCRIPTION_EXTRAS_KEY_CONTENT_STYLE_BROWSABLE)})
            } finally {main{legacy.disconnect()}}
            val original=main{browser.shuffleModeEnabled}
            assertEquals(0,await{browser.sendCustomCommand(SessionCommand("car.shuffle",Bundle.EMPTY),Bundle.EMPTY)}.resultCode)
            assertEquals(!original,main{browser.shuffleModeEnabled})
            await{browser.sendCustomCommand(SessionCommand("car.repeat",Bundle.EMPTY),Bundle.EMPTY)}
            assertEquals(Player.REPEAT_MODE_ALL,main{browser.repeatMode})
            val track=main{browser.currentMediaItem!!.trackOrNull()!!}
            val liked=repo.cached("/api/favoriler")!!.tracks().any{it.sameRecording(track)}
            assertEquals(0,await{browser.sendCustomCommand(SessionCommand("car.favorite",Bundle.EMPTY),Bundle.EMPTY)}.resultCode)
            assertEquals(!liked,repo.cached("/api/favoriler")!!.tracks().any{it.sameRecording(track)})
            // Restore the test account's favorite and leave a clean paused player.
            await{browser.sendCustomCommand(SessionCommand("car.favorite",Bundle.EMPTY),Bundle.EMPTY)}
            main{browser.pause();browser.clearMediaItems()}
            val weekly=await{browser.getChildren(CarIds.WEEKLY,0,Int.MAX_VALUE,null)}.value!!
            assertEquals(30,weekly.size)
            val detail=await{browser.getChildren(discovery.first{it.mediaId.startsWith("car:editorial:")}.mediaId,0,Int.MAX_VALUE,null)}.value!!
            assertTrue(detail.isNotEmpty())
            val albumArt=detail.first().mediaMetadata.artworkUri!!
            context.contentResolver.openInputStream(albumArt).use {val bitmap=requireNotNull(BitmapFactory.decodeStream(it));assertNotNull(bitmap);assertTrue(bitmap.width<=512);bitmap.recycle()}
            val offlineRoot=await{browser.getLibraryRoot(androidx.media3.session.MediaLibraryService.LibraryParams.Builder().setOffline(true).build())}
            assertEquals(CarIds.DOWNLOADS,offlineRoot.value!!.mediaId)
            repo.memberCookies.offline=true
            try {
                assertEquals(30,await{browser.getChildren(CarIds.WEEKLY,0,Int.MAX_VALUE,null)}.value!!.size)
                context.contentResolver.openInputStream(cover).use{assertNotNull(BitmapFactory.decodeStream(it))}
            } finally {repo.memberCookies.offline=false}
            val before=CarArtwork.scope(repo)
            repo.prefs.edit().putString("member-id","different-test-account").commit()
            try {CarArtwork.open(context,cover);fail("Old-account cover was accepted")} catch(_:IllegalArgumentException){} finally {repo.prefs.edit().putString("member-id",user.getString("id")).commit()}
            assertEquals(before,CarArtwork.scope(repo))
        } finally {main{browser.release()}}
    }
}
