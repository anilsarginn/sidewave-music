package com.sarginlabs.sidewave

import android.Manifest
import android.os.Build
import android.os.Bundle
import android.content.Intent
import android.content.ClipData
import android.content.ClipboardManager
import android.net.Uri
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.enableEdgeToEdge
import androidx.activity.SystemBarStyle
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.ui.platform.LocalDensity
import kotlinx.coroutines.launch
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.ui.graphics.graphicsLayer
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.offline.Download
import coil.compose.AsyncImage
import com.sarginlabs.sidewave.api.Parca
import org.json.JSONObject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@UnstableApi
class MainActivity : ComponentActivity() {
    private var pendingVoice by mutableStateOf<String?>(null)
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent); setIntent(intent)
        if(intent.action==android.provider.MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH)
            pendingVoice=intent.getStringExtra(android.app.SearchManager.QUERY).orEmpty().take(200)
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        setTheme(R.style.Theme_Sidewave)
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(statusBarStyle=SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),navigationBarStyle=SystemBarStyle.dark(android.graphics.Color.TRANSPARENT))
        if(Build.VERSION.SDK_INT>=31) splashScreen.setOnExitAnimationListener { splash ->
            if(android.animation.ValueAnimator.areAnimatorsEnabled()) {
                splash.animate().alpha(0f).setDuration(260L).withEndAction { splash.remove() }.start()
            } else splash.remove()
        }
        if(savedInstanceState==null && intent.action==android.provider.MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH)
            pendingVoice=intent.getStringExtra(android.app.SearchManager.QUERY).orEmpty().take(200)
        setContent {
            val baseColors=darkColorScheme(primary=Color(0xFF53D880),onPrimary=Color(0xFF102D1B),primaryContainer=Color(0xFF193628),secondaryContainer=Color(0xFF252D28),background=Color(0xFF080C0A),surface=Color(0xFF111713),surfaceVariant=Color(0xFF202923),onSurface=Color(0xFFF0F4F1),onSurfaceVariant=Color(0xFFA4AFA7))
            MaterialTheme(colorScheme = baseColors) {
              MembershipEntry(applicationContext.app.repository) { identity ->
                val model: MusicViewModel = viewModel(key="music:"+identity)
                MaterialTheme(colorScheme = appearanceColors(baseColors,model.appearance.state)) {
                LaunchedEffect(pendingVoice,model.controller) {
                    val query=pendingVoice
                    if(query!=null && model.controller!=null) { pendingVoice=null; model.playVoiceSearch(query) }
                }
                SharedWallpaper(model.appearance.state) { MusicApp(model) }
                }
              }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@UnstableApi
@Composable
fun MusicApp(vm: MusicViewModel) {
    var libraryQuery by remember {mutableStateOf("")}
    var librarySort by remember {mutableStateOf("Playlist order")}
    var onlyDownloaded by remember {mutableStateOf(false)}
    var searchCategory by remember {mutableStateOf("All")}
    var settings by remember { mutableStateOf(false) }
    var appearanceSettings by remember { mutableStateOf(false) }
    var fullPlayer by remember { mutableStateOf(false) }
    var profileMenu by remember {mutableStateOf(false)}
    val profileScope=rememberCoroutineScope()
    var showQueue by remember { mutableStateOf(false) }
    var addTracks by remember { mutableStateOf<List<Parca>?>(null) }
    var newList by remember { mutableStateOf(false) }
    var renameList by remember { mutableStateOf(false) }
    var deleteList by remember { mutableStateOf(false) }
    var offlineScreen by remember { mutableStateOf(false) }
    var archiveScreen by remember { mutableStateOf(false) }
    var importReview by remember {mutableStateOf(false)}
    var importDialog by remember { mutableStateOf(false) }
    var selection by remember { mutableStateOf<Set<String>>(emptySet()) }
    var selecting by remember { mutableStateOf(false) }
    val downloads by vm.offline.items.collectAsState()
    val update by vm.updates.state.collectAsState()
    var filteredTracks by remember {mutableStateOf<List<Pair<Int,Parca>>>(emptyList())}
    LaunchedEffect(vm.detailTracks,libraryQuery,librarySort,onlyDownloaded,downloads) {
        val readyKeys=downloads.filter{it.state==Download.STATE_COMPLETED}.map{it.track.key()}.toSet()
        filteredTracks=withContext(Dispatchers.Default){
            vm.detailTracks.mapIndexed{i,t->i to t}.filter{(_,t)->(!onlyDownloaded||t.key() in readyKeys)&&"${t.baslik} ${t.sanatci} ${t.album.orEmpty()}".contains(libraryQuery,true)}.let{rows->when(librarySort){"Title"->rows.sortedBy{it.second.baslik};"Artist"->rows.sortedBy{it.second.sanatci};"Recently added"->rows.reversed();else->rows}}
        }
    }
    LaunchedEffect(vm.detailTitle){libraryQuery="";librarySort="Playlist order";onlyDownloaded=false}
    val playbackError by PlaybackNotice.error.collectAsState()
    val info by PlaybackNotice.info.collectAsState()
    val snackbar = remember { SnackbarHostState() }
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    val owner=LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val observer=LifecycleEventObserver {_,event->if(event==Lifecycle.Event.ON_RESUME)vm.checkUpdates(automatic=true)}
        owner.lifecycle.addObserver(observer);onDispose {owner.lifecycle.removeObserver(observer)}
    }
    LaunchedEffect(update.release?.versionCode) {
        val release=update.release
        if(release!=null && release.versionCode>vm.updates.currentVersionCode && vm.repo.prefs.getInt("updateNotified",0)<release.versionCode) {
            vm.repo.prefs.edit().putInt("updateNotified",release.versionCode).apply()
            if(snackbar.showSnackbar("Sidewave ${release.versionName} is ready.","Update",duration=SnackbarDuration.Long)==SnackbarResult.ActionPerformed)settings=true
        }
    }
    LaunchedEffect(Unit) { if(Build.VERSION.SDK_INT >= 33) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS) }
    LaunchedEffect(vm.notice) { vm.notice?.let { snackbar.showSnackbar(it); vm.notice = null } }
    LaunchedEffect(info) { info?.let { snackbar.showSnackbar(it); PlaybackNotice.info.value = null } }
    LaunchedEffect(vm.tab, vm.detailTitle) { selection = emptySet(); selecting = false }
    BackHandler(enabled=vm.detailTitle!=null && !fullPlayer) {vm.backDetail()}
    BackHandler(enabled=(offlineScreen||archiveScreen)&&!fullPlayer) {offlineScreen=false;archiveScreen=false}
    BackHandler(enabled=fullPlayer) {fullPlayer=false}
    LaunchedEffect(vm.tab,vm.detailTitle,offlineScreen,archiveScreen,fullPlayer) {
        if(vm.tab==0 && vm.detailTitle==null && !offlineScreen && !archiveScreen && !fullPlayer)vm.claimHomeIntro()
    }
    val displayed = if(vm.detailTitle != null) vm.detailTracks else vm.searchTracks
    val contentEntrance=remember{Animatable(1f)}
    LaunchedEffect(vm.tab,vm.detailTitle,offlineScreen,archiveScreen,fullPlayer) {
        contentEntrance.snapTo(.4f);contentEntrance.animateTo(1f,tween(220))
    }
    Scaffold(
        containerColor=MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(colors=TopAppBarDefaults.topAppBarColors(containerColor=MaterialTheme.colorScheme.surface),
                title={Text(if(fullPlayer)"Sidewave" else vm.detailTitle ?: if(offlineScreen)"Downloads" else if(archiveScreen)"Library downloads" else "Sidewave",fontWeight=FontWeight.Bold,maxLines=1,overflow=TextOverflow.Ellipsis)},
                navigationIcon={if(!fullPlayer && (vm.detailTitle!=null || offlineScreen || archiveScreen))IconButton(onClick={if(vm.detailTitle!=null)vm.backDetail() else vm.closeDetail();offlineScreen=false;archiveScreen=false}){Icon(Icons.AutoMirrored.Filled.ArrowBack,"Back")}},
                actions={Box(Modifier.padding(end=12.dp)) {
                    val name=vm.repo.prefs.getString("member-name",null) ?: "Music lover"
                    IconButton(onClick={profileMenu=true},modifier=Modifier.semantics{contentDescription="Profile"}) {BadgedBox(badge={if(update.release!=null)Badge()}) {Surface(shape=androidx.compose.foundation.shape.CircleShape,color=Color(0xFF9ACAAB)){Box(Modifier.size(34.dp),contentAlignment=Alignment.Center){Text(name.take(1).uppercase(),color=Color(0xFF153327),fontWeight=FontWeight.Bold)}}}}
                    DropdownMenu(profileMenu,{profileMenu=false}) {
                        Text(name,Modifier.padding(horizontal=16.dp,vertical=12.dp),fontWeight=FontWeight.Bold)
                        HorizontalDivider()
                        DropdownMenuItem(text={Text("Background & appearance")},leadingIcon={Icon(Icons.Default.Edit,null)},onClick={profileMenu=false;appearanceSettings=true})
                        DropdownMenuItem(text={Text("Downloads")},leadingIcon={Icon(MusicIcons.DownloadForOffline,null)},onClick={profileMenu=false;fullPlayer=false;vm.closeDetail();offlineScreen=true;archiveScreen=false})
                        DropdownMenuItem(text={Text("Settings & updates")},leadingIcon={Icon(Icons.Default.Settings,null)},onClick={profileMenu=false;settings=true;vm.loadDevices()})
                        HorizontalDivider()
                        DropdownMenuItem(text={Text("Sign out")},onClick={profileMenu=false;profileScope.launch {runCatching{vm.repo.fetch("/api/auth/logout","POST",JSONObject())}.onSuccess{vm.controller?.pause();vm.controller?.clearMediaItems();vm.repo.memberCookies.clear()}.onFailure{vm.notice=it.message}}})
                    }
                }})
        },
        bottomBar = {
            Column {
                vm.current?.takeIf{!fullPlayer}?.let { track ->
                    Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape=RoundedCornerShape(14.dp), modifier = Modifier.padding(horizontal=8.dp,vertical=4.dp).fillMaxWidth().clickable { fullPlayer = true }) {
                        Column {
                            Row(Modifier.padding(start = 10.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                Cover(track, vm, Modifier.size(45.dp))
                                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) { Text(track.baslik, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold); Text(if(vm.buffering) "Getting ready…" else track.sanatci, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                                IconButton(onClick = vm::toggle) { if(vm.buffering) CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp) else Icon(if(vm.playing) MusicIcons.Pause else Icons.Default.PlayArrow, if(vm.playing) "Pause" else "Play") }
                                IconButton(onClick = vm::next) { Icon(MusicIcons.SkipNext, "Next") }
                            }
                            if(vm.duration > 0) LinearProgressIndicator(progress = progressSnapshot(vm.position.toDouble(), vm.duration.toDouble()), modifier = Modifier.fillMaxWidth().height(2.dp))
                        }
                    }
                }
                NavigationBar(containerColor=MaterialTheme.colorScheme.surface) {
                    listOf("Home" to Icons.Default.Home, "Search" to Icons.Default.Search, "Your library" to MusicIcons.LibraryMusic).forEachIndexed { i, (name, icon) ->
                        NavigationBarItem(selected = vm.tab == i, onClick = { vm.tab = i; fullPlayer=false; vm.closeDetail(); offlineScreen = false; archiveScreen = false }, icon = { Icon(icon, name) }, label = { Text(name) })
                    }
                }
            }
        }
    ) { insets ->
        Column(Modifier.fillMaxSize().padding(insets).graphicsLayer {alpha=contentEntrance.value;translationY=(1f-contentEntrance.value)*12f}) {
            playbackError?.let { message ->
                Surface(color = MaterialTheme.colorScheme.errorContainer) { Column(Modifier.padding(12.dp).fillMaxWidth()) { Text(message, style = MaterialTheme.typography.bodySmall); Row { TextButton(onClick = vm::retry) { Text("Try again") }; TextButton(onClick = vm::next) { Text("Next") } } } }
            }
            if(vm.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            when {
                fullPlayer -> FullPlayer(vm,onClose={fullPlayer=false},onNavigate={fullPlayer=false;offlineScreen=false;archiveScreen=false},onQueue={showQueue=true},onAdd={vm.current?.let{addTracks=listOf(it)}})
                offlineScreen -> DownloadsScreen(vm, downloads)
                archiveScreen -> ArchivesScreen(vm)
                vm.detailKind == "collections" && vm.detailTitle != null -> EditorialBrowseScreen(vm)
                vm.detailTitle != null -> {
                    if(vm.detailBusy) LinearProgressIndicator(Modifier.fillMaxWidth())
                    vm.detailError?.let { Hint(it) }
                    Row(Modifier.padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        GlassButton(onClick = { vm.play(vm.detailTracks) }, enabled = vm.detailTracks.isNotEmpty()) { Icon(Icons.Default.PlayArrow, null); Text("Play") }
                        TextButton(onClick = { selecting = !selecting; selection = emptySet() }) { Text(if(selecting) "Cancel" else "Select") }
                        if(selecting) TextButton(onClick = { addTracks = displayed.filter { (it.entryId ?: it.key()) in selection } }, enabled = selection.isNotEmpty()) { Text("Add to (${selection.size})") }
                        if(selecting && vm.detailPlaylist != null) TextButton(onClick = { vm.removePlaylistEntries(displayed.filter { (it.entryId ?: it.key()) in selection }); selection=emptySet() }, enabled=selection.isNotEmpty()) { Text("Remove") }
                        else if(!selecting && vm.detailPlaylist != null) {
                            IconButton(onClick = { renameList = true }) { Icon(Icons.Default.Edit, "Rename") }
                            IconButton(onClick = { deleteList = true }) { Icon(MusicIcons.DeleteOutline, "Delete playlist") }
                        }
                    }
                    OutlinedTextField(libraryQuery,{libraryQuery=it},Modifier.fillMaxWidth().padding(horizontal=16.dp),label={Text("Search this list")},singleLine=true)
                    LazyRow(contentPadding=PaddingValues(horizontal=16.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)) {items(listOf("Playlist order","Title","Artist","Recently added")){name->FilterChip(librarySort==name,{librarySort=name},label={Text(name)})};item{FilterChip(onlyDownloaded,{onlyDownloaded=!onlyDownloaded},label={Text("Downloaded")})}}
                    LazyColumn(Modifier.weight(1f)) {
                        if(vm.detailKind in listOf("editorial","weekly")) item {EditorialDetailHeader(vm)}
                        else if(vm.detailKind.isNotBlank()) item { ProfileHeader(vm) }
                        vm.sonicResult?.let { result -> item {
                            Hint(result.textOrNull("message") ?: if(vm.sonicMode=="path") "A sound journey between your chosen tracks." else "Discover tracks with a similar sound.")
                            result.optJSONObject("analysis")?.let { a -> Hint("${a.optString("message")} · ${a.optInt("completed")}/${a.optInt("total")}. Scores are based on audio samples of up to 45 seconds.");if(a.optString("state")=="partial") TextButton(onClick=vm::retrySonicAnalysis){Text("Retry unavailable audio samples")} }
                        } }
                        if(vm.detailArtists.isNotEmpty()) item { ArtistStrip(vm.detailArtists,vm) }
                        if(vm.detailAlbums.isNotEmpty()) item { Discography(vm) }
                        if(vm.detailTracks.isEmpty() && !vm.detailBusy && vm.detailError == null) item { Hint(if(vm.detailKind.isBlank()) "No songs yet. Find a favorite and add it here." else "No tracks are available for this profile.") }
                        items(filteredTracks, key = { (index,t) -> t.entryId ?: "${t.key()}:$index" }) { (index, track) ->
                            TrackRow(track, vm, onPlay = { vm.play(vm.detailTracks, index) }, onAdd = { addTracks = listOf(track) }, selecting = selecting, checked = (track.entryId ?: track.key()) in selection, onCheck = { selection = selection.toggle(track.entryId ?: track.key()) }, playlistIndex = if(vm.detailPlaylist != null) index else null)
                        }
                    }
                }
                vm.tab == 0 -> LazyColumn {
                    item {HomeIntroduction(vm)}
                    item {Row(Modifier.padding(horizontal=16.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)){AssistChip(onClick=vm::openWeekly,label={Text("Discover Weekly")});AssistChip(onClick=vm::openEditorials,label={Text("Sidewave Sessions")})}}
                    if(vm.editorialCollections.isNotEmpty())item {EditorialStrip(vm)}
                    vm.homeWarning?.let{item{Hint(it)}}
                    vm.networkError?.let { item { Hint(it) } }
                    vm.current?.let { item { SectionTitle("Pick up where you left off"); Card(Modifier.fillMaxWidth().padding(horizontal = 16.dp).clickable { fullPlayer = true }) { Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) { Cover(it, vm, Modifier.size(56.dp)); Column(Modifier.weight(1f).padding(start=12.dp)) { Text(it.baslik, fontWeight = FontWeight.SemiBold); Text("${time(vm.position)} · ${it.sanatci}", style = MaterialTheme.typography.bodySmall) }; IconButton(onClick=vm::toggle) { Icon(Icons.Default.PlayArrow,"Continue") } } } } }
                    if(vm.history.isNotEmpty()) item { SectionTitle("Recently played"); TrackStrip(vm.history.take(12), vm) }
                    if(vm.dailyMixes.isNotEmpty()) item { SectionTitle("Your daily mixes"); MixStrip(vm) }
                    if(vm.playlists.isNotEmpty()) item { SectionTitle("Your playlists"); PlaylistStrip(vm) }
                    item { SectionTitle("Made for you") }
                    if(vm.recommendations.isEmpty()) item { Hint("Your next favorites will appear as you listen and like songs.") }
                    itemsIndexed(vm.recommendations.take(12)) { index, track -> TrackRow(track, vm, { vm.play(vm.recommendations, index) }, { addTracks = listOf(track) }, recommend = true);track.reason?.let{Text(it,Modifier.padding(start=76.dp,end=16.dp,bottom=10.dp),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)} }
                    if(vm.rediscover.isNotEmpty()) item {SectionTitle("Rediscover");TrackStrip(vm.rediscover,vm)}
                    if(vm.followedReleases.isNotEmpty()) item {SectionTitle("From artists you follow");AlbumStrip(vm.followedReleases,vm)}
                    if(vm.recentAlbums.isNotEmpty()) item { SectionTitle("From your library"); AlbumStrip(vm.recentAlbums, vm) }
                    if(vm.trends.isNotEmpty()) item { SectionTitle("Trending"); TrackStrip(vm.trends.take(12), vm) }
                    item { Spacer(Modifier.height(24.dp)) }
                }
                vm.tab == 1 -> {
                    OutlinedTextField(value = vm.query, onValueChange = vm::search, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), singleLine = true, placeholder = { Text("Songs, albums or artists") }, leadingIcon = { Icon(Icons.Default.Search, null) }, trailingIcon = { if(vm.query.isNotEmpty()) IconButton(onClick={vm.search("")}) { Icon(Icons.Default.Close,"Clear search") } })
                    LazyRow(contentPadding=PaddingValues(horizontal=16.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)){items(listOf("All","Songs","Artists","Albums")){category->FilterChip(searchCategory==category,{searchCategory=category},label={Text(category)})}}
                    if(vm.query.isBlank()&&vm.recentSearches.isNotEmpty()) LazyRow(contentPadding=PaddingValues(horizontal=16.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)){items(vm.recentSearches){q->AssistChip(onClick={vm.search(q)},label={Text(q)})}}
                    if(vm.searchBusy) LinearProgressIndicator(Modifier.fillMaxWidth())
                    vm.searchError?.let { Hint(it) }
                    if(vm.searchTracks.isNotEmpty()) Row(Modifier.padding(horizontal = 16.dp)) { TextButton(onClick={selecting=!selecting;selection=emptySet()}) { Text(if(selecting) "Cancel" else "Select songs") }; if(selecting) TextButton(onClick={addTracks=displayed.filter { (it.entryId ?: it.key()) in selection }}, enabled=selection.isNotEmpty()) { Text("Add to (${selection.size})") } }
                    LazyColumn {
                        if(vm.query.isBlank()) item { BrowseGrid(vm) }
                        if(searchCategory in listOf("All","Albums")&&vm.searchAlbums.isNotEmpty()) item { SectionTitle("Albums"); AlbumStrip(vm.searchAlbums, vm) }
                        if(searchCategory in listOf("All","Artists")&&vm.searchArtists.isNotEmpty()) item { SectionTitle("Artists"); LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) { items(vm.searchArtists) { artist -> AssistChip(onClick = { vm.openArtist(artist) }, label = { Text(artist.optString("ad")) }, leadingIcon = { Icon(Icons.Default.Person,null) }) } } }
                        if(vm.query.isNotBlank() && !vm.searchBusy && vm.searchTracks.isEmpty() && vm.searchError == null) item { Hint("No matching songs found.") }
                        if(searchCategory in listOf("All","Songs")) itemsIndexed(vm.searchTracks) { index, track -> TrackRow(track, vm, { vm.play(vm.searchTracks, index) }, { addTracks = listOf(track) }, selecting, (track.entryId ?: track.key()) in selection, {selection=selection.toggle(track.entryId ?: track.key())}) }
                    }
                }
                else -> LazyColumn {
                    vm.networkError?.let { item { Hint(it) } }
                    item {SectionTitle("Discover")}
                    item {LibraryButton("Discover Weekly","A fresh mix every Monday",Icons.Default.Star){vm.openWeekly()}}
                    item {LibraryButton("Sidewave Sessions","Jazz, funk, electronic and beyond",MusicIcons.QueueMusic){vm.openEditorials()}}
                    val recent=recentAlbumTracks(vm.history)
                    if(recent.isNotEmpty()) item { SectionTitle("Recently played albums"); RecentAlbumStrip(recent,vm) }
                    item { Row(Modifier.fillMaxWidth().padding(start=16.dp,end=8.dp,top=20.dp), verticalAlignment=Alignment.CenterVertically) { Text("Your playlists", style=MaterialTheme.typography.titleLarge, modifier=Modifier.weight(1f)); TextButton(onClick={newList=true}) { Icon(Icons.Default.Add,null);Text("New playlist") } } }
                    items(vm.playlists) { list -> LibraryButton(list.optString("ad"), "${list.optInt("parcaSayisi")} tracks", MusicIcons.QueueMusic) { vm.openPlaylist(list.getString("id"), list.optString("ad")) } }
                    if(vm.playlists.isEmpty()) item { Hint("Bring your favorite songs together. Create your first playlist.") }
                    items(vm.sharedPlaylists) { list -> LibraryButton(list.optString("ad"), "by ${list.optString("owner")}" + if(list.optString("mode")=="edit") " · collaborative" else " · shared", MusicIcons.QueueMusic) { vm.openShared(list) } }
                    item { TextButton(onClick={importDialog=true},modifier=Modifier.padding(horizontal=8.dp)){Icon(MusicIcons.FileOpen,null);Text("Import playlist")} }
                    if(vm.libraryAlbums.isNotEmpty()) item { SectionTitle("Saved albums"); AlbumStrip(vm.libraryAlbums,vm) }
                    if(vm.libraryArtists.isNotEmpty()) item { SectionTitle("Artists you follow"); ArtistStrip(vm.libraryArtists,vm) }
                    item { SectionTitle("Your music") }
                    item { LibraryButton("Liked Songs", "${vm.favorites.size} tracks", Icons.Default.Favorite) { vm.showFavorites() } }
                    item { LibraryButton("Downloads", "${downloads.count { it.state == Download.STATE_COMPLETED }} tracks · ${size(vm.offline.bytes)}", MusicIcons.DownloadForOffline) { offlineScreen = true } }
                    item { LibraryButton("Library downloads", "Track preparation and matching", MusicIcons.CloudDownload) { vm.loadArchives(); archiveScreen = true } }
                    item { LibraryButton("Review import matches","Review unmatched imported recordings",MusicIcons.FileOpen){importReview=true} }
                    item {Spacer(Modifier.height(24.dp))}
                }
            }
        }
    }
    if(newList || renameList) TextDialog(if(renameList) "Rename playlist" else "New playlist", if(renameList) vm.detailTitle.orEmpty() else "", onDismiss = {newList=false;renameList=false}) { value -> if(renameList) vm.detailPlaylist?.let { vm.renamePlaylist(it,value) } else vm.createPlaylist(value); newList=false;renameList=false }
    if(deleteList) AlertDialog(onDismissRequest={deleteList=false}, title={Text("Delete playlist?")}, text={Text("Your recordings will stay in your library.")}, confirmButton={TextButton(onClick={vm.detailPlaylist?.let(vm::deletePlaylist);deleteList=false}) {Text("Delete playlist")}}, dismissButton={TextButton(onClick={deleteList=false}) {Text("Cancel")}})
    addTracks?.let { tracks -> AlertDialog(onDismissRequest={addTracks=null}, title={Text("Add to playlist · ${tracks.size} tracks")}, text={LazyColumn { if(vm.playlists.isEmpty()) item { Text("Create a playlist in Your library first.") }; items(vm.playlists + vm.sharedPlaylists.filter { it.optString("mode") == "edit" }) { list -> ListItem(headlineContent={Text(list.optString("ad"))}, supportingContent=list.optString("owner").takeIf{it.isNotBlank()}?.let{{Text("by $it · collaborative")}}, modifier=Modifier.clickable { vm.addPlaylist(list.getString("id"), tracks);addTracks=null }) } }}, confirmButton={TextButton(onClick={addTracks=null}) {Text("Close")}}) }
    if(importReview) ImportReviewScreen(vm){importReview=false}
    if(importDialog) ImportDialog(vm) {importDialog=false;vm.closeImport()}
    if(settings) SettingsDialog(vm,onAppearance={settings=false;appearanceSettings=true}) {settings=false}
    if(appearanceSettings) AppearanceDialog(vm){appearanceSettings=false}
    if(showQueue) QueueDialog(vm) {showQueue=false}
}

fun Set<String>.toggle(value: String) = if(value in this) this - value else this + value
fun time(ms: Long): String = "${ms / 60000}:${((ms / 1000) % 60).toString().padStart(2,'0')}"
fun size(bytes: Long): String = if(bytes >= 1024L * 1024 * 1024) "%.1f GB".format(bytes.toDouble()/(1024*1024*1024)) else "%.0f MB".format(bytes.toDouble()/(1024*1024))
@Composable fun Hint(text: String) { Text(text, Modifier.padding(horizontal=16.dp,vertical=12.dp), style=MaterialTheme.typography.bodyMedium, color=MaterialTheme.colorScheme.onSurfaceVariant) }
@Composable fun SectionTitle(text: String) { Text(text, Modifier.padding(start=16.dp,top=24.dp,bottom=12.dp), style=MaterialTheme.typography.titleLarge, fontWeight=FontWeight.Bold) }
@UnstableApi @Composable fun Cover(track: Parca, vm: MusicViewModel, modifier: Modifier, detailed:Boolean=false) { Box(modifier.clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment=Alignment.Center) { Icon(MusicIcons.MusicNote,null,tint=MaterialTheme.colorScheme.primary); AsyncImage(model=if(detailed && !vm.repo.memberCookies.offline)vm.repo.coverUrl(track,800) else vm.repo.coverModel(track),contentDescription=null,modifier=Modifier.fillMaxSize(),contentScale=ContentScale.Crop) } }
@Composable fun LibraryButton(title: String, subtitle: String, icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: ()->Unit) { ListItem(colors=ListItemDefaults.colors(containerColor=MaterialTheme.colorScheme.surface),headlineContent={Text(title,fontWeight=FontWeight.SemiBold)},supportingContent={Text(subtitle)},leadingContent={Surface(shape=RoundedCornerShape(10.dp),color=MaterialTheme.colorScheme.surfaceVariant) {Icon(icon,null,Modifier.padding(14.dp),tint=MaterialTheme.colorScheme.primary)}},trailingContent={Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight,null)},modifier=Modifier.clickable(onClick=onClick)) }

@UnstableApi @Composable
fun TrackRow(track: Parca, vm: MusicViewModel, onPlay: ()->Unit, onAdd: ()->Unit, selecting: Boolean=false, checked: Boolean=false, onCheck: ()->Unit={}, playlistIndex: Int?=null, recommend: Boolean=false) {
    val downloaded = vm.offline.completed(track)
    ListItem(colors=ListItemDefaults.colors(containerColor=MaterialTheme.colorScheme.surface),modifier=Modifier.clickable {if(selecting) onCheck() else onPlay()},
        headlineContent={Text(track.baslik,maxLines=1,overflow=TextOverflow.Ellipsis,color=if(vm.current?.key()==track.key()) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)},
        supportingContent={Row(verticalAlignment=Alignment.CenterVertically) {if(downloaded) Icon(MusicIcons.DownloadDone,"Downloaded",Modifier.size(14.dp),tint=MaterialTheme.colorScheme.primary); Text(track.sanatci + (if(vm.sonicResult?.has("analysis")==true && vm.sonicScore(track)==null) " · Catalog suggestion" else "") + (vm.sonicScore(track)?.let {(if(vm.sonicResult?.has("analysis")==true) " · Sound sample %.2f" else " · Sound similarity %.2f").format(it)} ?: ""),maxLines=1,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.bodySmall)}},
        leadingContent={if(selecting) Checkbox(checked,onCheckedChange={onCheck()}) else Cover(track,vm,Modifier.size(48.dp))},
        trailingContent={TrackActionsMenu(track,vm,onAdd,playlistIndex,recommend)})
}

@UnstableApi @Composable
fun TrackActionsMenu(track: Parca, vm: MusicViewModel, onAdd: ()->Unit, playlistIndex: Int?=null, recommend: Boolean=false, onNavigate: ()->Unit={}) {
    var menu by remember(track.key()) {mutableStateOf(false)}
    val downloaded=vm.offline.completed(track)
    Box {
        IconButton(onClick={menu=true}) {Icon(Icons.Default.MoreVert,"${track.baslik} options")}
        DropdownMenu(expanded=menu,onDismissRequest={menu=false}) {
            DropdownMenuItem(text={Text(if(vm.isFavorite(track)) "Remove from liked songs" else "Like song")},onClick={vm.favorite(track);menu=false},leadingIcon={Icon(Icons.Default.FavoriteBorder,null)})
            DropdownMenuItem(text={Text("Add to playlist")},onClick={onAdd();menu=false})
            DropdownMenuItem(text={Text("Add to queue")},onClick={vm.addQueue(track);menu=false})
            if(track.sanatciId!=null) DropdownMenuItem(text={Text("Go to artist")},onClick={menu=false;onNavigate();vm.openTrackArtist(track)})
            if(track.albumId!=null) DropdownMenuItem(text={Text("Go to album")},onClick={menu=false;onNavigate();vm.openTrackAlbum(track)})
            DropdownMenuItem(text={Text("Instant mix")},onClick={menu=false;onNavigate();vm.sonic(track,"instant-mix")})
            DropdownMenuItem(text={Text("Discover similar tracks")},onClick={menu=false;onNavigate();vm.sonic(track,"similar-tracks")})
            DropdownMenuItem(text={Text("Start a sound journey")},onClick={menu=false;onNavigate();vm.chooseSonicStart(track)})
            if(vm.sonicStart!=null && vm.sonicStart?.key()!=track.key()) DropdownMenuItem(text={Text("Create a journey to this track")},onClick={menu=false;onNavigate();vm.sonic(track,"path")})
            DropdownMenuItem(text={Text("Song radio")},onClick={vm.radio(track);menu=false})
            if(track.kaynak=="kutuphane") DropdownMenuItem(text={Text(if(downloaded) "Remove download" else "Download")},onClick={if(downloaded) vm.offline.remove(track) else vm.download(track);menu=false})
            else DropdownMenuItem(text={Text("Save to library")},onClick={vm.archive(track);menu=false})
            if(track.kaynak=="kutuphane") DropdownMenuItem(text={Text("Download compatible MP3")},onClick={vm.download(track,true);menu=false})
            if(recommend) DropdownMenuItem(text={Text("Not for me")},onClick={vm.suppress(track);menu=false})
            if(playlistIndex!=null) {
                DropdownMenuItem(text={Text("Move up in playlist")},enabled=playlistIndex>0,onClick={vm.movePlaylist(playlistIndex,playlistIndex-1);menu=false})
                DropdownMenuItem(text={Text("Move down in playlist")},enabled=playlistIndex<vm.detailTracks.lastIndex,onClick={vm.movePlaylist(playlistIndex,playlistIndex+1);menu=false})
                DropdownMenuItem(text={Text("Remove from playlist")},onClick={vm.removeFromPlaylist(track);menu=false})
            }
        }
    }
}

/** Search landing like the web: colourful cards for weekly, liked songs, daily mixes and Sessions genres. */
@UnstableApi @Composable fun BrowseGrid(vm: MusicViewModel) {
    data class Card(val title: String, val color: Color, val open: () -> Unit)
    val parse = { value: String?, fallback: Color -> runCatching { Color(android.graphics.Color.parseColor(value)) }.getOrDefault(fallback) }
    val cards = buildList {
        add(Card("Discover Weekly", Color(0xFF477D95)) { vm.openWeekly() })
        add(Card("Liked Songs", Color(0xFF5B3FD1)) { vm.showFavorites() })
        vm.dailyMixes.forEach { mix -> add(Card(mix.optString("ad"), parse(mix.optString("renk"), Color(0xFFE8115B))) { vm.openMix(mix) }) }
        vm.editorialCollections.forEach { c -> add(Card(c.genre ?: c.title, parse(c.color, Color(0xFF1E3264))) { vm.openEditorial(c.id, c.title) }) }
    }
    Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Browse all", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        cards.chunked(2).forEach { row -> Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            row.forEach { card -> Box(Modifier.weight(1f).height(96.dp).clip(RoundedCornerShape(10.dp)).background(card.color).clickable(onClick = card.open).padding(12.dp)) {
                Text(card.title, color = Color.White, fontWeight = FontWeight.ExtraBold, fontSize = 17.sp, lineHeight = 20.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            } }
            if(row.size == 1) Spacer(Modifier.weight(1f))
        } }
    }
}

/** Daily mix cards: the anchor artist's cover on the mix colour, like the web home. */
@UnstableApi @Composable fun MixStrip(vm: MusicViewModel) { LazyRow(contentPadding=PaddingValues(horizontal=16.dp),horizontalArrangement=Arrangement.spacedBy(14.dp)) { items(vm.dailyMixes) { mix ->
    val color = runCatching { Color(android.graphics.Color.parseColor(mix.optString("renk"))) }.getOrDefault(MaterialTheme.colorScheme.primary)
    Column(Modifier.width(148.dp).clickable { vm.openMix(mix) }) {
        Box(Modifier.size(148.dp).clip(RoundedCornerShape(10.dp)).background(color)) {
            mix.optJSONObject("kapak")?.let { runCatching { it.track() }.getOrNull() }?.let { Cover(it, vm, Modifier.align(Alignment.TopCenter).padding(top=14.dp).size(96.dp).clip(androidx.compose.foundation.shape.CircleShape)) }
            Text(mix.optString("ad"), Modifier.align(Alignment.BottomStart).padding(10.dp), color=Color.White, fontWeight=FontWeight.Bold)
        }
        Text(mix.optString("altyazi"), Modifier.padding(top=8.dp), maxLines=2, overflow=TextOverflow.Ellipsis, style=MaterialTheme.typography.bodySmall, color=MaterialTheme.colorScheme.onSurfaceVariant)
    }
} } }
@UnstableApi @Composable fun TrackStrip(tracks: List<Parca>, vm: MusicViewModel) { LazyRow(contentPadding=PaddingValues(horizontal=16.dp),horizontalArrangement=Arrangement.spacedBy(14.dp)) { itemsIndexed(tracks) { i,t -> Column(Modifier.width(136.dp).clickable {vm.play(tracks,i)}) {Cover(t,vm,Modifier.size(136.dp));Text(t.baslik,Modifier.padding(top=8.dp),maxLines=1,overflow=TextOverflow.Ellipsis,fontWeight=FontWeight.SemiBold);Text(t.sanatci,maxLines=1,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)} } } }
@UnstableApi @Composable fun RecentAlbumStrip(tracks: List<Parca>, vm: MusicViewModel) {
    LazyRow(contentPadding=PaddingValues(horizontal=16.dp),horizontalArrangement=Arrangement.spacedBy(14.dp)) {
        items(tracks,key={"${it.kaynak}:${it.albumId}"}) {track ->
            Column(Modifier.width(136.dp).clickable {vm.openAlbum(JSONObject().put("id",track.albumId).put("ad",track.album).put("kaynak",track.kaynak))}) {
                Cover(if(track.kaynak=="kutuphane")track.copy(kapakId=track.kapakId?:track.albumId) else track,vm,Modifier.size(136.dp))
                Text(track.album.orEmpty(),Modifier.padding(top=8.dp),maxLines=1,overflow=TextOverflow.Ellipsis,fontWeight=FontWeight.SemiBold)
                Text(track.sanatci,maxLines=1,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
@UnstableApi @Composable fun AlbumStrip(albums: List<JSONObject>, vm: MusicViewModel) { LazyRow(contentPadding=PaddingValues(horizontal=16.dp),horizontalArrangement=Arrangement.spacedBy(14.dp)) {items(albums) {a -> Column(Modifier.width(136.dp).clickable {vm.openAlbum(a)}) {Cover(Parca(id=a.optString("id"),baslik=a.optString("ad"),kaynak=a.optString("kaynak","kutuphane"),kapakId=if(a.optString("kaynak")!="youtube") a.optString("kapakId",a.optString("id")) else null,kapakUrl=a.textOrNull("kapakUrl") ?: a.textOrNull("kapak")),vm,Modifier.size(136.dp));Text(a.optString("ad",a.optString("baslik")),Modifier.padding(top=8.dp),maxLines=1,overflow=TextOverflow.Ellipsis);Text(a.optString("sanatci"),maxLines=1,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)} } } }
@UnstableApi @Composable fun PlaylistStrip(vm: MusicViewModel) {LazyRow(contentPadding=PaddingValues(horizontal=16.dp),horizontalArrangement=Arrangement.spacedBy(10.dp)) {items(vm.playlists) {p -> Card(Modifier.width(170.dp).clickable {vm.openPlaylist(p.getString("id"),p.optString("ad"))}) {Column(Modifier.padding(16.dp)) {Icon(MusicIcons.QueueMusic,null,tint=MaterialTheme.colorScheme.primary);Spacer(Modifier.height(14.dp));Text(p.optString("ad"),maxLines=1,fontWeight=FontWeight.Bold);Text("${p.optInt("parcaSayisi")} tracks",style=MaterialTheme.typography.bodySmall)}}} } }

@Composable fun TextDialog(title: String, initial: String, onDismiss: ()->Unit, onSave: (String)->Unit) {
    var name by remember {mutableStateOf(initial)}
    AlertDialog(onDismissRequest=onDismiss,title={Text(title)},text={OutlinedTextField(name,{name=it.take(120)},label={Text("Playlist name")},singleLine=true)},confirmButton={TextButton(onClick={onSave(name.trim())},enabled=name.isNotBlank()) {Text("Save")}},dismissButton={TextButton(onClick=onDismiss) {Text("Cancel")}})
}

@OptIn(ExperimentalMaterial3Api::class)
@UnstableApi @Composable fun FullPlayer(vm: MusicViewModel, onClose: ()->Unit, onNavigate: ()->Unit, onQueue: ()->Unit, onAdd: ()->Unit) {
    val track = vm.current ?: return
    val error by PlaybackNotice.error.collectAsState()
    var dragging by remember(track.entryId ?: track.key()) {mutableStateOf(false)}
    var slider by remember(track.entryId ?: track.key()) {mutableFloatStateOf(0f)}
    var details by remember {mutableStateOf(false)}
    val duration = vm.duration
    val position = vm.position
    val coverSize=minOf(280f,LocalConfiguration.current.screenHeightDp*.26f).dp
    Surface(Modifier.fillMaxSize(),color=MaterialTheme.colorScheme.background) {
            Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal=24.dp).widthIn(max=680.dp),horizontalAlignment=Alignment.CenterHorizontally) {
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {IconButton(onClick=onClose) {Icon(Icons.Default.KeyboardArrowDown,"Back to browsing")};Text("NOW PLAYING",Modifier.weight(1f),style=MaterialTheme.typography.labelLarge);IconButton(onClick=onQueue) {Icon(MusicIcons.QueueMusic,"Open queue")};TrackActionsMenu(track,vm,onAdd,onNavigate=onNavigate)}
                error?.let { Text(it,color=MaterialTheme.colorScheme.error);TextButton(onClick=vm::retry){Text("Try again")} }
                Spacer(Modifier.height(12.dp));Cover(track,vm,Modifier.size(coverSize),detailed=true);Spacer(Modifier.height(22.dp))
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {Column(Modifier.weight(1f)) {Text(track.baslik,fontSize=28.sp,fontWeight=FontWeight.Bold,lineHeight=33.sp,maxLines=2,overflow=TextOverflow.Ellipsis);Text(track.sanatci,color=MaterialTheme.colorScheme.onSurfaceVariant,modifier=Modifier.padding(vertical=8.dp).clickable(enabled=track.sanatciId!=null){vm.openTrackArtist(track);onNavigate()}); if(track.albumId!=null)Text(track.album ?: "Open album",fontSize=11.sp,color=MaterialTheme.colorScheme.onSurfaceVariant,modifier=Modifier.padding(bottom=8.dp).clickable{vm.openTrackAlbum(track);onNavigate()})};IconButton(onClick={vm.favorite(track)}) {Icon(if(vm.isFavorite(track)) Icons.Default.Favorite else Icons.Default.FavoriteBorder,"Like song",tint=MaterialTheme.colorScheme.primary)}}

                Slider(value=seekSliderValue(if(dragging) slider else position.toFloat(), duration),onValueChange={dragging=true;slider=seekSliderValue(it,duration)},valueRange=0f..duration.toFloat().coerceAtLeast(1f),onValueChangeFinished={if(duration>0) vm.seek(seekSliderValue(slider,duration).toLong());dragging=false},enabled=duration>0)
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) {Text(time(if(dragging) seekSliderValue(slider,duration).toLong() else position),style=MaterialTheme.typography.labelMedium);Text(time(duration),style=MaterialTheme.typography.labelMedium)}
                Row(Modifier.fillMaxWidth().padding(vertical=24.dp),horizontalArrangement=Arrangement.SpaceBetween,verticalAlignment=Alignment.CenterVertically) {
                    IconButton(onClick=vm::toggleShuffle) {Icon(MusicIcons.Shuffle,if(vm.shuffle) "Shuffle on" else "Shuffle",tint=if(vm.shuffle) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)}
                    IconButton(onClick=vm::previous) {Icon(MusicIcons.SkipPrevious,"Previous",Modifier.size(36.dp))}
                    FilledIconButton(onClick=vm::toggle,modifier=Modifier.size(76.dp)) {if(vm.buffering) CircularProgressIndicator(Modifier.size(32.dp),color=MaterialTheme.colorScheme.onPrimary) else Icon(if(vm.playing) MusicIcons.Pause else Icons.Default.PlayArrow,if(vm.playing) "Pause" else "Play",Modifier.size(42.dp))}
                    IconButton(onClick=vm::next) {Icon(MusicIcons.SkipNext,"Next",Modifier.size(36.dp))}
                    IconButton(onClick=vm::toggleRepeat) {Icon(if(vm.repeat==Player.REPEAT_MODE_ONE) MusicIcons.RepeatOne else MusicIcons.Repeat,when(vm.repeat){1->"Repeat one";2->"Repeat all";else->"Repeat off"},tint=if(vm.repeat!=Player.REPEAT_MODE_OFF) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)}
                }

                OutlinedButton(onClick={onNavigate();vm.sonic(track,"similar-tracks")},modifier=Modifier.fillMaxWidth().padding(top=8.dp).heightIn(min=48.dp)) {Icon(Icons.Default.Search,null);Spacer(Modifier.width(8.dp));Text("Discover similar tracks")}
                Row(Modifier.padding(vertical=12.dp),horizontalArrangement=Arrangement.spacedBy(16.dp)) {TextButton(onClick=onAdd) {Icon(MusicIcons.PlaylistAdd,null);Text("Add to playlist")};TextButton(onClick={if(track.kaynak=="kutuphane") vm.download(track) else vm.archive(track)}) {Icon(MusicIcons.Download,null);Text(if(track.kaynak=="kutuphane") "Download" else "Save to library")}}
                Row(verticalAlignment=Alignment.CenterVertically) {Text("Autoplay",Modifier.weight(1f));Switch(vm.radioEnabled,vm::setRadio)}
                Row(verticalAlignment=Alignment.CenterVertically) {Text("Even volume",Modifier.weight(1f));Switch(vm.evenVolume,vm::changeEvenVolume)}
                val shareContext = LocalContext.current
                TextButton(onClick={vm.shareTrack(track, shareContext)}){Icon(Icons.Default.Share,null,Modifier.size(18.dp));Spacer(Modifier.width(8.dp));Text("Share song")}
                TextButton(onClick={details=!details}){Text(if(details)"Hide lyrics & credits" else "Lyrics & credits")}
                if(details)InlineLyrics(vm,track)
                SleepTimerControls()
                Spacer(Modifier.height(24.dp))
            }
        }
}

@OptIn(ExperimentalMaterial3Api::class)
@UnstableApi @Composable fun QueueDialog(vm: MusicViewModel,onClose:()->Unit) {
    val listState=rememberLazyListState();val scope=rememberCoroutineScope();val threshold=with(LocalDensity.current){72.dp.toPx()}
    Dialog(onDismissRequest=onClose,properties=DialogProperties(usePlatformDefaultWidth=false,decorFitsSystemWindows=false)) {
        Scaffold(modifier=Modifier.safeDrawingPadding(),topBar={TopAppBar(title={Text("Play queue")},navigationIcon={IconButton(onClick=onClose){Icon(Icons.AutoMirrored.Filled.ArrowBack,"Back")}})}) {insets ->
            LazyColumn(Modifier.padding(insets),state=listState) {
                item { Row {TextButton(onClick=vm::undoQueueRemoval){Text("Undo removal")};TextButton(onClick={scope.launch{listState.animateScrollToItem((vm.queue.indexOfFirst{it.entryId==vm.current?.entryId}+1).coerceAtLeast(0))}}){Text("Back to current song")}}}
                if(vm.queue.isEmpty()) item {Hint("Your queue is empty.")}
                itemsIndexed(vm.queue,key={i,t->t.entryId ?: "${t.key()}:$i"}) {i,t ->
                    ListItem(modifier=Modifier.pointerInput(t.entryId){var distance=0f;detectDragGesturesAfterLongPress(onDragStart={distance=0f},onDrag={change,delta->change.consume();distance+=delta.y;if(kotlin.math.abs(distance)>threshold){val from=vm.queue.indexOfFirst{it.entryId==t.entryId};if(from>=0)vm.moveQueue(from,from+if(distance>0)1 else -1);distance=0f}})}.clickable {vm.selectQueue(i)},headlineContent={Text(t.baslik,maxLines=1,overflow=TextOverflow.Ellipsis,color=if(vm.current?.entryId==t.entryId) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)},supportingContent={Text(t.sanatci,maxLines=1)},leadingContent={Cover(t,vm,Modifier.size(40.dp))},trailingContent={Row {IconButton(onClick={vm.moveQueue(i,i-1)},enabled=i>0){Icon(MusicIcons.ArrowUpward,"Move up")};IconButton(onClick={vm.moveQueue(i,i+1)},enabled=i<vm.queue.lastIndex){Icon(MusicIcons.ArrowDownward,"Move down")};IconButton(onClick={vm.removeQueue(i)}){Icon(Icons.Default.Close,"Remove from queue")}}})
                }
            }
        }
    }
}

@UnstableApi @Composable fun SettingsDialog(vm: MusicViewModel,onAppearance:()->Unit,onClose:()->Unit) {
    val memberScope=rememberCoroutineScope()
    var server by remember {mutableStateOf(vm.repo.base)}
    var wifi by remember {mutableStateOf(vm.offline.wifiOnly)}
    val context=LocalContext.current
    val update by vm.updates.state.collectAsState()
    var acceptance by remember {mutableStateOf(false)}
    var diagnosticReport by remember { mutableStateOf("") }
    LaunchedEffect(Unit) { diagnosticReport = withContext(Dispatchers.IO) { context.app.diagnostics.report() } }
    val installPermission=rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        if(context.packageManager.canRequestPackageInstalls())vm.installUpdate(context)
        else vm.notice="Installation permission was not granted. You can install your update later."
    }
    AlertDialog(onDismissRequest=onClose,title={Text("Settings")},text={Column(Modifier.verticalScroll(rememberScrollState())) {
        Text("Server address",fontWeight=FontWeight.Bold);OutlinedTextField(server,{server=it},singleLine=true,modifier=Modifier.fillMaxWidth(),placeholder={Text(DEFAULT_SERVER_URL)});TextButton(onClick={vm.setServer(server)}){Text("Save connection")}
        Text("Connect to your music server for online listening. Your downloads remain available offline.",style=MaterialTheme.typography.bodySmall)
        Text("Android Auto supports Downloads, Liked Songs and your playlists. Downloaded music remains available offline.",Modifier.padding(top=12.dp),style=MaterialTheme.typography.bodySmall)
        Text("If the app is missing in Android Auto, enable Unknown sources in developer settings and check Customize launcher.",Modifier.padding(top=6.dp),style=MaterialTheme.typography.bodySmall)
        HorizontalDivider(Modifier.padding(vertical=16.dp));Text("Home screen widgets",fontWeight=FontWeight.Bold)
        Text("Keep your music close. Choose a player to add to your home screen.",style=MaterialTheme.typography.bodySmall)
        if(android.appwidget.AppWidgetManager.getInstance(context).isRequestPinAppWidgetSupported) {
            TextButton(onClick={android.appwidget.AppWidgetManager.getInstance(context).requestPinAppWidget(android.content.ComponentName(context,MiniPlayerWidget::class.java),null,null)}){Text("Add mini player")}
            TextButton(onClick={android.appwidget.AppWidgetManager.getInstance(context).requestPinAppWidget(android.content.ComponentName(context,NowPlayingWidget::class.java),null,null)}){Text("Add now playing")}
            TextButton(onClick={android.appwidget.AppWidgetManager.getInstance(context).requestPinAppWidget(android.content.ComponentName(context,YourMusicWidget::class.java),null,null)}){Text("Add your music")}
        } else Text("Touch and hold your home screen, open Widgets, then choose Sidewave.",style=MaterialTheme.typography.bodySmall)
        HorizontalDivider(Modifier.padding(vertical=16.dp));Text("App updates",fontWeight=FontWeight.Bold)
        Text("Installed version: ${vm.updates.currentVersionName}",style=MaterialTheme.typography.bodySmall)
        update.message?.let {Text(it,Modifier.padding(top=6.dp),style=MaterialTheme.typography.bodySmall)}
        update.release?.let {release->
            if(release.notes.isNotBlank())Text(release.notes,Modifier.padding(top=8.dp),style=MaterialTheme.typography.bodySmall)
            if(update.status=="downloading"){
                LinearProgressIndicator(progress=progressSnapshot(update.downloaded.toDouble(),release.sizeBytes.toDouble()),modifier=Modifier.fillMaxWidth().padding(top=12.dp))
                Text("${size(update.downloaded)} / ${size(release.sizeBytes.toLong())}",style=MaterialTheme.typography.labelSmall)
                TextButton(onClick=vm::cancelUpdateDownload){Text("Cancel download")}
            }else if(update.status=="ready"){
                GlassButton(onClick={
                    if(context.packageManager.canRequestPackageInstalls())vm.installUpdate(context)
                    else runCatching {installPermission.launch(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:${context.packageName}")))}.onFailure {vm.notice="Could not open installation permissions."}
                }){Text("Install update")}
                Text("Confirm installation in Android to finish updating.",style=MaterialTheme.typography.bodySmall)
            }else if(update.status=="available")GlassButton(onClick=vm::downloadUpdate){Text("Download · ${size(release.sizeBytes.toLong())}")}
        }
        TextButton(onClick={vm.checkUpdates()},enabled=update.status !in listOf("checking","downloading")){Text(if(update.status=="checking")"Checking…" else "Check for updates")}
        HorizontalDivider(Modifier.padding(vertical=16.dp));Row(verticalAlignment=Alignment.CenterVertically){Text("Download on Wi-Fi only",Modifier.weight(1f));Switch(wifi,{wifi=it;vm.offline.wifiOnly=it})};Text("Download storage: ${size(vm.offline.bytes)}",style=MaterialTheme.typography.bodySmall)
        HorizontalDivider(Modifier.padding(vertical=16.dp));Text("Devices",fontWeight=FontWeight.Bold)
        if(vm.devices.isEmpty()) Text("Connect to see your devices.",style=MaterialTheme.typography.bodySmall)
        vm.devices.forEach {device->Text("${device.optString("name", "Device")} · ${if(device.optString("state")=="playing") "playing" else "paused"}",Modifier.padding(vertical=6.dp),style=MaterialTheme.typography.bodySmall)}
        GlassButton(onClick={vm.takeover();onClose()},enabled=vm.devices.isNotEmpty()){Text("Play on this device")}
        HorizontalDivider(Modifier.padding(vertical=16.dp))
        HorizontalDivider(Modifier.padding(vertical=16.dp))
        GlassButton(onClick={acceptance=true}){Text("Diagnostics")}
        Text("Crash diagnostics", fontWeight=FontWeight.Bold)
        Text("Diagnostic reports stay on this phone and omit song, connection and account details.", style=MaterialTheme.typography.bodySmall)
        TextButton(onClick={
            context.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Sidewave diagnostic report",diagnosticReport))
            vm.notice="Diagnostic report copied."
        }, enabled=diagnosticReport.isNotBlank()) { Text("Copy diagnostic report") }
        Spacer(Modifier.height(12.dp));Text("Sidewave ${vm.updates.currentVersionName} · Android 10+",style=MaterialTheme.typography.labelSmall)
    }},confirmButton={TextButton(onClick=onClose){Text("Close")}})
    if(acceptance) AcceptanceScreen(vm){acceptance=false}
}

@UnstableApi @Composable fun DownloadsScreen(vm: MusicViewModel,downloads:List<OfflineItem>) {
    val ready = downloads.filter {it.state==Download.STATE_COMPLETED}.map {it.track}
    LazyColumn {
        item {Hint("Only completed phone downloads are available offline.")}
        item {Row(Modifier.padding(horizontal=16.dp),verticalAlignment=Alignment.CenterVertically) {GlassButton(onClick={vm.play(ready)},enabled=ready.isNotEmpty()){Icon(Icons.Default.PlayArrow,null);Text("Play downloads")};Spacer(Modifier.weight(1f));Text(size(vm.offline.bytes),style=MaterialTheme.typography.labelLarge)}}
        item {Row(Modifier.padding(horizontal=16.dp)){TextButton(onClick={downloads.filter{it.state!=Download.STATE_COMPLETED}.forEach{vm.offline.pause(it.track,true)}}){Text("Pause all")};TextButton(onClick={downloads.filter{it.stopped}.forEach{vm.offline.pause(it.track,false)}}){Text("Resume")};TextButton(onClick={downloads.filter{it.state==Download.STATE_FAILED}.forEach{vm.download(it.track)}}){Text("Try again")}}}
        if(downloads.isEmpty()) item {Hint("No downloads yet. Choose Download from a song's menu.")}
        items(downloads,key={it.track.key()}) {d ->
            Column {
                ListItem(headlineContent={Text(d.track.baslik,maxLines=1,overflow=TextOverflow.Ellipsis)},supportingContent={Text(when {d.state==Download.STATE_COMPLETED->"Downloaded · ${size(d.bytes)}";d.state==Download.STATE_FAILED->"Download failed · try again";d.stopped->"Paused · ${size(d.bytes)}";d.state==Download.STATE_QUEUED->"Waiting for a connection";d.state==Download.STATE_REMOVING->"Removing…";else->"Downloading · ${size(d.bytes)}"},style=MaterialTheme.typography.bodySmall)},leadingContent={Cover(d.track,vm,Modifier.size(48.dp))},trailingContent={Row {
                    if(d.state==Download.STATE_COMPLETED) IconButton(onClick={vm.play(ready,ready.indexOfFirst {it.key()==d.track.key()}.coerceAtLeast(0))}){Icon(Icons.Default.PlayArrow,"Play downloaded track")}
                    else if(d.state==Download.STATE_FAILED) IconButton(onClick={vm.download(d.track)}){Icon(Icons.Default.Refresh,"Yeniden indir")}
                    else IconButton(onClick={vm.offline.pause(d.track,!d.stopped)}){Icon(if(d.stopped) Icons.Default.PlayArrow else MusicIcons.Pause,if(d.stopped) "Resume download" else "Pause download")}
                    IconButton(onClick={vm.offline.remove(d.track)}){Icon(MusicIcons.DeleteOutline,"Remove download")}
                }})
                if(d.state==Download.STATE_DOWNLOADING) if(d.percent.isFinite() && d.percent>=0) LinearProgressIndicator(progress=progressSnapshot(d.percent.toDouble(),100.0),modifier=Modifier.fillMaxWidth().padding(horizontal=16.dp)) else LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal=16.dp))
            }
        }
    }
}

@UnstableApi @Composable fun ArchivesScreen(vm:MusicViewModel) {
    LazyColumn {
        item {Hint("A recording is ready when its file has been verified and added to your library.")}
        if(vm.archiveJobs.isEmpty()) item {Hint("No library downloads yet. Save a song from its menu to get started.")}
        items(vm.archiveJobs) {job ->
            val track = job.optJSONObject("parca")?.let {runCatching{it.track()}.getOrNull()}
            Card(Modifier.fillMaxWidth().padding(horizontal=16.dp,vertical=6.dp)) {
                Column(Modifier.padding(16.dp)) {
                    Text(track?.baslik ?: "Library download",fontWeight=FontWeight.Bold)
                    Text(job.optString("mesaj",job.optString("durum")),style=MaterialTheme.typography.bodySmall,modifier=Modifier.padding(top=6.dp))
                    if(job.optString("durum")=="eslesme_bekliyor") {
                        Text("Choose the recording and version:",Modifier.padding(top=12.dp))
                        job.optJSONArray("candidates")?.objects()?.forEach {c ->
                            OutlinedButton(onClick={vm.chooseArchive(job.getString("id"),c.getString("candidateId"))},modifier=Modifier.fillMaxWidth()) {Text("${c.optString("dosyaAdi")} · ${c.optString("bicim")} ${c.optString("bitrate")} kbps",maxLines=3,style=MaterialTheme.typography.labelSmall)}
                        }
                    }
                    if(job.optString("durum")=="hazir") job.optJSONObject("localTrack")?.let {local->runCatching{local.track()}.getOrNull()}?.let {local->GlassButton(onClick={vm.download(local)}){Icon(MusicIcons.Download,null);Text("Download")}}
                }
            }
        }
    }
}

@UnstableApi @Composable fun ImportDialog(vm:MusicViewModel,onClose:()->Unit) {
    var content by remember {mutableStateOf("")}
    var format by remember {mutableStateOf("text")}
    var name by remember {mutableStateOf("Imported playlist")}
    var selected by remember {mutableStateOf<Map<Int,Parca>>(emptyMap())}
    val preview = vm.importPreview
    LaunchedEffect(preview) {selected=preview?.optJSONArray("rows")?.objects()?.mapNotNull {r->r.optJSONObject("selected")?.let {runCatching {r.getInt("index") to it.track()}.getOrNull()}}?.toMap().orEmpty()}
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) {uri ->
        uri?.let {
            runCatching {vm.repo.context.contentResolver.openInputStream(it)?.use {input->readLimited(input)}}
                .onSuccess {text->content=text.orEmpty();if(content.startsWith("#EXTM3U")) format="m3u" else if(content.lineSequence().firstOrNull()?.contains(',')==true) format="csv"}
                .onFailure {vm.notice=it.message ?: "Could not read this file."}
        }
    }
    AlertDialog(onDismissRequest=onClose,title={Text("Import playlist")},text={Column(Modifier.heightIn(max=500.dp).verticalScroll(rememberScrollState())) {
        OutlinedTextField(name,{name=it.take(120)},label={Text("New playlist name")},singleLine=true)
        if(preview==null) {
            Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){listOf("text" to "Metin","csv" to "CSV","m3u" to "M3U").forEach {(value,label)->FilterChip(selected=format==value,onClick={format=value},label={Text(label)})}}
            OutlinedTextField(content,{content=it.take(2_000_000)},label={Text("Artist - Song, one recording per line")},minLines=4,maxLines=8)
            TextButton(onClick={picker.launch(arrayOf("text/*","audio/x-mpegurl","application/vnd.apple.mpegurl","application/octet-stream"))}){Icon(MusicIcons.FileOpen,null);Text("Choose file")}
            Text("Review your matches before importing.",style=MaterialTheme.typography.bodySmall)
        } else {
            if(preview.optBoolean("pending")) {LinearProgressIndicator(Modifier.fillMaxWidth()); Text("Matching: ${preview.optInt("completed")} / ${preview.optInt("total")}")}
            Text("${preview.optInt("duplicates")} duplicates removed. ${selected.size} recordings selected.",style=MaterialTheme.typography.bodySmall)
            if(!preview.optBoolean("pending")) preview.optJSONArray("rows")?.objects()?.forEach {row->
                val index=row.getInt("index")
                HorizontalDivider(Modifier.padding(vertical=8.dp));Text("${row.optString("sanatci")} - ${row.optString("baslik")}",fontWeight=FontWeight.SemiBold)
                val candidates=row.optJSONArray("candidates")?.objects()?.mapNotNull {runCatching{it.track()}.getOrNull()}.orEmpty()
                if(candidates.isEmpty()) Text("No match found. This track will be skipped.",style=MaterialTheme.typography.bodySmall)
                candidates.forEach {track->Row(Modifier.clickable {selected=if(selected[index]?.key()==track.key()) selected-index else selected+(index to track)},verticalAlignment=Alignment.CenterVertically){RadioButton(selected[index]?.key()==track.key(),onClick={selected=if(selected[index]?.key()==track.key()) selected-index else selected+(index to track)});Column {Text(track.baslik,style=MaterialTheme.typography.bodySmall);Text("${track.sanatci} · ${track.album.orEmpty()}",style=MaterialTheme.typography.labelSmall)}}}
            }
        }
    }},confirmButton={TextButton(onClick={if(preview==null) vm.previewImport(content,format) else {vm.commitImport(name.trim(),selected.toSortedMap().values.toList());onClose()}},enabled=name.isNotBlank()&&(if(preview==null) content.isNotBlank() else selected.isNotEmpty() && !preview.optBoolean("pending"))){Text(if(preview==null) "Preview" else "Create playlist")}},dismissButton={TextButton(onClick=onClose){Text("Cancel")}})
}

@UnstableApi @Composable fun ArtistStrip(artists: List<JSONObject>, vm: MusicViewModel) {
    LazyRow(contentPadding=PaddingValues(horizontal=16.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
        items(artists) { artist -> AssistChip(onClick={vm.openArtist(artist)},label={Text(artist.optString("ad"))},leadingIcon={Icon(Icons.Default.Person,null)}) }
    }
}
@UnstableApi @Composable fun ProfileHeader(vm: MusicViewModel) {
    val data=vm.detailData ?: return
    var biography by remember(data.optString("appId")) { mutableStateOf(false) }
    val isArtist=vm.detailKind=="artist"
    val saved=data.optBoolean(if(isArtist) "takip" else "kayitli")
    val image=Parca(id="profile:${data.optString("appId")}",baslik=data.optString("ad"),kaynak=data.optString("kaynak","kutuphane"),kapakId=data.textOrNull("kapakId"),kapakUrl=data.textOrNull("gorselUrl") ?: data.textOrNull("kapak"))
    LaunchedEffect(image.key()) { vm.repo.saveArtwork(image) }
    Column(Modifier.fillMaxWidth().padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
        Cover(image,vm,Modifier.size(160.dp))
        Text(data.optString("ad"),style=MaterialTheme.typography.headlineMedium,fontWeight=FontWeight.Bold)
        if(isArtist && data.textOrNull("subscribers")!=null) Text("${data.optString("subscribers")} subscribers",style=MaterialTheme.typography.bodySmall)
        if(!isArtist) Text(listOfNotNull(data.textOrNull("sanatci"),data.textOrNull("yil"),"${vm.detailTracks.size} tracks").joinToString(" · "),style=MaterialTheme.typography.bodySmall)
        Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick=vm::toggleDetailSaved,enabled=!vm.detailSaving && data.textOrNull("appId")!=null) {Text(if(vm.detailSaving) "Saving…" else if(isArtist) {if(saved) "Following" else "Follow"} else {if(saved) "In your library" else "Save album"})}
            OutlinedButton(onClick={vm.play(vm.detailTracks.shuffled())},enabled=vm.detailTracks.isNotEmpty()) {Text("Shuffle")}
        }
        if(isArtist && data.optString("kaynak")=="kutuphane") TextButton(onClick=vm::similarArtists) {Text("Similar artists")}
        data.textOrNull("biyografi")?.let { text -> TextButton(onClick={biography=!biography}) {Text(if(biography) "Show less" else "About the artist")}; if(biography) Text(text,style=MaterialTheme.typography.bodyMedium) }
        data.textOrNull("warning")?.let { Hint(it) }
        val related=data.optJSONArray("benzer")?.objects().orEmpty()
        if(related.isNotEmpty()) {Text("Similar artists",fontWeight=FontWeight.Bold);ArtistStrip(related,vm)}
    }
}
@UnstableApi @Composable fun Discography(vm: MusicViewModel) {
    var filter by remember(vm.detailData?.optString("appId")) {mutableStateOf("all")}
    val albums=vm.detailAlbums.filter {filter=="all" || it.optString("tur")==filter}.sortedByDescending {it.optInt("yil")}
    Column {
        SectionTitle("Discography")
        LazyRow(contentPadding=PaddingValues(horizontal=16.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)) {items(listOf("all" to "All","album" to "Albums","single" to "Single / EP")) {(value,label) -> FilterChip(selected=filter==value,onClick={filter=value},label={Text(label)})} }
        if(albums.isNotEmpty()) AlbumStrip(albums,vm) else Hint("No releases in this category.")
        if(vm.detailData?.optString("kaynak")=="youtube" && vm.detailData?.optBoolean("diskografiTam")!=true) { TextButton(onClick=vm::expandDiscography,enabled=!vm.detailBusy,modifier=Modifier.padding(horizontal=16.dp)) {Text("Load more releases")}; Hint("Some regional or limited releases may be unavailable.") }
    }
}
