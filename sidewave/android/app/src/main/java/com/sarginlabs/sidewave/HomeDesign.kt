package com.sarginlabs.sidewave

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.media3.common.util.UnstableApi
import com.sarginlabs.sidewave.api.Parca
import java.text.Normalizer

internal fun outsidePersonalPlaylists(candidates:List<Parca>,owned:List<Parca>):List<Parca> {
    fun name(t:Parca)=Normalizer.normalize(t.sanatci+"\n"+t.baslik,Normalizer.Form.NFKD).replace(Regex("\\p{M}"),"").lowercase(java.util.Locale.ROOT).replace(Regex("[^\\p{L}\\p{N}]"),"")
    val keys=owned.map{it.key()}.toSet();val ids=owned.mapNotNull{it.appId}.toSet();val names=owned.map(::name).toSet()
    return candidates.filter{it.key() !in keys && (it.appId==null||it.appId !in ids) && name(it) !in names}
}

@UnstableApi @Composable
fun HomeIntroduction(vm:MusicViewModel) {
    val intro=vm.homeIntro;val quote=intro?.optJSONObject("quote");val context=LocalContext.current
    var visible by remember {mutableStateOf(false)}
    LaunchedEffect(Unit){visible=true}
    AnimatedVisibility(visible,enter=fadeIn(tween(360))+slideInVertically(tween(360)){it/10}) {
      Column(Modifier.fillMaxWidth().padding(16.dp).background(Brush.linearGradient(listOf(Color(0xFF183127).copy(alpha=.8f),Color(0xFF141B17).copy(alpha=.45f))),RoundedCornerShape(22.dp)).padding(24.dp)) {
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
            Text(if(quote!=null)"BEYOND THE SOUND" else intro?.optString("greeting")?.uppercase(java.util.Locale.UK) ?: "YOUR NEXT FAVORITE AWAITS",Modifier.weight(1f),fontSize=9.sp,letterSpacing=1.6.sp,fontWeight=FontWeight.SemiBold,color=Color(0xFF9BC5AB))
            IconButton(onClick={vm.refresh();vm.claimHomeIntro()},modifier=Modifier.size(36.dp)){Icon(Icons.Default.Refresh,"Refresh home",Modifier.size(18.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant)}
        }
        if(quote!=null) {
            Text("“${quote.optString("text")}”",fontSize=24.sp,lineHeight=32.sp,letterSpacing=(-.6).sp,fontWeight=FontWeight.Medium,modifier=Modifier.padding(top=12.dp))
            Text(quote.optString("author"),fontSize=12.sp,fontWeight=FontWeight.SemiBold,modifier=Modifier.padding(top=20.dp))
            val source=quote.optString("source")
            Text(quote.optString("work")+" ↗",fontSize=10.sp,color=MaterialTheme.colorScheme.onSurfaceVariant,modifier=Modifier.padding(top=8.dp).clickable {if(source.startsWith("https://"))runCatching{context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(source)))}})
        } else Text(if(intro!=null)"Welcome back, ${vm.repo.prefs.getString("member-name","music lover")}" else "Find your rhythm.",fontSize=30.sp,lineHeight=36.sp,letterSpacing=(-1).sp,fontWeight=FontWeight.Bold,modifier=Modifier.padding(top=10.dp))
      }
    }
}

@UnstableApi @Composable
fun InlineLyrics(vm:MusicViewModel,track:Parca) {
    var data by remember(track.appId){mutableStateOf<org.json.JSONObject?>(null)}
    var busy by remember(track.appId){mutableStateOf(true)}
    LaunchedEffect(track.appId){
        track.appId?.let{id->data=runCatching{vm.repo.read("/api/v1/tracks/$id/lyrics")}.getOrElse{vm.repo.cached("/api/v1/tracks/$id/lyrics")}}
        busy=false
    }
    // Synced lyrics show a window around the current line and follow the song; a tap seeks there.
    val lines=remember(data){data?.optJSONArray("synced")?.let{a->(0 until a.length()).mapNotNull{i->a.optJSONObject(i)?.let{(it.optDouble("t",0.0)*1000).toLong() to it.optString("text")}}}.orEmpty()}
    val current=lines.indexOfLast{it.first<=vm.position+250}
    Column(Modifier.fillMaxWidth().padding(vertical=14.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
        Text(track.sanatci,fontWeight=FontWeight.SemiBold)
        track.album?.let{Text(it,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
        Text("LYRICS",fontSize=10.sp,letterSpacing=1.sp,color=MaterialTheme.colorScheme.primary)
        when {
            busy -> Text("Loading lyrics…",style=MaterialTheme.typography.bodyMedium)
            lines.isNotEmpty() -> {
                val from=(current-2).coerceAtLeast(0)
                lines.subList(from,(from+7).coerceAtMost(lines.size)).forEachIndexed{offset,(time,text)->
                    val index=from+offset
                    Text(text.ifBlank{"♪"},Modifier.fillMaxWidth().clickable{vm.seek(time)}.padding(vertical=2.dp),fontSize=20.sp,lineHeight=26.sp,fontWeight=FontWeight.Bold,
                        color=if(index==current)MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurface.copy(alpha=if(index<current)0.5f else 0.32f))
                }
                if(data?.optString("source")=="lrclib")Text("Lyrics from LRCLIB",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
            data?.optBoolean("instrumental")==true -> Text("This track is instrumental.",style=MaterialTheme.typography.bodyMedium)
            else -> Text(data?.textOrNull("plain") ?: "Lyrics are not available for this recording.",style=MaterialTheme.typography.bodyMedium)
        }
    }
}
