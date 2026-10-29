package com.sarginlabs.sidewave

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.media3.common.util.UnstableApi
import kotlinx.coroutines.launch
import org.json.JSONObject

/** Review uses persisted source rows, so selecting a match keeps list positions and repeats. */
@UnstableApi @Composable fun ImportReviewScreen(vm:MusicViewModel,onClose:()->Unit) {
    val scope=rememberCoroutineScope()
    var jobs by remember{mutableStateOf<List<JSONObject>>(emptyList())}
    var job by remember{mutableStateOf<JSONObject?>(null)}
    var rows by remember{mutableStateOf<List<JSONObject>>(emptyList())}
    var offset by remember{mutableIntStateOf(0)}
    var next by remember{mutableStateOf<Int?>(null)}
    var busy by remember{mutableStateOf(false)}
    var error by remember{mutableStateOf<String?>(null)}
    suspend fun refresh(){val id=job?.optString("id")?:return;val result=vm.repo.fetch("/api/v1/import/spotify/jobs/$id/rows?filter=review&offset=$offset");rows=result.optJSONArray("items")?.objects().orEmpty();next=if(result.isNull("nextOffset"))null else result.optInt("nextOffset")}
    fun action(work:suspend()->Unit){scope.launch{busy=true;try{work();refresh();error=null}catch(e:Exception){error=e.message}finally{busy=false}}}
    LaunchedEffect(Unit){try{jobs=vm.repo.fetch("/api/v1/import/spotify/jobs").optJSONArray("jobs")?.objects().orEmpty()}catch(e:Exception){error=e.message}}
    LaunchedEffect(job?.optString("id"),offset){try{refresh()}catch(e:Exception){error=e.message}}
    Dialog(onDismissRequest=onClose,properties=DialogProperties(usePlatformDefaultWidth=false)){
        Surface(Modifier.fillMaxSize(),color=MaterialTheme.colorScheme.background){Column(Modifier.safeDrawingPadding().padding(16.dp)){
            Text("Import matches",style=MaterialTheme.typography.headlineSmall)
            Text("Choose a match, then save your selections. Playlist order and likes are preserved.",Modifier.padding(vertical=12.dp),style=MaterialTheme.typography.bodySmall)
            error?.let{Text(it,color=MaterialTheme.colorScheme.error)}
            if(busy)LinearProgressIndicator(Modifier.fillMaxWidth())
            LazyColumn(Modifier.weight(1f)){
                if(job==null){
                    if(jobs.isEmpty())item{Text("No saved import yet. Upload your Spotify export on the web to get started.")}
                    items(jobs){j->TextButton(onClick={job=j;offset=0}){Text("${j.optString("label")} · ${j.optJSONObject("counts")?.optInt("unmatched")?:0} bulunamayan")}}
                }else{
                    if(rows.isEmpty()&&!busy)item{Text("No tracks to review on this page.")}
                    items(rows,key={it.getString("id")}){row->
                        var query by remember(row.getString("id")){mutableStateOf("${row.optString("sanatci")} ${row.optString("baslik")}")}
                        Card(Modifier.fillMaxWidth().padding(vertical=6.dp)){Column(Modifier.padding(16.dp)){
                            Text(row.optString("baslik"),style=MaterialTheme.typography.titleMedium);Text(row.optString("sanatci"))
                            OutlinedTextField(query,{query=it},Modifier.fillMaxWidth(),label={Text("Search for a match again")})
                            TextButton(enabled=!busy,onClick={action{vm.repo.fetch("/api/v1/import/spotify/jobs/${job!!.getString("id")}/rows/${row.getString("id")}/search","POST",JSONObject().put("query",query))}}){Text("Search again")}
                            row.optJSONArray("candidates")?.objects()?.forEach{p->
                                TextButton(enabled=!busy,onClick={action{vm.repo.fetch("/api/v1/import/spotify/jobs/${job!!.getString("id")}/rows/${row.getString("id")}","PATCH",JSONObject().put("candidate","${p.optString("kaynak")}:${p.optString("id")}"))}}){Text("${p.optString("sanatci")} — ${p.optString("baslik")} · ${p.optString("album")} · ${p.optInt("sure")} sn")}
                            }
                        }}
                    }
                }
            }
            if(job!=null){Row{TextButton(onClick={offset=(offset-50).coerceAtLeast(0)},enabled=offset>0&&!busy){Text("Previous")};TextButton(onClick={next?.let{offset=it}},enabled=next!=null&&!busy){Text("Next")};TextButton(onClick={action{vm.repo.fetch("/api/v1/import/spotify/jobs/${job!!.getString("id")}/commit","POST",JSONObject());vm.refresh()}} ,enabled=!busy){Text("Save selected")}}}
            TextButton(onClick=onClose){Text("Close")}
        }}
    }
}
