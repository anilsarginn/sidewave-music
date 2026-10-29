package com.sarginlabs.sidewave

import android.content.Intent
import android.os.SystemClock
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.media3.common.util.UnstableApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

internal val acceptanceChecks = listOf(
    "local" to "Play saved and cached recordings, seek, then reopen them and check for stalling.",
    "switch" to "Liked songs: skip quickly, toggle shuffle and repeat, then remove the playing song from the queue.",
    "lock" to "Listen for two hours with the screen locked. Record start and end times.",
    "headset" to "Unplug headphones and disconnect Bluetooth. Playback should pause.",
    "call" to "Check audio focus and resume behavior during a phone call.",
    "offline" to "Play downloads in airplane mode, seek, skip, then reopen the app.",
    "auto" to "Android Auto: while parked, browse likes and playlists, play a download offline, and check voice search and steering-wheel controls.",
    "handoff" to "Use Play on this device to transfer playback. The previous online device should pause.",
    "gapless" to "Play adjacent tracks from a gapless album and note any gaps.",
    "week" to "During seven days of use, note unexpected exits, silent failures and delays."
)

@UnstableApi @Composable fun AcceptanceScreen(vm: MusicViewModel, onClose: () -> Unit) {
    val context=LocalContext.current
    val version=vm.updates.currentVersionName
    val scope=rememberCoroutineScope()
    val key="acceptance:$version"
    var answers by remember { mutableStateOf(JSONObject(vm.repo.prefs.getString(key,"{}") ?: "{}")) }
    var notes by remember { mutableStateOf(answers.optString("notes")) }
    var preview by remember { mutableStateOf<String?>(null) }
    var building by remember { mutableStateOf(false) }
    fun save(id:String,value:String) { answers=JSONObject(answers.toString()).put(id,value).put("updatedAt",System.currentTimeMillis());vm.repo.prefs.edit().putString(key,answers.toString()).apply() }
    Dialog(onDismissRequest=onClose,properties=DialogProperties(usePlatformDefaultWidth=false)) {
        Surface(Modifier.fillMaxSize(),color=MaterialTheme.colorScheme.background) {
            Column(Modifier.safeDrawingPadding().verticalScroll(rememberScrollState()).padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
                Text("Diagnostics",style=MaterialTheme.typography.headlineMedium)
                Text("Version $version · Record your observations below. Unchecked steps remain unverified.")
                acceptanceChecks.forEach { (id,title) ->
                    Card(Modifier.fillMaxWidth()) {Column(Modifier.padding(16.dp)) {
                        Text(title,style=MaterialTheme.typography.titleSmall)
                        Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                            listOf("pending" to "Pending","pass" to "Passed","fail" to "Needs attention").forEach { (value,label) -> FilterChip(selected=answers.optString(id,"pending")==value,onClick={save(id,value)},label={Text(label)}) }
                        }
                    }}
                }
                OutlinedTextField(notes,{notes=it;save("notes",it)},Modifier.fillMaxWidth(),label={Text("Observations and test times")},minLines=3)
                Button(onClick={building=true;scope.launch {preview=withContext(Dispatchers.IO) {
                    buildString {
                        appendLine("Sidewave $version — device acceptance report")
                        appendLine("Created: ${java.time.Instant.now()}")
                        acceptanceChecks.forEach { (id,title) -> appendLine("${answers.optString(id,"pending")}: $title") }
                        appendLine("Notes: $notes")
                        appendLine("\nLocal diagnostics:\n${context.app.diagnostics.report()}")
                        appendLine("This report is not shared automatically. Physical device behavior requires manual verification.")
                    }
                };building=false}},enabled=!building){Text(if(building) "Getting ready…" else "Preview report")}
                TextButton(onClick=onClose){Text("Close")}
            }
        }
    }
    preview?.let { report -> AlertDialog(onDismissRequest={preview=null},title={Text("Report to share")},text={Column(Modifier.verticalScroll(rememberScrollState())){Text("Review your notes and diagnostics, then choose an app to share them.");Text(report,style=MaterialTheme.typography.bodySmall)}},confirmButton={TextButton(onClick={context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT,report),"Share diagnostic report"))}){Text("Share")}},dismissButton={TextButton(onClick={preview=null}){Text("Back")}}) }
}

@Composable fun SleepTimerControls() {
    val until by PlaybackSignals.sleepUntil.collectAsState()
    val atEnd by PlaybackSignals.sleepAtEnd.collectAsState()
    Text("Sleep timer",style=MaterialTheme.typography.titleSmall)
    Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){listOf(15,30,60).forEach {minutes->TextButton(onClick={PlaybackSignals.sleepAtEnd.value=false;PlaybackSignals.sleepUntil.value=SystemClock.elapsedRealtime()+minutes*60000L}){Text("$minutes min")}}}
    Row {TextButton(onClick={PlaybackSignals.sleepUntil.value=0;PlaybackSignals.sleepAtEnd.value=true}){Text("End of track")};if(until>0||atEnd)TextButton(onClick={PlaybackSignals.sleepUntil.value=0;PlaybackSignals.sleepAtEnd.value=false}){Text("Cancel")}}
    if(until>0||atEnd)Text(if(atEnd) "Stops at the end of this track" else "Timer is on",style=MaterialTheme.typography.bodySmall)
}

@UnstableApi @Composable fun TrackDetailsScreen(vm:MusicViewModel,track:com.sarginlabs.sidewave.api.Parca,onClose:()->Unit) {
    var data by remember {mutableStateOf<JSONObject?>(null)}
    var error by remember {mutableStateOf<String?>(null)}
    LaunchedEffect(track.appId){if(track.appId!=null)try{data=vm.repo.read("/api/v1/tracks/${track.appId}")}catch(e:Exception){data=vm.repo.cached("/api/v1/tracks/${track.appId}");error="Could not connect. Showing saved details when available."}else error="More information is not available yet."}
    AlertDialog(onDismissRequest=onClose,title={Text(track.baslik)},text={Column(Modifier.verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(12.dp)){
        Text(track.sanatci);Text(track.album ?: "No album information")
        error?.let{Text(it)}
        data?.let{d->Text(listOfNotNull(d.textOrNull("format"),d.optDouble("bitrate").takeIf{it.isFinite()&&it>0}?.let{"${it.toInt()} kbps"}).joinToString(" · ").ifBlank{"Audio format is checked during playback."});Text("Recording: ${d.optString("version",track.baslik)}");Text("Lyrics",style=MaterialTheme.typography.titleSmall);Text(d.textOrNull("lyrics") ?: "Lyrics are not available for this recording.")}
    }},confirmButton={TextButton(onClick=onClose){Text("Close")}})
}
