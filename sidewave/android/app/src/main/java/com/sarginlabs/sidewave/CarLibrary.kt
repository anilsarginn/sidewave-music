package com.sarginlabs.sidewave

import android.net.Uri
import android.os.Bundle
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.offline.Download
import kotlinx.coroutines.*
import org.json.JSONObject
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/** Stable browse identities are separate from playback queue occurrence identities. */
internal object CarIds {
    const val ROOT = "car:root"
    const val HOME = "car:home"
    const val DISCOVER = "car:discover"
    const val LIBRARY = "car:library"
    const val WEEKLY = "car:weekly"
    const val RECOMMENDED = "car:recommended"
    const val COLLECTIONS = "car:collections"
    const val WINDOW = 80
    fun more(parent: String, offset: Int): String {
        require(offset > 0); return "car:more:${encode(parent)}:$offset"
    }
    fun moreParts(id: String): Pair<String,Int>? = runCatching {
        require(id.startsWith("car:more:"));val parts=id.removePrefix("car:more:").split(':');require(parts.size==2)
        val parent=decode(parts[0]);val offset=parts[1].toInt();require(parent.startsWith("car:") && !parent.startsWith("car:more:") && offset>0)
        parent to offset
    }.getOrNull()
    fun <T> window(items:List<T>,offset:Int=0):Pair<List<T>,Int?> {
        require(offset>=0);if(offset>=items.size)return emptyList<T>() to null
        val end=minOf(items.size.toLong(),offset.toLong()+WINDOW).toInt()
        return items.subList(offset,end) to end.takeIf{it<items.size}
    }
    const val DOWNLOADS = "car:downloads"
    const val FAVORITES = "car:favorites"
    const val PLAYLISTS = "car:playlists"
    const val RECENT = "car:recent"
    private fun encode(value: String) = Base64.getUrlEncoder().withoutPadding().encodeToString(value.toByteArray(Charsets.UTF_8))
    private fun decode(value: String) = String(Base64.getUrlDecoder().decode(value), Charsets.UTF_8)
    fun song(parent: String, occurrence: String) = "car:song:${encode(parent)}:${encode(occurrence)}"
    fun songParts(id: String): Pair<String, String>? = runCatching {
        require(id.startsWith("car:song:")); val parts = id.removePrefix("car:song:").split(':'); require(parts.size == 2)
        decode(parts[0]) to decode(parts[1])
    }.getOrNull()
    fun <T> page(items: List<T>, page: Int, size: Int): List<T> {
        require(page >= 0 && size > 0)
        val start = page.toLong() * size.toLong()
        if(start >= items.size) return emptyList()
        return items.subList(start.toInt(), minOf(items.size.toLong(), start + size).toInt())
    }
}

/** Warm screens use the phone cache; only direct cold opens wait for the LAN (at most 3s). */
@UnstableApi
internal class CarLibrary(private val repo: Repository, private val scope: CoroutineScope, private val changed: (String, Int) -> Unit) {
    private val refreshAt = ConcurrentHashMap<String, Long>()
    private val http = repo.http.newBuilder().callTimeout(3, TimeUnit.SECONDS).build()
    private fun refresh(path: String): JSONObject {
        val account=CarArtwork.scope(repo)
        val request = okhttp3.Request.Builder().url(repo.absolute(path)).build()
        return http.newCall(request).execute().use { response ->
            if(response.code==401)throw ApiFailure("AUTH_REQUIRED","Sign in to Sidewave on your phone.")
            check(response.isSuccessful);check(CarArtwork.scope(repo)==account)
            JSONObject(readLimited(requireNotNull(response.body).byteStream())).also { data ->
                // An optimistic/offline favorite edit must not be overwritten by an older HTTP response.
                if(path!="/api/favoriler" || !repo.pendingFavorites())repo.save(path,data)
                data.profileTracks().forEach(repo::saveTrack)
            }
        }
    }
    private fun read(path:String,parent:String,immediate:Boolean=false):JSONObject {
        val cached=repo.cached(path)
        val now=android.os.SystemClock.elapsedRealtime()
        val previous=refreshAt.putIfAbsent(path,now)
        val due=previous==null || now-previous>60_000 && refreshAt.replace(path,previous,now)
        if(cached!=null || immediate) {
            if(due && !repo.memberCookies.offline)scope.launch(Dispatchers.IO) {
                runCatching {refresh(path);children(parent).size}.onSuccess { count->withContext(Dispatchers.Main){changed(parent,count)} }
            }
            return cached ?: JSONObject()
        }
        return refresh(path)
    }
    fun rootParams(params:androidx.media3.session.MediaLibraryService.LibraryParams?):androidx.media3.session.MediaLibraryService.LibraryParams =
        androidx.media3.session.MediaLibraryService.LibraryParams.Builder().setOffline(params?.isOffline==true).setRecent(params?.isRecent==true).setSuggested(params?.isSuggested==true)
            .setExtras(Bundle(params?.extras ?: Bundle.EMPTY).apply {
                putInt(androidx.media.utils.MediaConstants.DESCRIPTION_EXTRAS_KEY_CONTENT_STYLE_BROWSABLE,2)
                putInt(androidx.media.utils.MediaConstants.DESCRIPTION_EXTRAS_KEY_CONTENT_STYLE_PLAYABLE,1)
                putBoolean(androidx.media.utils.MediaConstants.BROWSER_SERVICE_EXTRAS_KEY_SEARCH_SUPPORTED,true)
            }).build()
    fun folder(id:String,title:String,subtitle:String?=null,art:Uri?=null,group:String?=null,tab:Boolean=false,list:Boolean=false):MediaItem = MediaItem.Builder().setMediaId(id)
        .setMediaMetadata(MediaMetadata.Builder().setTitle(title).setSubtitle(subtitle).setArtworkUri(art)
            .setIsBrowsable(true).setIsPlayable(false).setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_MIXED)
            .setExtras(Bundle().apply {
                putInt(androidx.media.utils.MediaConstants.DESCRIPTION_EXTRAS_KEY_CONTENT_STYLE_BROWSABLE,2)
                putInt(androidx.media.utils.MediaConstants.DESCRIPTION_EXTRAS_KEY_CONTENT_STYLE_PLAYABLE,1)
                if(!tab)putInt(androidx.media.utils.MediaConstants.DESCRIPTION_EXTRAS_KEY_CONTENT_STYLE_SINGLE_ITEM,if(list)1 else 2)
                group?.let {putString(androidx.media.utils.MediaConstants.DESCRIPTION_EXTRAS_KEY_CONTENT_STYLE_GROUP_TITLE,it)}
            }).build()).build()
    private fun icon(name:String)=Uri.parse("android.resource://${repo.context.packageName}/drawable/car_$name")
    private fun tile(id:String,title:String,subtitle:String,color:String,group:String?=null)=folder(id,title,subtitle,CarArtwork.tileUri(repo,id,title,subtitle,color),group)
    private fun favoriteTile(group:String?=null)=tile(CarIds.FAVORITES,"Liked Songs","Your favorites, together","#7054CD",group)
    private fun weeklyTile(group:String?=null)=tile(CarIds.WEEKLY,"Discover Weekly","New music every Monday","#168B58",group)
    private fun recentTile(group:String?=null)=tile(CarIds.RECENT,"Recently played","Pick up where you left off","#B36C40",group)
    private fun downloadTile(group:String?=null)=tile(CarIds.DOWNLOADS,"Downloads","Music saved to your phone","#267B8C",group)
    private fun personalLists(parent:String,immediate:Boolean=false,group:String?=null):List<MediaItem> = read("/api/listeler",parent,immediate).optJSONArray("listeler")?.objects().orEmpty().map { item->
        val id="car:playlist:${item.getString("id")}";val title=item.optString("ad","Playlist")
        val count=if(item.has("parcaSayisi")&&!item.isNull("parcaSayisi"))"${item.optInt("parcaSayisi")} tracks" else "Playlist"
        tile(id,title,count,CarArtwork.palette(id),group)
    }
    private fun editorials(parent:String,immediate:Boolean=false,group:String?=null):List<MediaItem> = read("/api/v1/collections",parent,immediate).optJSONArray("listeler")?.objects().orEmpty().mapNotNull { data->
        runCatching {data.editorialSelection()}.getOrNull()?.let {item->
            tile("car:editorial:${item.id}",item.title,listOfNotNull(item.genre,item.count?.let{"$it tracks"}).joinToString(" · "),item.color ?: "#367E65",group)
        }
    }
    private fun songs(parent:String,tracks:List<com.sarginlabs.sidewave.api.Parca>,group:String?=null,grid:Boolean=false):List<MediaItem> = tracks.mapIndexed { index,track->
        repo.saveTrack(track)
        MediaItem.Builder().setMediaId(CarIds.song(parent,track.entryId ?: "${track.key()}:$index"))
            .setMediaMetadata(MediaMetadata.Builder().setTitle(track.baslik).setArtist(track.sanatci).setAlbumTitle(track.album)
                .setSubtitle(listOfNotNull(track.sanatci.takeIf{it.isNotBlank()},track.album?.takeIf{it.isNotBlank()}).joinToString(" · "))
                .setArtworkUri(CarArtwork.trackUri(repo,track)).setIsBrowsable(false).setIsPlayable(true).setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
                .setExtras(Bundle().apply {
                    putString("parca",track.json().toString())
                    if(grid)putInt(androidx.media.utils.MediaConstants.DESCRIPTION_EXTRAS_KEY_CONTENT_STYLE_SINGLE_ITEM,2)
                    group?.let{putString(androidx.media.utils.MediaConstants.DESCRIPTION_EXTRAS_KEY_CONTENT_STYLE_GROUP_TITLE,it)}
                    if(repo.context.app.offline.completed(track))putLong(android.support.v4.media.MediaDescriptionCompat.EXTRA_DOWNLOAD_STATUS,android.support.v4.media.MediaDescriptionCompat.STATUS_DOWNLOADED)
                }).build()).build()
    }
    fun children(parent:String):List<MediaItem> {
        // Old saved head-unit bookmarks still resolve, but numbered folders are never emitted.
        if(parent.startsWith("car:group:")) {
            val parts=parent.removePrefix("car:group:").split(':',limit=2);require(parts.size==2)
            return CarIds.page(rawChildren(parts[1]),parts[0].toInt(),50)
        }
        val (base,offset)=CarIds.moreParts(parent) ?: (parent to 0)
        require(!parent.startsWith("car:more:") || base!=parent)
        val (visible,next)=CarIds.window(rawChildren(base),offset)
        return if(next==null)visible else visible+folder(CarIds.more(base,next),"More songs","Continue playlist",icon("more"),list=true)
    }
    private fun rawChildren(parent:String):List<MediaItem> = when {
        parent==CarIds.ROOT -> listOf(folder(CarIds.HOME,"Home",art=icon("home"),tab=true),folder(CarIds.DISCOVER,"Discover",art=icon("discover"),tab=true),folder(CarIds.LIBRARY,"Your library",art=icon("library"),tab=true),folder(CarIds.DOWNLOADS,"Downloads",art=icon("downloads"),tab=true))
        parent==CarIds.HOME -> {
            val recent=read("/api/v1/history",parent,true).tracks().take(6)
            listOf(favoriteTile("Made for you"),weeklyTile("Made for you"),tile(CarIds.RECOMMENDED,"Made for you","Inspired by your listening","#546BA5","Made for you"))+
                songs(CarIds.RECENT,recent,"Play it again",true)+editorials(parent,true,"Sidewave Sessions").take(4)
        }
        parent==CarIds.DISCOVER -> listOf(weeklyTile("Made for you"),tile(CarIds.RECOMMENDED,"Made for you","Make room for your favorites","#546BA5","Made for you"))+editorials(parent,false,"Find your sound")
        parent==CarIds.LIBRARY -> listOf(favoriteTile("Your music"),recentTile("Your music"),downloadTile("Your music"))+personalLists(parent,false,"Your playlists")
        parent==CarIds.DOWNLOADS -> songs(parent,repo.context.app.offline.items.value.filter{it.state==Download.STATE_COMPLETED}.map{it.track})
        parent==CarIds.FAVORITES -> songs(parent,read("/api/favoriler",parent).tracks())
        parent==CarIds.RECENT -> songs(parent,read("/api/v1/history",parent).tracks().take(50))
        parent==CarIds.WEEKLY -> {
            val data=read("/api/v1/discovery/weekly",parent);data.editorialSelection();songs(parent,data.tracks())
        }
        parent==CarIds.RECOMMENDED -> {
            val data=read("/api/v1/home",parent)
            val tracks=data.optJSONObject("sections")?.optJSONObject("forYou")?.optJSONArray("data")?.objects()?.mapNotNull{runCatching{it.track()}.getOrNull()}.orEmpty()
            songs(parent,tracks.ifEmpty{repo.cached("/api/v1/recommendations")?.tracks().orEmpty()})
        }
        parent==CarIds.PLAYLISTS -> personalLists(parent)
        parent==CarIds.COLLECTIONS -> editorials(parent)
        parent.startsWith("car:editorial:") -> {
            val id=parent.removePrefix("car:editorial:");require(id.matches(Regex("[a-z0-9-]{1,80}")))
            val data=read("/api/v1/collections/$id",parent);data.editorialSelection();songs(parent,data.tracks())
        }
        parent.startsWith("car:playlist:") -> songs(parent,read("/api/liste/${Uri.encode(parent.removePrefix("car:playlist:"))}",parent).tracks())
        parent.startsWith("car:search:") -> songs(parent,repo.cached(parent)?.tracks().orEmpty())
        else -> throw IllegalArgumentException("Library item not found")
    }
    fun item(id:String):MediaItem? {
        if(id==CarIds.ROOT)return folder(id,"Sidewave")
        if(id==CarIds.PLAYLISTS)return folder(id,"Your playlists")
        if(id==CarIds.COLLECTIONS)return folder(id,"Sidewave Sessions")
        CarIds.songParts(id)?.let{return rawChildren(it.first).firstOrNull{item->item.mediaId==id}}
        CarIds.moreParts(id)?.let{return children(it.first).firstOrNull{item->item.mediaId==id} ?: folder(id,"More songs","Continue playlist",icon("more"),list=true)}
        if(id.startsWith("car:group:"))return folder(id,"Songs")
        return rawChildren(CarIds.ROOT).firstOrNull{it.mediaId==id}
            ?: listOf(favoriteTile(),weeklyTile(),recentTile(),tile(CarIds.RECOMMENDED,"Made for you","Made for you","#546BA5")).firstOrNull{it.mediaId==id}
            ?: if(id.startsWith("car:playlist:"))personalLists(CarIds.PLAYLISTS).firstOrNull{it.mediaId==id}
            else if(id.startsWith("car:editorial:"))editorials(CarIds.COLLECTIONS).firstOrNull{it.mediaId==id} else null
    }
    fun queue(id:String):Pair<List<MediaItem>,Int> {
        val parent=requireNotNull(CarIds.songParts(id)).first
        val items=rawChildren(parent);val index=items.indexOfFirst{it.mediaId==id}
        require(index>=0){"This track is no longer in the playlist"};return items to index
    }
    fun isFavorite(track:com.sarginlabs.sidewave.api.Parca)=repo.cached("/api/favoriler")?.tracks().orEmpty().any{it.sameRecording(track)}
    fun favoriteChanged() {
        refreshAt.remove("/api/favoriler")
        scope.launch(Dispatchers.IO) {
            val counts=listOf(CarIds.FAVORITES,CarIds.HOME).map{it to children(it).size}
            withContext(Dispatchers.Main){counts.forEach{(id,count)->changed(id,count)}}
        }
    }
    fun search(query:String):List<MediaItem> {
        val term=query.trim().take(200);if(term.isEmpty())return emptyList()
        val editorial=repo.cached("/api/v1/collections")?.optJSONArray("listeler")?.objects().orEmpty().flatMap {repo.cached("/api/v1/collections/${it.optString("id")}")?.tracks().orEmpty()}
        val tracks=(repo.context.app.offline.items.value.filter{it.state==Download.STATE_COMPLETED}.map{it.track}+
            repo.cached("/api/favoriler")?.tracks().orEmpty()+repo.cached("/api/v1/history")?.tracks().orEmpty()+
            repo.cached("/api/v1/discovery/weekly")?.tracks().orEmpty()+editorial+
            repo.cached("/api/listeler")?.optJSONArray("listeler")?.objects().orEmpty().flatMap{repo.cached("/api/liste/${Uri.encode(it.optString("id"))}")?.tracks().orEmpty()})
            .distinctBy{it.key()}.filter{"${it.baslik} ${it.sanatci} ${it.album}".contains(term,ignoreCase=true)}.take(100)
        val parent="car:search:${digest(term.lowercase(java.util.Locale.ROOT))}"
        repo.save(parent,JSONObject().put("parcalar",tracks.jsonArray()));return songs(parent,tracks)
    }
}
