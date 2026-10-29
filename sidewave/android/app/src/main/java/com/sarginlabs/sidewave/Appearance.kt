package com.sarginlabs.sidewave

import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.media3.common.util.UnstableApi
import coil.compose.AsyncImage
import com.sarginlabs.sidewave.api.Parca
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.util.UUID

data class AppearanceState(val wallpaperUrl: String? = null, val wallpaper: File? = null, val dim: Float = .35f, val transparency: Float = .7f, val preset:String? = null) {
    val enabled get() = wallpaper != null || preset in signatureBackgrounds
    val imageModel:Any? get() = wallpaper ?: preset?.let(::backgroundArtwork)
}
fun JSONObject.appearanceState(directory: File): AppearanceState {
    val url = textOrNull("wallpaperUrl")?.also { require(it.matches(Regex("/api/v1/appearance/wallpaper/[a-f0-9]{64}\\.jpg"))) }
    fun percent(key: String, fallback: Double, min: Double, max: Double) = optDouble(key, fallback).takeIf { it.isFinite() }?.coerceIn(min,max)?.div(100)?.toFloat() ?: (fallback/100).toFloat()
    return AppearanceState(url, url?.let { File(directory,it.substringAfterLast('/')).takeIf { f -> f.isFile && f.length()>0 } }, percent("dim",35.0,0.0,80.0), percent("transparency",70.0,20.0,90.0))
}
fun copyBoundedImage(input: InputStream, output: OutputStream, limit: Long) {
    val buffer=ByteArray(65536); var size=0L
    while(true) { val n=input.read(buffer); if(n<0)break; size+=n; require(size<=limit){"This image exceeds the size limit."}; output.write(buffer,0,n) }
}
fun recordingThumbnail(track: Parca): String? = track.kapakUrl?.takeIf { it.isNotBlank() } ?: track.kapak?.takeIf { it.isNotBlank() }
    ?: if(track.kaynak=="youtube" && track.id.matches(Regex("[A-Za-z0-9_-]{11}"))) "https://i.ytimg.com/vi/${track.id}/hqdefault.jpg" else null
fun recentAlbumTracks(history: List<Parca>) = history.filter { !it.albumId.isNullOrBlank() && !it.album.isNullOrBlank() }.distinctBy { "${it.kaynak}:${it.albumId}" }.take(8)

/** Appearance is private to this phone. The previous confirmed image is retained on upgrade. */
class AppearanceManager(private val repo: Repository) {
    private val directory=File(repo.context.filesDir,"appearance").apply {mkdirs()}
    private val key="appearance-device-v1"
    private val lock=Mutex()
    var state by mutableStateOf(runCatching {repo.cached(key)?.deviceAppearanceState(directory) ?: repo.cached("/api/v1/appearance")?.appearanceState(directory)?.copy(wallpaperUrl=null)}.getOrNull() ?: AppearanceState()); private set
    var busy by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    var editing=false
    private suspend fun persist(next:AppearanceState) {
        withContext(Dispatchers.IO) {repo.save(key,JSONObject().put("wallpaperName",next.wallpaper?.name).put("preset",next.preset).put("dim",(next.dim*100).toInt()).put("transparency",(next.transparency*100).toInt()))}
        state=next;error=null
    }
    fun preview(dim:Float,transparency:Float){editing=true;state=state.copy(dim=dim.coerceIn(0f,.8f),transparency=transparency.coerceIn(.2f,.9f))}
    private suspend fun operation(block:suspend()->Unit)=lock.withLock {
        busy=true;error=null
        try {block()}catch(e:CancellationException){throw e}catch(e:Exception){error=e.message ?: "Could not save your appearance settings."}finally{busy=false}
    }
    suspend fun saveSettings(){try{operation{persist(state)}}finally{editing=false}}
    suspend fun remove()=operation{persist(state.copy(wallpaperUrl=null,wallpaper=null,preset=null))}
    suspend fun choosePreset(id:String)=operation {require(id in signatureBackgrounds);persist(state.copy(wallpaperUrl=null,wallpaper=null,preset=id))}
    suspend fun choose(uri:Uri)=operation {
        val image=withContext(Dispatchers.IO) {
            val original=File(directory,".${UUID.randomUUID()}.input")
            val prepared=File(directory,".${UUID.randomUUID()}.jpg")
            try {
                checkNotNull(repo.context.contentResolver.openInputStream(uri)){"Could not open this image."}.use {input->original.outputStream().use{copyBoundedImage(input,it,25L*1024*1024)}}
                val bitmap=ImageDecoder.decodeBitmap(ImageDecoder.createSource(original)){decoder,info,_->
                    val scale=minOf(1f,1920f/maxOf(info.size.width,info.size.height))
                    decoder.setTargetSize(maxOf(1,(info.size.width*scale).toInt()),maxOf(1,(info.size.height*scale).toInt()));decoder.allocator=ImageDecoder.ALLOCATOR_SOFTWARE
                }
                try {prepared.outputStream().use{check(bitmap.compress(Bitmap.CompressFormat.JPEG,85,it)){"Could not prepare this image."}}}finally{bitmap.recycle()}
                val destination=File(directory,fileSha256(prepared)+".jpg")
                check(prepared.renameTo(destination)){"Could not save this image."};destination
            }finally{original.delete();prepared.delete()}
        }
        persist(state.copy(wallpaperUrl=null,wallpaper=image,preset=null))
    }
}
fun JSONObject.deviceAppearanceState(directory:File):AppearanceState {
    val name=textOrNull("wallpaperName")?.also{require(it.matches(Regex("[a-f0-9]{64}\\.jpg")))}
    val compatible=JSONObject(toString());compatible.remove("wallpaperUrl")
    if(name!=null)compatible.put("wallpaperUrl","/api/v1/appearance/wallpaper/$name")
    val preset=textOrNull("preset")?.also{require(it in signatureBackgrounds)}
    return compatible.appearanceState(directory).copy(wallpaperUrl=null,preset=preset)
}

val LocalSharedWallpaper=staticCompositionLocalOf {false}
fun appearanceColors(base: ColorScheme, state: AppearanceState): ColorScheme {
    if(!state.enabled)return base
    val alpha=1-state.transparency
    return base.copy(background=Color.Transparent,surface=base.surface.copy(alpha=alpha),surfaceVariant=base.surfaceVariant.copy(alpha=alpha),
        primaryContainer=base.primaryContainer.copy(alpha=alpha),secondaryContainer=base.secondaryContainer.copy(alpha=alpha),
        surfaceContainer=base.surfaceContainer.copy(alpha=alpha),surfaceContainerLow=base.surfaceContainerLow.copy(alpha=alpha),
        surfaceContainerHigh=base.surfaceContainerHigh.copy(alpha=alpha),surfaceContainerHighest=base.surfaceContainerHighest.copy(alpha=alpha),surfaceContainerLowest=base.surfaceContainerLowest.copy(alpha=alpha))
}
@Composable fun SharedWallpaper(state: AppearanceState, content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize().background(Color(0xFF101413))) {
        if(state.enabled) {
            AsyncImage(model=state.imageModel,contentDescription=null,modifier=Modifier.fillMaxSize(),contentScale=ContentScale.Crop)
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha=state.dim)))
        }
        CompositionLocalProvider(LocalSharedWallpaper provides state.enabled) {content()}
    }
}
@Composable fun GlassButton(onClick: ()->Unit, modifier: Modifier=Modifier, enabled: Boolean=true, content: @Composable RowScope.()->Unit) {
    Button(onClick=onClick,modifier=modifier,enabled=enabled,
        colors=ButtonDefaults.buttonColors(),content=content)
}

@UnstableApi @Composable fun AppearanceDialog(vm: MusicViewModel, onClose: ()->Unit) {
    val manager=vm.appearance; val state=manager.state; val scope=rememberCoroutineScope()
    DisposableEffect(manager){onDispose{manager.editing=false}}
    val picker=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()){uri->if(uri!=null)scope.launch{manager.choose(uri)}}
    AlertDialog(onDismissRequest=onClose,containerColor=Color(0xF018201C),title={Text("Appearance")},text={Column(Modifier.verticalScroll(rememberScrollState())) {
        Text("Make this space yours.",style=MaterialTheme.typography.bodyMedium)
        Text("Signature backgrounds",style=MaterialTheme.typography.labelLarge,modifier=Modifier.padding(top=18.dp,bottom=10.dp))
        signatureBackgrounds.entries.chunked(2).forEach {row->Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(10.dp)) {
            row.forEach {(id,title)->Surface(modifier=Modifier.weight(1f).padding(bottom=10.dp).clickable(enabled=!manager.busy){scope.launch{manager.choosePreset(id)}},shape=androidx.compose.foundation.shape.RoundedCornerShape(12.dp),border=BorderStroke(2.dp,if(state.preset==id)MaterialTheme.colorScheme.primary else Color.Transparent)) {
                Box(Modifier.height(105.dp)){AsyncImage(model=backgroundArtwork(id),contentDescription=title,modifier=Modifier.fillMaxSize(),contentScale=ContentScale.Crop);Box(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Brush.verticalGradient(listOf(Color.Transparent,Color.Black.copy(alpha=.8f)))));Text(title,color=Color.White,style=MaterialTheme.typography.labelSmall,modifier=Modifier.align(androidx.compose.ui.Alignment.BottomStart).padding(9.dp))}
            }}
        }}
        if(state.enabled)AsyncImage(model=state.imageModel,contentDescription="Background preview",modifier=Modifier.fillMaxWidth().height(100.dp).padding(vertical=8.dp),contentScale=ContentScale.Crop)
        GlassButton(onClick={picker.launch(arrayOf("image/*"))},enabled=!manager.busy,modifier=Modifier.padding(top=12.dp)){Text(if(state.enabled)"Change photo" else "Choose a photo")}
        if(state.enabled)TextButton(onClick={scope.launch{manager.remove()}},enabled=!manager.busy){Text("Remove background")}
        Text("Photos up to 25 MB.",style=MaterialTheme.typography.labelSmall)
        Spacer(Modifier.height(20.dp));Text("Background dimming · ${(state.dim*100).toInt()}%")
        Slider(value=state.dim,onValueChange={manager.preview(it,state.transparency)},onValueChangeFinished={scope.launch{manager.saveSettings()}},valueRange=0f..0.8f,enabled=state.enabled&&!manager.busy)
        Text("Panel transparency · ${(state.transparency*100).toInt()}%")
        Slider(value=state.transparency,onValueChange={manager.preview(state.dim,it)},onValueChangeFinished={scope.launch{manager.saveSettings()}},valueRange=.2f.. .9f,enabled=state.enabled&&!manager.busy)
        if(manager.busy)LinearProgressIndicator(Modifier.fillMaxWidth())
        manager.error?.let {Text(it,color=MaterialTheme.colorScheme.error,modifier=Modifier.padding(top=8.dp))}
        Text("Your background stays available offline.",style=MaterialTheme.typography.labelSmall,modifier=Modifier.padding(top=8.dp))
    }},confirmButton={TextButton(onClick=onClose){Text("Close")}})
}
