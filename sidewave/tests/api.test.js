import { test,after } from 'node:test'
import assert from 'node:assert/strict'
process.env.SKIP_LISTEN='1';process.env.DATABASE_PATH=':memory:'
process.env.NAVIDROME_URL='http://navidrome.test';process.env.YTRES_URL='http://ytres.test'
const local={id:'song-1',title:'Deneme',artist:'Sanatçı',duration:200,suffix:'flac'},remote={id:'abcdefghijk',baslik:'Başka Şarkı',sanatci:'Başka',sure:180,kaynak:'youtube'}
const original=globalThis.fetch
const artistCalls=[]
globalThis.fetch=async(url,opts)=>{
 const u=new URL(url)
 if(u.hostname==='navidrome.test')return Response.json({'subsonic-response':{status:'ok',searchResult3:{song:[local],album:[],artist:[]},song:local,randomSongs:{song:[local]}}})
 if(u.pathname==='/ara'&&u.searchParams.get('q')==='People Around') {
  const artists=[{id:'artist-a',ad:'People Around'},{id:'artist-b',ad:'People Around'}]
  if(u.searchParams.get('type')==='artists')return Response.json({sonuclar:artists})
  if(u.searchParams.get('type'))return Response.json({sonuclar:[]})
  return Response.json({sonuclar:[{id:'same-title',baslik:'People Around',sanatci:'Another Artist',sure:200}],sanatcilar:[artists[0]]})
 }
 if(u.pathname==='/ara'&&u.searchParams.get('q')==='Missing Catalog Artist')return Response.json({sonuclar:u.searchParams.get('type')==='artists'?[{id:'unavailable-artist',ad:'Missing Catalog Artist'}]:u.searchParams.has('type')?[]:[remote]})
 if(u.pathname==='/sanatci') {
  const id=u.searchParams.get('browseId');artistCalls.push(id)
  if(id==='unavailable-artist')return Response.json({code:'CATALOG_UNAVAILABLE',message:'Katalog açılamadı.',retryable:true},{status:502})
  return Response.json({ad:'People Around',parcalar:id==='artist-a'?[{id:'hiraeth',baslik:'Hiraeth',sanatci:'People Around',sanatciId:'artist-a',sure:210}]:[],albumler:id==='artist-a'?[{id:'bliss-single',ad:'Bliss',tur:'single'}]:[]})
 }
 if(u.pathname==='/ara')return Response.json({sonuclar:u.searchParams.has('type')?[]:[remote]})
 if(u.pathname==='/coz')return Response.json({url:'https://media.example.test/audio',mimeType:'audio/webm',format:'251',bitrate:128,expiresAt:Date.now()/1000+100})
 if(u.pathname==='/ilgili')return Response.json({parcalar:[remote]})
 throw new Error('Unexpected mock URL')
}
const {app,store}=await import('../server.js')
after(()=>{store.close();globalThis.fetch=original})
const request=(path,body,method='POST')=>app.request(path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})
test('mixed favorite and playlist CRUD works through public routes',async()=>{
 let r=await request('/api/favori',{parca:remote,favori:true});assert.equal(r.status,200)
 let fav=await(await app.request('/api/favoriler')).json();assert.equal(fav.parcalar[0].id,remote.id)
 const {id}=await(await request('/api/liste',{ad:'Test'})).json()
 r=await request('/api/liste/'+id+'/ekle',{parcalar:[remote,{id:'song-1',baslik:'Deneme',sanatci:'Sanatçı',sure:200,kaynak:'kutuphane'}]});assert.equal(r.status,200)
 const list=await r.json();assert.equal(list.parcalar.length,2)
 r=await request('/api/liste/'+id,{ad:'Renamed',entryIds:list.parcalar.map(p=>p.entryId).reverse()},'PATCH');assert.equal((await r.json()).ad,'Renamed')
 await request('/api/liste/'+id+'/cikar',{entryId:list.parcalar[0].entryId});assert.equal((await(await app.request('/api/liste/'+id)).json()).parcalar.length,1)
 await request('/api/liste/'+id,undefined,'DELETE');assert.equal((await app.request('/api/liste/'+id)).status,404)
})
test('resolve hides signed URL and returns request ID with honest media properties',async()=>{
 const r=await request('/api/v1/playback/resolve',{parca:remote});assert.equal(r.status,200);const d=await r.json()
 assert.match(d.url,/^\/api\/yt\/akis\//);assert.ok(d.requestId);assert.equal(d.bitrate,128);assert.equal(d.mimeType,'audio/webm');assert.ok(!JSON.stringify(d).includes('media.example'))
})
test('events validate type and history persists only real playback',async()=>{
 assert.equal((await request('/api/v1/events',{event:'garbage'})).status,400)
 await request('/api/v1/events',{id:'unique',event:'playing',parca:remote,source:'youtube',elapsedMs:200})
 const h=await(await app.request('/api/v1/history')).json();assert.equal(h.parcalar[0].id,remote.id)
})
test('combined search gives locally usable source metadata',async()=>{
 const d=await(await app.request('/api/ara?q=Deneme')).json();assert.equal(d.parcalar.length,2);assert.ok(d.parcalar.every(p=>p.appId&&p.kaynak));assert.ok(d.albumler&&d.sanatcilar);assert.deepEqual(d.hata,{})
})
test('exact artist search includes its songs, distinct namesake channels, and cached artist navigation',async()=>{
 const d=await(await app.request('/api/ara?q=People%20Around')).json()
 assert.equal(d.parcalar[0].baslik,'Hiraeth');assert.equal(d.parcalar[0].sanatciId,'artist-a');assert.equal(d.parcalar[0].kaynak,'youtube')
 assert.deepEqual(d.sanatcilar.map(a=>a.id),['artist-a','artist-b']);assert.deepEqual(d.hata,{})
 assert.equal(d.albumler[0].ad,'Bliss');assert.equal(d.albumler[0].sanatci,'People Around');assert.equal(d.albumler[0].tur,'single')
 assert.equal(artistCalls.filter(id=>id==='artist-a').length,1)
 const detail=await(await app.request('/api/yt/sanatci/artist-a')).json();assert.equal(detail.enCokDinlenen[0].baslik,'Hiraeth')
 assert.equal(artistCalls.filter(id=>id==='artist-a').length,1)
})
test('failed artist enrichment preserves normal song search with a partial error',async()=>{
 const r=await app.request('/api/ara?q=Missing%20Catalog%20Artist');assert.equal(r.status,200);const d=await r.json()
 assert.ok(d.parcalar.some(p=>p.id===remote.id));assert.ok(d.hata.sanatciParcalari)
})
test('import preview requires selection and commit never downloads',async()=>{
 const r=await request('/api/v1/import/preview',{text:'Başka - Başka Şarkı'});assert.equal(r.status,202);const initial=await r.json();let d;for(let i=0;i<20;i++){d=await(await app.request('/api/v1/import/preview/'+initial.jobId)).json();if(!d.pending)break;await new Promise(r=>setTimeout(r,5))};assert.equal(d.rows[0].status,'matched')
 const commit=await request('/api/v1/import/commit',{name:'Imported',parcalar:[d.rows[0].selected]});assert.equal(commit.status,201);assert.equal(store.jobs().length,0)
})
test('Spotify export routes preserve liked songs, expose paged review and reject unrelated uploads',async()=>{
 const upload=body=>app.request('/api/v1/import/spotify/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
 const invalid=await upload({history:[{track:'Not a like'}]});assert.equal(invalid.status,400);assert.equal((await invalid.json()).code,'INVALID_SPOTIFY_EXPORT')
 const initial=await upload({tracks:[{track:remote.baslik,artist:remote.sanatci,album:'Album'}]});assert.equal(initial.status,202);const job=await initial.json();let d
 for(let i=0;i<50;i++){d=await(await app.request('/api/v1/import/spotify/jobs/'+job.id)).json();if(d.state==='ready')break;await new Promise(r=>setTimeout(r,5))}
 const rows=await(await app.request(`/api/v1/import/spotify/jobs/${job.id}/rows`)).json();assert.equal(rows.items.length,1);assert.equal(rows.items[0].selected,null)
 const choice=await request(`/api/v1/import/spotify/jobs/${job.id}/rows/${rows.items[0].id}`,{candidate:`youtube:${remote.id}`},'PATCH');assert.equal(choice.status,200)
 const committed=await request(`/api/v1/import/spotify/jobs/${job.id}/commit`,{});assert.equal(committed.status,200);assert.equal((await committed.json()).state,'committed');assert.ok(store.favorites().some(p=>p.id===remote.id));assert.equal(store.jobs().length,0)
})
test('Exportify CSV HTTP upload keeps its filename and favorites classification is explicit',async()=>{
 const csv=`Track URI,Track Name,Artist Name(s),Album Name,Track Duration (ms)\nspotify:track:remote,${remote.baslik},${remote.sanatci},Album,180000\n`
 const response=await app.request('/api/v1/import/spotify/upload?fileName=liked_songs.csv&label=API-CSV',{method:'POST',headers:{'Content-Type':'text/csv'},body:csv});assert.equal(response.status,202)
 let job=await response.json();for(let i=0;i<50;i++){job=await(await app.request(`/api/v1/import/spotify/jobs/${job.id}`)).json();if(job.state==='ready')break;await new Promise(r=>setTimeout(r,5))}
 assert.equal(job.collections[0].name,'liked_songs');assert.equal(job.collections[0].kind,'playlist');assert.equal(job.hasLibrary,false)
 const selected=await request(`/api/v1/import/spotify/jobs/${job.id}/favorites-file`,{collectionId:job.collections[0].id},'PATCH');assert.equal(selected.status,200);job=await selected.json();assert.equal(job.hasLibrary,true);assert.equal(job.collections[0].kind,'favorites')
})
test('device presence does not claim playback; explicit handoff copies position',async()=>{
 store.setting('activeDeviceId',null)
 await request('/api/v1/devices/a',{name:'PC',queue:[remote],index:0,position:32,state:'playing'},'PUT')
 await request('/api/v1/devices/b',{name:'Phone',queue:[],index:0,position:0,state:'paused'},'PUT')
 assert.equal((await(await app.request('/api/v1/devices')).json()).activeDeviceId,null)
 await request('/api/v1/devices/a/takeover',{});const r=await request('/api/v1/devices/b/takeover',{});assert.equal((await r.json()).position,32)
})
test('invalid tracks return structured failures and API spec is exposed',async()=>{
 const r=await request('/api/v1/playback/resolve',{parca:{id:'bad'}});assert.equal(r.status,400);const d=await r.json();assert.equal(d.code,'INVALID_TRACK');assert.equal(typeof d.retryable,'boolean');assert.ok(d.requestId)
 assert.equal((await app.request('/api/openapi.json')).status,200)
})
test('staging blocks archive selection and legacy mutations before touching providers',async()=>{
 process.env.ARCHIVE_DISABLED='1'
 try {
  for(const path of ['/api/v1/archive/jobs/fake/select','/api/soulseek/indir']) {
   const r=await request(path,{candidateId:'fake'});assert.equal(r.status,403)
   const d=await r.json();assert.equal(d.code,'STAGING_READ_ONLY');assert.ok(d.requestId)
  }
 } finally {delete process.env.ARCHIVE_DISABLED}
})
test('artist follow and album save use canonical identity and paginated releases expose source completeness',async()=>{
 const artist=await(await app.request('/api/v1/catalog/artists/youtube/artist-a')).json()
 assert.ok(artist.appId);assert.equal(artist.takip,false)
 let r=await request(`/api/v1/artists/${artist.appId}/follow`,{takip:true},'PUT');assert.equal(r.status,200);assert.equal((await r.json()).takip,true)
 const namesake=await(await app.request('/api/v1/catalog/artists/youtube/artist-b')).json();assert.notEqual(namesake.appId,artist.appId);assert.equal(namesake.takip,false)
 const library=await(await app.request('/api/v1/library')).json();assert.equal(library.sanatcilar[0].appId,artist.appId)
 const feed=await(await app.request('/api/v1/library/releases')).json();assert.equal(feed.items[0].ad,'Bliss');assert.equal(feed.followedCount,1)
 const releases=await(await app.request(`/api/v1/artists/${artist.appId}/releases?type=single&limit=1`)).json()
 assert.equal(releases.items.length,1);assert.equal(releases.items[0].ad,'Bliss');assert.equal(releases.complete,false);assert.equal(releases.nextOffset,null)
 const albumId=releases.items[0].appId
 r=await request(`/api/v1/albums/${albumId}/save`,{kayitli:true},'PUT');assert.equal((await r.json()).kayitli,true)
 const favorites=await(await app.request('/api/favoriler')).json();assert.equal(favorites.albumler[0].appId,albumId)
 assert.equal((await request(`/api/v1/artists/${artist.appId}/follow`,{takip:'yes'},'PUT')).status,400)
 assert.equal((await app.request(`/api/v1/artists/${artist.appId}/releases?offset=-1`)).status,400)
 await request(`/api/v1/artists/${artist.appId}/follow`,{takip:false},'PUT')
 await request(`/api/v1/albums/${albumId}/save`,{kayitli:false},'PUT')
})
test('provider failure exposes a cached artist profile explicitly, and never fabricates an empty profile',async()=>{
 const prior=store.catalog.put('artist','youtube','unavailable-artist',{ad:'Cached Artist',enCokDinlenen:[],albumler:[]},true)
 store.db.prepare('UPDATE catalog_entities SET updated=0 WHERE id=?').run(prior.appId)
 const r=await app.request('/api/v1/catalog/artists/youtube/unavailable-artist'),data=await r.json()
 assert.equal(r.status,200);assert.equal(data.ad,'Cached Artist');assert.equal(data.stale,true);assert.ok(data.warning)
 assert.equal((await app.request('/api/v1/catalog/artists/bogus/id')).status,400)
 assert.equal((await app.request('/api/v1/artists/unknown')).status,404)
})

test('bulk playlist removal is atomic and targets occurrences rather than recording identity',async()=>{
 const {id}=await(await request('/api/liste',{ad:'Duplicate occurrences'})).json()
 const list=await(await request('/api/liste/'+id+'/ekle',{parcalar:[remote,remote,remote]})).json()
 const ids=list.parcalar.map(p=>p.entryId);assert.equal(new Set(ids).size,3)
 assert.equal((await request('/api/liste/'+id+'/cikar',{entryIds:[ids[0],'missing']})).status,404)
 assert.equal((await(await app.request('/api/liste/'+id)).json()).parcalar.length,3)
 assert.equal((await request('/api/liste/'+id+'/cikar',{entryIds:[ids[0],ids[2]]})).status,200)
 assert.deepEqual((await(await app.request('/api/liste/'+id)).json()).parcalar.map(p=>p.entryId),[ids[1]])
 await request('/api/liste/'+id,undefined,'DELETE')
})
