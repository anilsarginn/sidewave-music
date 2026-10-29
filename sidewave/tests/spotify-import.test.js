import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createStore } from '../src/store.js'
import { readSpotifyExport,parseSpotifyDocuments,chooseSpotifyMatch,createSpotifyImports } from '../src/spotify-import.js'

const raw=(name='Şarkı',artist='Sanatçı')=>({trackName:name,artistName:artist,albumName:'Albüm',trackUri:'spotify:track:'+name})
const track=(name='Şarkı',extra={})=>({id:name,baslik:name,sanatci:'Sanatçı',album:'Albüm',sure:200,kaynak:'youtube',...extra})
const document=(items=[{track:raw()}],tracks=[{track:'Şarkı',artist:'Sanatçı',album:'Albüm',uri:'spotify:track:Şarkı'}])=>[{name:'Playlist1.json',data:{playlists:[{name:'Akşam',items}]}},{name:'YourLibrary.json',data:{tracks,albums:[{album:'Sadece albüm'}]}}]
const wait=async predicate=>{for(let i=0;i<300;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5))}throw Error('Timed out')}
function zip(files){const r=spawnSync('python3',['-c',`import sys,io,json,zipfile
b=io.BytesIO()
with zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED) as z:
 for name,value in json.load(sys.stdin).items(): z.writestr(name,value if isinstance(value,str) else json.dumps(value))
sys.stdout.buffer.write(b.getvalue())`],{input:JSON.stringify(files),maxBuffer:20*1024*1024});assert.equal(r.status,0);return r.stdout}

test('Spotify export ZIP reads playlist shards and library only, never listening history as likes',async()=>{
  const docs=document(),parsed=await readSpotifyExport(zip({'Spotify Account Data/Playlist1.json':docs[0].data,'Spotify Account Data/YourLibrary.json':docs[1].data,'Userdata.json':{private:'DO_NOT_STORE'},'StreamingHistory0.json':[{trackName:'Dinlenen'}]}))
  assert.equal(parsed.collections.length,2);assert.equal(parsed.total,2);assert.equal(parsed.hasLibrary,true);assert.ok(!JSON.stringify(parsed).includes('DO_NOT_STORE'));assert.ok(!JSON.stringify(parsed).includes('Dinlenen'))
})
test('parser preserves duplicate playlist entries and namesake playlists; deduplicates likes only',()=>{
  const docs=document([{track:raw()},{track:raw()},{episode:{episodeName:'Podcast'}},{localTrack:{trackName:'Yerel',artistName:'Sanatçı'}}])
  docs[0].data.playlists.push({...docs[0].data.playlists[0]});docs[1].data.tracks.push({...docs[1].data.tracks[0]})
  const p=parseSpotifyDocuments(docs);assert.equal(p.collections.length,3);assert.notEqual(p.collections[0].key,p.collections[1].key);assert.equal(p.collections[2].rows.length,1)
  assert.notEqual(p.collections[0].rows[0].sourceKey,p.collections[0].rows[1].sourceKey);assert.equal(p.collections[0].rows[2].status,'unsupported');assert.equal(p.collections[0].rows[3].status,'unsupported');assert.equal(p.warnings.length,1)
})
test('missing library is reported and history-only, malformed JSON, invalid ZIP and expansion bombs fail explicitly',async()=>{
  assert.equal(parseSpotifyDocuments([document()[0]]).warnings.length,1)
  for(const data of [Buffer.from('{bad'),Buffer.from('PKbroken'),zip({'StreamingHistory0.json':[]}),zip({'Playlist1.json':{playlists:[{name:'Broken'}]}})])await assert.rejects(readSpotifyExport(data),e=>e.code==='INVALID_SPOTIFY_EXPORT')
  const bomb=zip({'YourLibrary.json':{tracks:[],irrelevant:'x'.repeat(17*1024*1024)}})
  await assert.rejects(readSpotifyExport(bomb),e=>e.code==='INVALID_SPOTIFY_EXPORT')
})
test('matching requires recording evidence and never silently picks cover, remix, unknown album, or multiple versions',()=>{
  const row={baslik:'Şarkı',sanatci:'Sanatçı',album:'Albüm',sure:null}
  assert.equal(chooseSpotifyMatch(row,[track()]).id,'Şarkı')
  assert.equal(chooseSpotifyMatch(row,[track('Şarkı (Live)')]),null)
  assert.equal(chooseSpotifyMatch(row,[track('Şarkı',{sanatci:'Cover Artist'})]),null)
  assert.equal(chooseSpotifyMatch(row,[track('Şarkı',{album:'Başka'})]),null)
  assert.equal(chooseSpotifyMatch(row,[track(),track('Şarkı',{id:'other'})]),null)
  assert.equal(chooseSpotifyMatch({...row,sure:200},[track('Şarkı',{sure:210})]),null)
  assert.equal(chooseSpotifyMatch({...row,sure:200},[track('Şarkı',{album:'',sure:201})]).id,'Şarkı')
})
test('Exportify ZIP and single CSV preserve quoted metadata, duration and duplicates; unrelated CSV is ignored',async()=>{
  const csv='\uFEFF"Track URI","Track Name","Artist Name(s)","Album Name","Track Duration (ms)"\r\n"spotify:track:one","A, B","Sanatçı","Albüm","200000"\r\n"spotify:track:one","A, B","Sanatçı","Albüm","200000"\r\n'
  const parsed=await readSpotifyExport(zip({'Exportify/night_drive.csv':csv,'unrelated.csv':'name,address\nPRIVATE,DO_NOT_SAVE\n'}))
  const row=parsed.collections[0].rows[0];assert.equal(row.baslik,'A, B');assert.equal(row.sure,200);assert.equal(parsed.collections[0].rows.length,2);assert.equal(parsed.collections[0].name,'night_drive');assert.equal(parsed.hasLibrary,false);assert.equal(parsed.collections[0].kind,'playlist');assert.ok(!JSON.stringify(parsed).includes('DO_NOT_SAVE'))
  const single=await readSpotifyExport(Buffer.from(csv),{fileName:'liked_songs.csv'});assert.equal(single.collections[0].name,'liked_songs');assert.equal(single.collections[0].kind,'playlist')
  await assert.rejects(readSpotifyExport(Buffer.from('Name,Private\nNo,Yes'),{fileName:'other.csv'}),e=>e.code==='INVALID_SPOTIFY_EXPORT')
})
test('CSV favorite selection is explicit, scoped to this job, reversible before commit, and immutable after commit',async()=>{
  const csv='Track URI,Track Name,Artist Name(s),Album Name,Track Duration (ms)\nspotify:track:one,Şarkı,Sanatçı,Albüm,200000\n'
  const parsed=await readSpotifyExport(zip({'my_playlist.csv':csv,'liked_songs.csv':csv+csv.split('\n')[1]+'\n'}))
  const store=createStore(':memory:'),imports=createSpotifyImports(store,async()=>({parcalar:[track()]})),initial=imports.start(parsed)
  assert.throws(()=>imports.favoritesFile(initial.id,initial.collections[1].id),e=>e.code==='IMPORT_BUSY')
  await wait(()=>imports.status(initial.id).state==='ready');let job=imports.status(initial.id)
  assert.equal(job.hasLibrary,false);assert.ok(job.collections.every(c=>c.canBeFavorites));assert.throws(()=>imports.favoritesFile(job.id,'other-job-file'),e=>e.code==='INVALID_SELECTION')
  job=imports.favoritesFile(job.id,job.collections[1].id);assert.equal(job.hasLibrary,true);assert.equal(job.collections[1].kind,'favorites');assert.equal(job.collections[0].kind,'playlist')
  job=imports.favoritesFile(job.id,null);assert.equal(job.hasLibrary,false);job=imports.favoritesFile(job.id,job.collections[1].id)
  const committed=imports.commit(job.id);assert.equal(committed.lastCommit.favorites,1);assert.equal(committed.lastCommit.added,1);assert.equal(store.lists().length,1);assert.equal(store.favorites().length,1)
  assert.throws(()=>imports.favoritesFile(job.id,null),e=>e.code==='IMPORT_ALREADY_APPLIED');assert.equal(imports.commit(job.id).lastCommit.favorites,0);store.close()
})
test('Turkish Exportify headers preserve track identity, title, artist, album and millisecond duration',async()=>{
 const csv='Parça URI,Parça Adı,Sanatçı Adı,Albüm Adı,Parça Süresi (ms),Ekleyen\nspotify:track:tr,Şarkı,Sanatçı,Albüm,201500,PRIVATE_USER\n'
 const parsed=await readSpotifyExport(Buffer.from(csv),{fileName:'turkish.csv'}),row=parsed.collections[0].rows[0]
 assert.equal(row.spotifyUri,'spotify:track:tr');assert.equal(row.baslik,'Şarkı');assert.equal(row.sanatci,'Sanatçı');assert.equal(row.album,'Albüm');assert.equal(row.sure,201.5);assert.ok(!JSON.stringify(parsed).includes('PRIVATE_USER'))
})
test('recording matching reconciles featured credits and formatting while retaining performance and remaster year identity',()=>{
 const row={baslik:'Song Of I',sanatci:'Steven Wilson, Sophie Hunger',album:'To The Bone',sure:321.9}
 assert.equal(chooseSpotifyMatch(row,[track('Song Of I (feat. Sophie Hunger)',{sanatci:'Steven Wilson',album:'To The Bone',sure:322})])?.id,'Song Of I (feat. Sophie Hunger)')
 assert.equal(chooseSpotifyMatch(row,[track('Song Of I',{sanatci:'Steven Wilson',album:'To The Bone',sure:322})]),null)
 assert.equal(chooseSpotifyMatch(row,[track('Song Of I (Live) (feat. Sophie Hunger)',{sanatci:'Steven Wilson',album:'To The Bone',sure:322})]),null)
 assert.ok(chooseSpotifyMatch({baslik:'C.O.T.E.',sanatci:'Karnivool',album:'Themata',sure:350.36},[track('Cote',{sanatci:'Karnivool',album:'Themata',sure:351})]))
 assert.ok(chooseSpotifyMatch({baslik:'İstermisin',sanatci:'mavisakal',album:'Yeni...den',sure:537.35},[track('İstermisin',{sanatci:'Mavi Sakal',album:'Yeni...den',sure:538})]))
 const original={baslik:'Never Too Much - Original Mix',sanatci:'Bondye, Lee Jo',album:'Planetary Passion EP',sure:351.2}
 assert.ok(chooseSpotifyMatch(original,[track('Never Too Much',{sanatci:original.sanatci,album:original.album,sure:352})]))
 assert.equal(chooseSpotifyMatch(original,[track('Never Too Much',{sanatci:original.sanatci,album:'Other release',sure:352})]),null)
 const remaster={baslik:'Song - 2004 Remaster',sanatci:'Artist',album:'Album',sure:200}
 assert.ok(chooseSpotifyMatch(remaster,[track('Song (Remastered 2004)',{sanatci:'Artist',sure:200})]))
 for(const title of ['Song','Song (2005 Remaster)','Song (Live)','Song (Remix)','Song (Cover)'])assert.equal(chooseSpotifyMatch(remaster,[track(title,{sanatci:'Artist',sure:200})]),null)
})
test('two verified sources for one canonical recording do not create false ambiguity and prefer the local copy',()=>{
 const row={baslik:'Şarkı',sanatci:'Sanatçı',album:'Albüm',sure:200},remote=track('Şarkı',{appId:'recording-a'}),local=track('Şarkı',{appId:'recording-a',id:'local-track',kaynak:'kutuphane'})
 assert.equal(chooseSpotifyMatch(row,[local,remote]).kaynak,'kutuphane')
 assert.equal(chooseSpotifyMatch(row,[local,{...remote,appId:'different-recording'}]),null)
})
test('bulk import exceeds 500 rows, commits order and duplicates, favorites and empty playlists idempotently',async()=>{
  const store=createStore(':memory:');let calls=0
  const imports=createSpotifyImports(store,async q=>{calls++;return {parcalar:[track(q.replace('Sanatçı ',''))]}})
  const docs=document(Array.from({length:601},(_,i)=>({track:raw('Parça '+(i%600))})),[{track:'Parça 0',artist:'Sanatçı',album:'Albüm'}])
  docs[0].data.playlists.push({name:'Boş liste',items:[]})
  const parsed=parseSpotifyDocuments(docs),job=imports.start(parsed);await wait(()=>imports.status(job.id).state==='ready')
  assert.equal(imports.status(job.id).counts.selected,602);assert.equal(calls,601);assert.equal(imports.rows(job.id).items.length,50);assert.equal(imports.rows(job.id,{offset:600}).items.length,2)
  assert.throws(()=>imports.rows(job.id,{offset:-1}),e=>e.code==='INVALID_PAGE')
  const committed=imports.commit(job.id);assert.equal(committed.lastCommit.added,601);assert.equal(committed.lastCommit.favorites,1)
  const list=store.list(committed.lastCommit.playlists[0].id);assert.equal(list.parcalar.length,601);assert.equal(list.parcalar[0].id,'Parça 0');assert.equal(list.parcalar[600].id,'Parça 0');assert.notEqual(list.parcalar[0].entryId,list.parcalar[600].entryId)
  assert.equal(store.list(committed.lastCommit.playlists[1].id).parcalar.length,0);assert.equal(store.favorites().length,1);assert.equal(store.jobs().length,0)
  const again=imports.commit(job.id);assert.equal(again.lastCommit.added,0);assert.equal(again.lastCommit.favorites,0);assert.equal(imports.start(parsed).id,job.id);store.close()
})
test('manual choices are server validated; late reviewed match is inserted in source order without changing local additions',async()=>{
  const store=createStore(':memory:'),imports=createSpotifyImports(store,async q=>({parcalar:q.includes('İlk')?[track('İlk',{id:'a',album:'Başka'})]:[track('Son')]}))
  const job=imports.start(parseSpotifyDocuments(document([{track:raw('İlk')},{track:raw('Son')}],[])))
  await wait(()=>imports.status(job.id).state==='ready');const rows=imports.rows(job.id).items
  assert.equal(rows[0].status,'ambiguous');assert.equal(rows[0].selected,null)
  assert.throws(()=>imports.select(job.id,rows[0].id,'youtube:forged'),e=>e.code==='INVALID_SELECTION')
  const first=imports.commit(job.id),id=first.lastCommit.playlists[0].id;store.add(id,[track('Yerel ekleme')])
  imports.select(job.id,rows[0].id,'youtube:a');const again=imports.commit(job.id)
  assert.equal(imports.rows(job.id).items[0].applied,true);assert.throws(()=>imports.select(job.id,rows[0].id,null),e=>e.code==='IMPORT_ALREADY_APPLIED');assert.equal(again.lastCommit.added,1);assert.deepEqual(store.list(id).parcalar.map(p=>p.baslik),['İlk','Son','Yerel ekleme']);store.close()
})
test('pause, restart recovery, failed-source retry, and durable selections survive database reopen',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'sidewave-spotify-')),path=join(directory,'sidewave.sqlite');let store=createStore(path)
  let started=false;const first=createSpotifyImports(store,async(q,{signal})=>{started=true;await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('abort')),{once:true}));return {parcalar:[]}})
  const job=first.start(parseSpotifyDocuments(document()));await wait(()=>started);first.pause(job.id);await new Promise(r=>setTimeout(r,10));store.close()
  store=createStore(path);let fail=true;const second=createSpotifyImports(store,async()=>{if(fail)throw Error('No provider');return {parcalar:[track()]}})
  assert.equal(second.status(job.id).state,'paused');second.resume(job.id);await wait(()=>second.status(job.id).state==='ready');assert.equal(second.status(job.id).counts.errors,2)
  fail=false;second.resume(job.id,true);await wait(()=>second.status(job.id).state==='ready');assert.equal(second.status(job.id).counts.selected,2)
  second.commit(job.id);store.close();store=createStore(path);const third=createSpotifyImports(store,async()=>{throw Error('Must not re-search')});third.recover();assert.equal(third.status(job.id).state,'committed');assert.equal(store.favorites().length,1);assert.equal(third.commit(job.id).lastCommit.added,0);store.close();rmSync(directory,{recursive:true,force:true})
})
