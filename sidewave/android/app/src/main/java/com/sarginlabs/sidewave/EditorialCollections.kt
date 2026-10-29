package com.sarginlabs.sidewave

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.layout.ContentScale
import coil.compose.AsyncImage
import androidx.media3.common.util.UnstableApi
import com.sarginlabs.sidewave.api.Parca
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Editorial ownership never grants the personal playlist's rename/remove controls. */
data class EditorialSelection(val id:String,val title:String,val genre:String?,val color:String?,val description:String?,val owner:String,val count:Int?,val tracks:List<Parca>,val refreshAt:Long?,val personalized:Boolean?,val stale:Boolean,val partial:Boolean,val message:String?)
fun JSONObject.editorialSelection():EditorialSelection {
    require(has("editable") && !optBoolean("editable",true)) {"Session ownership could not be verified."}
    val id=getString("id");val title=getString("ad");val owner=getString("owner")
    require(id.matches(Regex("[a-z0-9-]{1,80}")) && title.isNotBlank() && owner.isNotBlank()) {"Invalid session information."}
    return EditorialSelection(id,title,textOrNull("tur"),textOrNull("renk"),textOrNull("aciklama"),owner,
        if(has("parcaSayisi")&&!isNull("parcaSayisi"))optInt("parcaSayisi").takeIf{it>=0} else if(has("parcalar"))tracks().size else null,
        tracks(),if(has("refreshAt"))optLong("refreshAt").takeIf{it>0} else null,
        if(has("personalized"))optBoolean("personalized") else null,optBoolean("stale"),optBoolean("partial"),textOrNull("message"))
}
fun editorialRefreshLabel(timestamp:Long):String = DateTimeFormatter.ofPattern("d MMMM",Locale.UK).withZone(ZoneId.of("Europe/Istanbul")).format(Instant.ofEpochMilli(timestamp))

@Composable private fun EditorialCover(item:EditorialSelection,modifier:Modifier=Modifier) {
    val color=remember(item.color){runCatching{Color(android.graphics.Color.parseColor(item.color ?: "#3f8a6d"))}.getOrDefault(Color(0xFF3F8A6D))}
    Box(modifier.clip(RoundedCornerShape(14.dp)).background(Brush.linearGradient(listOf(color,color.copy(alpha=.28f))))) {
      sessionArtwork(item.id)?.let {AsyncImage(model=it,contentDescription=null,modifier=Modifier.fillMaxSize(),contentScale=ContentScale.Crop)}
      Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Black.copy(alpha=.15f),Color.Transparent,Color.Black.copy(alpha=.75f)))).padding(14.dp)) {
        if(sessionArtwork(item.id)==null)Icon(MusicIcons.QueueMusic,null,Modifier.align(Alignment.TopEnd).padding(top=22.dp).size(46.dp),tint=Color.White.copy(alpha=.4f))
        Text(if(item.id=="weekly")"SIDEWAVE" else "SIDEWAVE SESSIONS",fontSize=8.sp,fontWeight=FontWeight.Bold,letterSpacing=1.sp,color=Color.White.copy(alpha=.8f))
        Column(Modifier.align(Alignment.BottomStart),verticalArrangement=Arrangement.spacedBy(7.dp)) {Text(item.title,fontSize=23.sp,fontWeight=FontWeight.Bold,lineHeight=25.sp,color=Color.White,maxLines=3,overflow=TextOverflow.Ellipsis);Text(item.genre ?: "DISCOVER WEEKLY",fontSize=9.sp,color=Color.White.copy(alpha=.75f))}
      }
    }
}

@UnstableApi @Composable
fun EditorialStrip(vm:MusicViewModel) {
    LazyRow(contentPadding=PaddingValues(horizontal=16.dp,vertical=16.dp),horizontalArrangement=Arrangement.spacedBy(12.dp)) {
        items(vm.editorialCollections,key={it.id}) {item->Column(Modifier.width(156.dp).clip(RoundedCornerShape(14.dp)).clickable{vm.openEditorial(item.id,item.title)}) {
            EditorialCover(item,Modifier.size(156.dp))
            Text(item.title,Modifier.padding(top=10.dp),fontWeight=FontWeight.SemiBold,maxLines=1,overflow=TextOverflow.Ellipsis)
            Text("${item.count ?: 0} tracks · ${item.genre.orEmpty()}",Modifier.padding(top=5.dp),fontSize=10.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }}
    }
}

@UnstableApi @Composable
fun EditorialBrowseScreen(vm:MusicViewModel) {
    var genre by rememberSaveable {mutableStateOf("All")}
    Column(Modifier.fillMaxSize()) {
        Text("SIDEWAVE SESSIONS",Modifier.padding(start=16.dp,top=18.dp),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.primary)
        Text("Find a sound. Follow a feeling. Fresh tracks every Monday.",Modifier.padding(horizontal=16.dp,vertical=10.dp),style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
        if(vm.detailBusy)LinearProgressIndicator(Modifier.fillMaxWidth())
        vm.detailError?.let {Hint(it);TextButton(onClick=vm::reloadDetail,modifier=Modifier.padding(horizontal=8.dp)){Text("Try again")}}
        LazyRow(contentPadding=PaddingValues(horizontal=16.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)){items(listOf("All")+vm.editorialCollections.mapNotNull{it.genre}.distinct()){g->FilterChip(selected=genre==g,onClick={genre=g},label={Text(g)})}}
        if(!vm.detailBusy && vm.detailError==null && vm.editorialCollections.isEmpty())Hint("Sessions are unavailable right now.")
        BoxWithConstraints(Modifier.weight(1f)) {
            val columns=if(maxWidth>=1000.dp)4 else if(maxWidth>=600.dp)3 else 2
            LazyVerticalGrid(columns=GridCells.Fixed(columns),contentPadding=PaddingValues(16.dp),verticalArrangement=Arrangement.spacedBy(20.dp),horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                items(vm.editorialCollections.filter{genre=="All"||it.genre==genre},key={it.id}) {item->Column(Modifier.clip(RoundedCornerShape(14.dp)).clickable{vm.openEditorial(item.id,item.title)}){
                    EditorialCover(item,Modifier.fillMaxWidth().aspectRatio(1f))
                    Text(item.title,Modifier.padding(top=10.dp),fontWeight=FontWeight.SemiBold,maxLines=1,overflow=TextOverflow.Ellipsis)
                    item.description?.let {Text(it,Modifier.padding(top=5.dp),fontSize=11.sp,lineHeight=17.sp,color=MaterialTheme.colorScheme.onSurfaceVariant,maxLines=2,overflow=TextOverflow.Ellipsis)}
                    Text(listOfNotNull(item.genre,item.count?.let{"$it tracks"}).joinToString(" · "),Modifier.padding(top=6.dp),fontSize=10.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
                }}
                item(span={androidx.compose.foundation.lazy.grid.GridItemSpan(columns)}){Text("SIDEWAVE · SARGIN LABS",fontSize=9.sp,letterSpacing=1.sp,color=MaterialTheme.colorScheme.onSurfaceVariant,modifier=Modifier.padding(vertical=18.dp))}
            }
        }
    }
}

@UnstableApi @Composable
fun EditorialDetailHeader(vm:MusicViewModel) {
    val data=vm.detailData ?: return
    val item=remember(data){runCatching{data.editorialSelection()}.getOrNull()} ?: return
    Column(Modifier.fillMaxWidth().padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
        EditorialCover(item,Modifier.size(180.dp))
        Text(item.title,style=MaterialTheme.typography.headlineMedium,fontWeight=FontWeight.Bold)
        Text("${item.owner} · ${vm.detailTracks.size} tracks",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        if(vm.detailKind=="weekly") {
            item.refreshAt?.let{Text("Next mix: ${editorialRefreshLabel(it)}",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.primary)}
            Text(if(item.personalized==true)"Inspired by your likes and recent listening." else "Keep listening and liking to make your next mix yours.",style=MaterialTheme.typography.bodySmall)
        } else item.description?.let {Text(it,style=MaterialTheme.typography.bodyMedium)}
        if(item.stale)Text(item.message ?: "Showing your last available mix.",style=MaterialTheme.typography.bodySmall)
        else if(item.partial && vm.detailKind!="weekly")Text("Showing the recordings currently available.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedButton(onClick={vm.play(vm.detailTracks.shuffled())},enabled=vm.detailTracks.isNotEmpty()){Icon(Icons.Default.PlayArrow,null);Spacer(Modifier.width(8.dp));Text("Shuffle")}
    }
}
