import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { Hono } from 'hono'
import { createStore } from '../src/store.js'
import { installApi } from '../src/api-v1.js'
import { readSpotifyHistory, createSpotifyHistory, externalSignals } from '../src/spotify-history.js'

function zip(files){
 const script='import io,json,sys,zipfile\nb=io.BytesIO()\nwith zipfile.ZipFile(b,"w") as z:\n for n,d in json.loads(sys.stdin.read()).items(): z.writestr(n,json.dumps(d))\nsys.stdout.buffer.write(b.getvalue())'
 return spawnSync('python3',['-I','-c',script],{input:JSON.stringify(files)}).stdout
}
const now=Date.now(),iso=ago=>new Date(now-ago).toISOString()

test('reads technical logs, account data and extended history; ignores unrelated logs',async()=>{
 const parsed=await readSpotifyHistory(zip({
  'Spotify Technical Log Information/RawCoreStream.json':[{timestamp_utc:iso(1000),message_media_type:'audio',message_content_uri:'spotify:track:AAA',message_ms_played:200000,message_reason_end:'trackdone'},{timestamp_utc:iso(2000),message_media_type:'audio',message_content_uri:'spotify:episode:X',message_ms_played:5}],
  'Spotify Technical Log Information/OnRepeatContents.json':[{message_contents:['spotify:track:AAA','spotify:track:BBB']}],
  'Spotify Technical Log Information/DaylistGenerated.json':[{message_title_terms:['Funky Hip Hop','trip hop'],message_description_terms:['trip hop']}],
  'Spotify Technical Log Information/AdRequestEvent.json':[{secret:'ignored'}],
  'Spotify Account Data/StreamingHistory_music_0.json':[{endTime:'2026-10-01 10:00',artistName:'Peter Green',trackName:'Just for You',msPlayed:250000}],
  'Spotify Extended Streaming History/Streaming_History_Audio_2026.json':[{ts:iso(3000),ms_played:9000,spotify_track_uri:'spotify:track:CCC',master_metadata_track_name:'Oh Yeah!',master_metadata_album_artist_name:'Propellerheads',reason_end:'fwdbtn',skipped:true},{ts:iso(4000),ms_played:1,episode_name:'podcast'}],
 }))
 assert.equal(parsed.plays.length,3)
 assert.deepEqual(parsed.onRepeat,['spotify:track:AAA','spotify:track:BBB'])
 assert.equal(parsed.terms['trip hop'],2)
 assert.deepEqual(parsed.kinds,['account','core','daylist','extended','onrepeat'])
 await assert.rejects(readSpotifyHistory(zip({'Other/AdRequestEvent.json':[]})),e=>e.code==='INVALID_SPOTIFY_HISTORY')
})

test('imports are deduplicated, named through the library import and feed signals without becoming likes',()=>{
 const store=createStore(':memory:'),history=createSpotifyHistory(store)
 store.db.exec("CREATE TABLE IF NOT EXISTS spotify_import_rows(id TEXT PRIMARY KEY,job_id TEXT,collection_id TEXT,position INTEGER,json TEXT)")
 store.db.prepare('INSERT INTO spotify_import_rows VALUES(?,?,?,?,?)').run('r1','j','c',0,JSON.stringify({baslik:'Ice Cool',sanatci:'ATA Records',spotifyUri:'spotify:track:AAA',selected:{id:'vid00000001',kaynak:'youtube',baslik:'Ice Cool',sanatci:'ATA Records',sure:200}}))
 const plays=[...Array(4)].map((_,i)=>({at:iso(i*86400000),ms:200000,uri:'spotify:track:AAA',title:'',artist:'',end:'trackdone',skipped:false}))
 const skips=['X1','X2','X3'].map((id,i)=>({at:iso(i*1000+500),ms:5000,uri:'',title:'Song '+id,artist:'Skippy',end:'fwdbtn',skipped:true}))
 const parsed={plays:[...plays,...skips,{at:iso(10),ms:100000,uri:'spotify:track:ZZZ',title:'',artist:'',end:'trackdone',skipped:false}],onRepeat:['spotify:track:AAA','spotify:track:ZZZ'],terms:{'funk':3},kinds:['core']}
 const first=history.apply(parsed)
 assert.equal(first.added,8);assert.equal(first.identified,7);assert.equal(first.unidentifiedTracks,1);assert.equal(first.needsNames,true);assert.equal(first.onRepeat,1)
 assert.equal(history.apply(parsed).added,0,'re-import adds nothing')
 assert.equal(store.favorites().length,0,'history never becomes likes')
 const signals=externalSignals(store,{now})
 assert.equal(signals.listening.get('ata records'),800000)
 assert.equal(signals.skippedArtists.get('skippy'),3)
 assert.equal(store.setting('spotifyTaste').funk,3)
 assert.equal(history.summary().topArtists[0].artist,'ATA Records')
 store.close()
})

test('imported listening shapes daily mixes and taste orders Sessions',async()=>{
 const store=createStore(':memory:'),app=new Hono();app.onError((e,c)=>c.json({code:e.code},e.status||500))
 const random=Array.from({length:30},(_,i)=>({id:'r'+i,kaynak:'kutuphane',baslik:'R '+i,sanatci:'Related '+(i%15),sure:200}))
 const service=installApi(app,{store,subsonic:async()=>({randomSongs:{song:random}}),mapSong:p=>p,ytres:async()=>{throw new Error('offline')},searchAll:async()=>({parcalar:[]}),archive:{}})
 try{
  createSpotifyHistory(store).apply({plays:[...Array(6)].map((_,i)=>({at:iso(i*3600000),ms:300000,uri:'',title:'Brown Bag',artist:'Boogaloo Joe Jones',end:'trackdone',skipped:false})),onRepeat:[],terms:{},kinds:['account']})
  const mixes=(await(await app.request('/api/v1/mixes')).json()).mixes
  assert.ok(mixes.length>=1,'an artist known only from Spotify still anchors a mix')
  const summary=await(await app.request('/api/v1/import/spotify/history')).json();assert.equal(summary.plays,6)
 }finally{service.stop();store.close()}
})
