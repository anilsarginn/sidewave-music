import { installCatalogApi } from './catalog.js'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { ApiError, count, observe, metrics, log, startAttempt } from './telemetry.js'
import { normalize, sameRecording, validTrack } from './store.js'
import { createImportJobs } from './import-jobs.js'
import { installSpotifyImports } from './spotify-import.js'
import { gainFor } from './loudness.js'
import { computeStats } from './stats.js'
import { readSpotifyHistory, createSpotifyHistory, externalSignals } from './spotify-history.js'
import { rankRecommendations, outsidePlaylists, skipSignals, artistListening } from './recommendations.js'
import { rediscoverHistory } from './rediscover.js'

export function installApi(app,{store,subsonic,mapSong,ytres,searchAll,archive,artistCatalog,audioCache,loudness,lyrics,sonic,verifyLocal=async()=>true}){
  const catalog=installCatalogApi(app,{store,subsonic,ytres,mapSong,artistCatalog})
  const imports=createImportJobs(store,searchAll)
  const spotify=installSpotifyImports(app,{store,search:searchAll})
  if(process.env.SKIP_LISTEN!=='1')imports.resume()
  async function legacyTrack(id){const existing=store.db.prepare('SELECT track_id FROM sources WHERE source_id=? ORDER BY source LIMIT 1').get(id);if(existing)return store.getTrack(existing.track_id);const r=await subsonic('getSong.view',{id});return mapSong(r.song)}
  app.get('/api/openapi.json',c=>c.json(JSON.parse(readFileSync(new URL('../openapi.json',import.meta.url),'utf8'))))
  app.get('/metrics',c=>c.text(metrics()+(audioCache?Object.entries(audioCache.stats()).filter(([,v])=>typeof v==='number').map(([k,v])=>`sidewave_audio_cache_${k} ${v}\n`).join(''):''),200,{'Content-Type':'text/plain; version=0.0.4'}))
  app.get('/api/v1/favorites',c=>c.json({parcalar:store.favorites(),albumler:store.catalog.library().albumler}))
  app.get('/api/v1/playlists',c=>c.json({listeler:store.lists(),begeniSayisi:store.favoritesCount()}))
  app.get('/api/favoriler',c=>c.json({parcalar:store.favorites(),albumler:store.catalog.library().albumler}))
  app.post('/api/favori',async c=>{const b=await c.req.json();return c.json({ok:true,parca:store.favorite(b.parca||await legacyTrack(b.id),!!b.favori),favori:!!b.favori})})
  app.get('/api/listeler',c=>c.json({listeler:store.lists(),begeniSayisi:store.favoritesCount()}))
  app.post('/api/liste',async c=>c.json({id:store.createList((await c.req.json()).ad)},201))
  app.get('/api/liste/:id',c=>{const p=store.list(c.req.param('id'));if(!p)throw new ApiError('NOT_FOUND',"Playlist not found.",404);return c.json(p)})
  app.patch('/api/liste/:id',async c=>c.json(store.updateList(c.req.param('id'),await c.req.json())))
  app.delete('/api/liste/:id',c=>{store.deleteList(c.req.param('id'));return c.json({ok:true})})
  app.post('/api/liste/:id/ekle',async c=>{const b=await c.req.json();const p=b.parcalar||[b.parca||await legacyTrack(b.parcaId)];if(!Array.isArray(p)||p.length>1000)throw new ApiError('INVALID_TRACKS',"Add up to 1,000 tracks at a time.",400);return c.json(store.add(c.req.param('id'),p))})
  app.post('/api/liste/:id/cikar',async c=>{const b=await c.req.json(),id=c.req.param('id');const list=store.list(id);const entries=b.entryIds||[b.entryId||list?.parcalar[b.indeks]?.entryId];if(!Array.isArray(entries)||!entries.length||entries.length>5000||entries.some(e=>typeof e!=='string'||!list?.parcalar.some(p=>p.entryId===e)))throw new ApiError('NOT_FOUND',"Playlist entry not found.",404);store.db.transaction(()=>{for(const entry of new Set(entries))store.remove(id,entry)})();return c.json({ok:true})})
  app.get('/api/v1/catalog/search',async c=>c.json(await searchAll(c.req.query('q')||'',{signal:c.req.raw.signal})))
  async function selectSource(raw,signal){
    let p=store.resolveTrack(validTrack(raw))
    const local=store.db.prepare("SELECT json FROM sources WHERE track_id=? AND source='kutuphane'").all(p.appId)
    for(const candidate of local){const t=JSON.parse(candidate.json)
      try{const r=await subsonic('getSong.view',{id:t.id},signal);if(r.song&&sameRecording(t,mapSong(r.song))&&await verifyLocal(r.song,signal))return {...p,...t,appId:p.appId}}
      catch{/* A missing archive must not hide an exact online source. */}}
    if(p.kaynak==='kutuphane'&&local.length){const online=store.db.prepare("SELECT json FROM sources WHERE track_id=? AND source='youtube' LIMIT 1").get(p.appId);if(online)p={...p,...JSON.parse(online.json),appId:p.appId};else throw new ApiError('SOURCE_UNAVAILABLE',"This recording is unavailable. Check your connection and try again.",503,true)}
    return p
  }
  app.post('/api/v1/playback/resolve',async c=>{
    const began=Date.now(),b=await c.req.json(),requestId=c.get('requestId');startAttempt(requestId)
    const signal=AbortSignal.any([c.req.raw.signal,AbortSignal.timeout(14000)])
    const p=await selectSource(b.parca,signal),hit=p.kaynak==='youtube'&&await audioCache?.cached(p).catch(()=>null)
    if(hit)audioCache.lease(p,requestId,hit.duration)
    let detail={};if(p.kaynak==='youtube'&&!hit)detail=await ytres('/coz?id='+encodeURIComponent(p.id),{headers:{'x-request-id':requestId},signal})
    const url=p.kaynak==='kutuphane'?'/api/stream/'+encodeURIComponent(p.id):'/api/yt/akis/'+encodeURIComponent(p.id)
    const delivery=p.kaynak==='kutuphane'?'archive':hit?'temporary_cache':'online'
    let preparation
    if(p.kaynak==='youtube'&&audioCache)preparation=await audioCache.prepare(p,'playback').catch(()=>undefined)
    observe('sidewave_resolve_seconds',delivery,Date.now()-began);log('resolved',{requestId,source:delivery,elapsedMs:Date.now()-began,trackId:p.appId})
    // Known loudness travels with the source; otherwise it is measured in the background.
    const lufs=loudness?.known(p);if(lufs===undefined)void loudness?.ensure(p)
    return c.json({...(Number.isFinite(lufs)?{lufs,gain:gainFor(lufs)}:{}),url:url+'?requestId='+requestId+'&delivery='+delivery+(hit?.digest?'&cacheVersion='+hit.digest:''),fallbackUrl:p.kaynak==='kutuphane'?url+'?format=mp3&requestId='+requestId:undefined,requestId,kaynak:p.kaynak,delivery,readiness:delivery==='online'?'source_ready':'complete',preparation,mimeType:hit?.mime||detail.mimeType,expiresAt:detail.expiresAt,format:hit?.format||detail.format,bitrate:detail.bitrate,parca:p})
  })
  app.get('/api/v1/playback/loudness',async c=>{
    const p={kaynak:c.req.query('kaynak'),id:c.req.query('id')}
    if(!['youtube','kutuphane'].includes(p.kaynak)||!/^[\w-]{1,100}$/.test(p.id||''))throw new ApiError('INVALID_TRACK',"Invalid track.",400)
    const lufs=loudness?await Promise.race([loudness.ensure(p),new Promise(r=>setTimeout(()=>r(undefined),5000))]):null
    return c.json(Number.isFinite(lufs)?{lufs,gain:gainFor(lufs)}:{lufs:null,gain:1,pending:lufs===undefined})
  })
  app.post('/api/v1/playback/prepare',async c=>{
    const b=await c.req.json(),p=await selectSource(b.parca,AbortSignal.any([c.req.raw.signal,AbortSignal.timeout(14000)]))
    void loudness?.ensure(p)
    if(p.kaynak==='kutuphane')return c.json({id:null,state:'ready',delivery:'archive'})
    if(!audioCache)return c.json({id:null,state:'disabled'})
    return c.json(await audioCache.prepare(p,b.priority==='playback'?'playback':'next'),202)
  })
  app.get('/api/v1/playback/preparations/:id',c=>c.json(audioCache.status(c.req.param('id'))))
  app.delete('/api/v1/playback/preparations/:id',c=>c.json(audioCache.cancel(c.req.param('id'))))
  app.get('/api/v1/cache',c=>c.json(audioCache.stats()))
  app.patch('/api/v1/cache',async c=>c.json(await audioCache.configure(await c.req.json())))
  app.delete('/api/v1/cache/unused',async c=>c.json(await audioCache.clear()))
  const intents=new Map()
  app.post('/api/v1/playback/prefetch',async c=>{
    const b=await c.req.json(),p=(b.parcalar||[]).find(p=>p.kaynak==='youtube')
    // Pointer/focus intent: resolve the source URL only (no audio download), once per track per
    // ten minutes and at most one new track per second, so browsing never floods the provider.
    if(b.mode==='intent'){
      if(!p||typeof p.id!=='string'||!/^[\w-]{6,20}$/.test(p.id))return c.json({ok:false})
      const now=Date.now(),key=(store.accountId||'')+':'+p.id
      if(now-(intents.get(key)||0)<600000||now-(intents.get('last:'+store.accountId)||0)<1000)return c.json({ok:true,skipped:true})
      intents.set(key,now);intents.set('last:'+store.accountId,now);if(intents.size>2000)intents.delete(intents.keys().next().value)
      void loudness?.ensure(p)
      if(store.resolveTrack(validTrack(p)).kaynak==='kutuphane')return c.json({ok:true,archive:true})
      await ytres('/onisit',{method:'POST',body:JSON.stringify([p.id]),headers:{'Content-Type':'application/json'}}).catch(()=>null)
      return c.json({ok:true})
    }
    if(p&&audioCache){const track=store.resolveTrack(validTrack(p));return c.json({ok:true,preparation:track.kaynak==='kutuphane'?{id:null,state:'ready',delivery:'archive'}:await audioCache.prepare(track,'next')})}
    if(p)await ytres('/onisit',{method:'POST',body:JSON.stringify([p.id]),headers:{'Content-Type':'application/json'}})
    return c.json({ok:true})
  })
  app.post('/api/v1/events',async c=>{
    const b=await c.req.json();if(!['playing','started','paused','ended','error','buffering','skip','resume','progress','summary','cancelled','source_ready','first_bytes'].includes(b.event))throw new ApiError('INVALID_EVENT',"Invalid playback event.",400)
    b.id=b.id||b.eventId
    b.deviceId=String(b.deviceId||'web').slice(0,100);b.requestId=String(b.requestId||c.get('requestId')).slice(0,100)
    if(['ended','summary','error','cancelled'].includes(b.event))audioCache?.release(b.requestId)
    const duplicate=b.id&&store.db.prepare('SELECT 1 FROM events WHERE id=?').get(b.id)
    const id=store.event(b);if(duplicate)return c.json({id},201)
    count('sidewave_playback_events_total',b.source,b.event)
    // Early-skip rate = heard-then-skipped / tracks that produced sound (see skipSignals).
    if(b.event==='progress')count('sidewave_tracks_heard_total',b.source,'heard')
    if(b.event==='skip'&&Number(b.position)>=1&&Number(b.position)<30&&['next','user',undefined].includes(b.reason))count('sidewave_early_skips_total',b.source,'early')
    if(b.event==='progress'&&Number.isFinite(b.elapsedMs))observe('sidewave_player_progress_seconds',b.delivery||b.source,b.elapsedMs)
    if(b.event==='summary'&&Number.isFinite(b.rebufferMs))observe('sidewave_rebuffer_seconds',b.source,b.rebufferMs)
    if(b.event==='error')store.setting('playbackLastFailure',Date.now())
    const occurred=Number(b.occurredAt)||Date.now(),recent=Date.now()-occurred<30000&&occurred<=Date.now()+5000
    if(recent&&['playing','paused','ended','skip'].includes(b.event)&&Array.isArray(b.queue)&&occurred>(store.setting('deviceEvent:'+b.deviceId)||0)){
      const prior=store.devices().find(d=>d.id===b.deviceId)
      if(!prior?.handoffCommandId)store.device(b.deviceId,{...prior,queue:b.queue,index:b.index,position:b.position,state:b.event==='playing'?'playing':'paused'},{selfReport:true})
      store.setting('deviceEvent:'+b.deviceId,occurred)
    }
    if(recent&&b.event==='playing'&&!store.setting('activeDeviceId'))store.setting('activeDeviceId',b.deviceId)
    if(b.event==='playing'&&Number.isFinite(b.elapsedMs))observe('sidewave_start_seconds',b.source,b.elapsedMs)
    log('playback',{requestId:b.requestId,source:b.source,state:b.event,elapsedMs:b.elapsedMs})
    return c.json({id},201)
  })
  app.get('/api/v1/history',c=>c.json({parcalar:store.history()}))
  app.get('/api/v1/devices',c=>c.json({devices:store.devices(),activeDeviceId:store.setting('activeDeviceId'),takeoverAt:store.setting('takeoverAt')}))
  app.put('/api/v1/devices/:id',async c=>{const id=c.req.param('id');if(!/^[\w-]{1,100}$/.test(id))throw new ApiError('INVALID_DEVICE',"Invalid device ID.",400);return c.json({...store.device(id,await c.req.json()),activeDeviceId:store.setting('activeDeviceId')})})
  app.post('/api/v1/devices/:id/takeover',async c=>c.json(store.takeover(c.req.param('id'),(await c.req.json()).commandId)))
  app.post('/api/v1/recommendations/dismiss',async c=>{const b=await c.req.json();const t=store.dismiss(validTrack(b.parca),b.scope==='artist'?'artist':'track');return c.json({ok:true,scope:b.scope==='artist'?'artist':'track',artist:t.sanatci||null})})
  app.delete('/api/v1/recommendations/dismiss',async c=>{const b=await c.req.json();store.undismiss(validTrack(b.parca),b.scope==='artist'?'artist':'track');return c.json({ok:true})})
  app.get('/api/v1/recommendations/dismissed-artists',c=>c.json({artists:store.dismissedArtists()}))
  const recommendationCache=new Map()
  async function recommend(seed,{omitPlaylists=true}={}){
    const recent=store.history(20),key=(store.accountId||store.db.name)+':'+(seed?.appId||seed?.id||'default');let candidates=[]
    const cached=recommendationCache.get(key)
    if(cached&&cached.expires>Date.now())candidates=cached.items
    else{
      const [local,online,audio]=await Promise.allSettled([
        subsonic('getRandomSongs.view',{size:100}),
        (async()=>{let videoId=seed?.kaynak==='youtube'?seed.id:null
          if(seed&&!videoId){const r=await ytres('/ara?q='+encodeURIComponent([seed.sanatci,seed.baslik].filter(Boolean).join(' '))+'&limit=5');const exact=(r.sonuclar||[]).find(p=>sameRecording(seed,p));videoId=exact?.id}
          if(!videoId)return[];const r=await ytres('/ilgili?id='+encodeURIComponent(videoId));return(r.parcalar||[]).map(p=>({...p,kaynak:'youtube',related:true}))})(),
        seed?.kaynak==='kutuphane'&&sonic?sonic().similar(seed,{count:24,signal:AbortSignal.timeout(6000)}):Promise.resolve(null),
      ])
      candidates=[...(audio.status==='fulfilled'?(audio.value?.matches||[]).map(m=>({...m.parca,sonicScore:m.similarity,sonicVerified:true})):[]),...(online.status==='fulfilled'?online.value:[]),...(local.status==='fulfilled'?(local.value.randomSongs?.song||[]).map(mapSong):[])]
      if(!candidates.length&&local.status==='rejected'&&(!seed||online.status==='rejected'))throw new ApiError('RECOMMENDATIONS_UNAVAILABLE',"Recommendations are unavailable right now.",502,true)
      if(recommendationCache.size>100)recommendationCache.delete(recommendationCache.keys().next().value)
      recommendationCache.set(key,{items:candidates,expires:Date.now()+300000})
    }
    const skips=skipSignals(store),external=externalSignals(store)
    for(const [a,n] of external.skippedArtists)skips.artists.set(a,Math.max(skips.artists.get(a)||0,n))
    const listening=artistListening(store);for(const [a,ms] of external.listening)listening.set(a,(listening.get(a)||0)+ms)
    const listened=new Map(store.db.prepare("SELECT track_id,json FROM events WHERE event='summary' AND created>?").all(Date.now()-30*86400000).map(r=>[r.track_id,Number(JSON.parse(r.json).playedMs)||0]))
    const eligible=omitPlaylists?outsidePlaylists(store):()=>true
    return rankRecommendations({listened,candidates:candidates.map(p=>({...store.upsert(p),related:p.related,sonicScore:p.sonicScore,sonicVerified:p.sonicVerified})).filter(eligible),favorites:store.favorites(),recent,skipped:skips.tracks,skippedArtists:skips.artists,artistListening:listening,dismissed:store.isDismissed,seed})
  }
  // "Recommended songs" under a playlist: seeded by a few of its tracks (rotating with offset),
  // never repeating a recording that is already in the list.
  app.get('/api/v1/playlists/:id/recommendations',async c=>{
    const list=store.list(c.req.param('id'));if(!list)throw new ApiError('NOT_FOUND',"Playlist not found.",404)
    if(!list.parcalar.length)return c.json({parcalar:[]})
    const key=p=>normalize(p.baslik)+'|'+normalize(p.sanatci),inList=new Set(list.parcalar.map(p=>p.appId)),keys=new Set(list.parcalar.map(key))
    const offset=Math.max(0,Math.floor(Number(c.req.query('offset'))||0)),pool=list.parcalar.slice(-30)
    const seeds=[...new Set([0,1,2].map(i=>pool[(offset*3+i*7)%pool.length]))]
    const results=await Promise.allSettled(seeds.map(seed=>recommend(seed,{omitPlaylists:false})))
    if(results.every(r=>r.status==='rejected'))throw new ApiError('RECOMMENDATIONS_UNAVAILABLE',"Recommendations are unavailable right now.",502,true)
    const out=[],seen=new Set()
    for(let i=0;i<24&&out.length<10;i++)for(const r of results){const p=r.status==='fulfilled'?r.value[i]:null;if(!p||inList.has(p.appId)||keys.has(key(p))||seen.has(key(p)))continue;seen.add(key(p));out.push(p)}
    return c.json({parcalar:out.slice(0,10)})
  })
  // Daily mixes: one per artist you keep returning to, mixing your own tracks with related ones.
  // Built once a day (Istanbul time) per account and kept stable through the day.
  async function dailyMixes(){
    const day=new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Istanbul'})
    const saved=store.setting('dailyMixes');if(saved?.day===day&&Array.isArray(saved.mixes))return saved
    const history=store.history(200),favorites=store.favorites(),score=new Map(),byArtist=new Map()
    const add=(p,w)=>{const a=normalize(p.sanatci);if(!a||store.isDismissed(p.appId))return;score.set(a,(score.get(a)||0)+w);if(!byArtist.has(a))byArtist.set(a,[]);const own=byArtist.get(a);if(!own.some(x=>x.appId===p.appId))own.push(p)}
    for(const [a,ms] of artistListening(store))score.set(a,(score.get(a)||0)+ms/60000)
    history.forEach((p,i)=>add(p,Math.max(0.2,2-i/100)));favorites.forEach(p=>add(p,3))
    // Imported Spotify listening: matched recordings become seeds; name-only plays seed by search.
    for(const [a,ms] of externalSignals(store).listening)score.set(a,(score.get(a)||0)+ms/120000)
    try{for(const r of store.db.prepare("SELECT artist_key a,artist,title,track_id,SUM(ms) total FROM external_plays WHERE artist_key IS NOT NULL GROUP BY artist_key,COALESCE(track_id,title) ORDER BY total DESC LIMIT 400").all()){
      const t=r.track_id?store.getTrack(r.track_id):null
      if(t)add(t,0);else if(!byArtist.has(r.a)&&r.title)byArtist.set(r.a,[{baslik:r.title,sanatci:r.artist,seedOnly:true}])
    }}catch{/* No imported history. */}
    const top=[...score].filter(([a])=>byArtist.has(a)).sort((x,y)=>y[1]-x[1]).slice(0,6).map(([a])=>a)
    const colors=['#e8115b','#1e3264','#8d67ab','#148a08','#e13300','#0d73ec'],mixes=[]
    for(const artist of top){
      const own=byArtist.get(artist).slice(0,3),seed=own[0];own.splice(0,own.length,...own.filter(p=>!p.seedOnly))
      let related=[];try{related=await recommend(seed,{omitPlaylists:false})}catch{/* A mix can still form from other artists. */}
      const tracks=[],seen=new Set();for(const p of [...own,...related]){const k=normalize(p.baslik)+'|'+normalize(p.sanatci);if(seen.has(k))continue;seen.add(k);tracks.push(p)}
      // Interleave: the anchor artist's songs spread through the mix instead of opening it in a block.
      const mixed=[];const ownSet=new Set(own.map(p=>p.appId));const rest=tracks.filter(p=>!ownSet.has(p.appId));own.forEach((p,i)=>{mixed.push(p);mixed.push(...rest.splice(0,i===own.length-1?rest.length:4))});if(!own.length)mixed.push(...rest)
      if(mixed.length<8)continue
      const names=[...new Set(mixed.map(p=>p.sanatci).filter(Boolean))]
      mixes.push({id:'mix-'+(mixes.length+1),ad:'Daily Mix '+(mixes.length+1),altyazi:names.slice(0,3).join(', ')+(names.length>3?' and more':''),renk:colors[mixes.length%colors.length],kapak:own[0]||mixed[0],parcalar:mixed.slice(0,30).map(p=>p.appId)})
    }
    // On Repeat: what you keep coming back to here (last 30 days), then Spotify's On Repeat.
    const repeat=[...new Set([...store.db.prepare("SELECT track_id FROM events WHERE event='playing' AND track_id IS NOT NULL AND created>? GROUP BY track_id HAVING COUNT(*)>=2 ORDER BY COUNT(*) DESC LIMIT 40").all(Date.now()-30*86400000).map(r=>r.track_id),...(store.setting('spotifyOnRepeat')||[])])]
      .map(id=>store.getTrack(id)).filter(p=>p&&!store.isDismissed(p.appId)).slice(0,30)
    if(repeat.length>=8)mixes.unshift({id:'on-repeat',ad:'On Repeat',altyazi:"Songs you can’t stop playing",renk:'#e1118c',kapak:repeat[0],parcalar:repeat.map(p=>p.appId)})
    const result={day,mixes};if(mixes.length)store.setting('dailyMixes',result);return result
  }
  const history=createSpotifyHistory(store);let readingHistory=false
  app.post('/api/v1/import/spotify/history',async c=>{
    if(!['application/zip','application/octet-stream','application/x-zip-compressed'].includes((c.req.header('content-type')||'').split(';')[0]))throw new ApiError('INVALID_SPOTIFY_HISTORY',"Choose the ZIP file you downloaded from Spotify.",400)
    if(readingHistory)throw new ApiError('IMPORT_BUSY',"Another Spotify file is being read. Try again shortly.",429,true)
    readingHistory=true
    try{return c.json(history.apply(await readSpotifyHistory(Buffer.from(await c.req.arrayBuffer()))))}finally{readingHistory=false}
  })
  app.get('/api/v1/import/spotify/history',c=>c.json(history.summary()))
  app.get('/api/v1/stats',c=>c.json(computeStats(store,{range:c.req.query('range')||'4w'})))
  const mixView=m=>({...m,parcaSayisi:m.parcalar.length,parcalar:undefined})
  app.get('/api/v1/mixes',async c=>{const {day,mixes}=await dailyMixes();return c.json({day,mixes:mixes.map(mixView)})})
  app.get('/api/v1/mixes/:id',async c=>{
    const mix=(await dailyMixes()).mixes.find(m=>m.id===c.req.param('id'));if(!mix)throw new ApiError('NOT_FOUND',"This mix is no longer available.",404)
    return c.json({...mixView(mix),parcalar:mix.parcalar.map(id=>store.getTrack(id)).filter(p=>p&&!store.isDismissed(p.appId))})
  })
  app.get('/api/v1/recommendations',async c=>c.json({parcalar:await recommend(store.history(1)[0]||store.favorites()[0])}))
  store.db.exec(`CREATE TABLE IF NOT EXISTS selections(id TEXT PRIMARY KEY,json TEXT NOT NULL,updated INTEGER NOT NULL);INSERT OR IGNORE INTO migrations VALUES(9,datetime('now'));`)
  async function section(id,load){
    try{const data=await load();const updatedAt=Date.now();store.db.prepare('INSERT OR REPLACE INTO selections VALUES(?,?,?)').run(id,JSON.stringify(data),updatedAt);return {state:'ready',data,updatedAt}}
    catch{const old=store.db.prepare('SELECT * FROM selections WHERE id=?').get(id);return {state:old?'stale':'error',data:old?JSON.parse(old.json):null,updatedAt:old?.updated||null,message:old?"Showing your last successful results.":"This section could not be loaded."}}
  }
  app.get('/api/v1/home',async c=>{
    const forYou=await section('forYou',()=>recommend(store.history(1)[0]||store.favorites()[0]))
    if(Array.isArray(forYou.data))forYou.data=forYou.data.filter(outsidePlaylists(store))
    const recent=store.history(20),rediscover=rediscoverHistory(store)
    return c.json({sections:{resume:{state:'ready',data:store.devices().find(d=>d.id===store.setting('activeDeviceId'))||null},recent:{state:'ready',data:recent},playlists:{state:'ready',data:store.lists()},forYou,rediscover:{state:'ready',data:rediscover},followed:await section('followed',()=>catalog.releases())}})
  })
  app.get('/api/v1/tracks/:id',async c=>{
    const track=store.getTrack(c.req.param('id'));if(!track)throw new ApiError('NOT_FOUND',"Track not found.",404)
    const hit=track.kaynak==='youtube'&&await audioCache?.cached(track).catch(()=>null)
    let lyrics=null
    if(track.kaynak==='kutuphane')try{const r=await subsonic('getLyrics.view',{artist:track.sanatci,title:track.baslik},c.req.raw.signal);lyrics=r.lyrics?.value||null}catch{}
    return c.json({parca:track,sources:store.db.prepare('SELECT source,source_id FROM sources WHERE track_id=?').all(track.appId),delivery:track.kaynak==='kutuphane'?'archive':hit?'temporary_cache':'online',format:hit?.format||track.bicim||null,bitrate:track.bitrate||null,version:track.baslik,credits:track.sanatcilar||[],lyrics})
  })
  app.get('/api/v1/tracks/:id/lyrics',async c=>{
    const track=store.getTrack(c.req.param('id'));if(!track)throw new ApiError('NOT_FOUND',"Track not found.",404)
    return c.json(lyrics?await lyrics.get(track,c.req.raw.signal):{synced:null,plain:null,instrumental:false,source:null})
  })
  app.post('/api/v1/radio',async c=>c.json({parcalar:await recommend((await c.req.json()).parca,{omitPlaylists:false})}))
  app.post('/api/v1/import/preview',async c=>{const b=await c.req.json();return c.json(imports.start(b.text,b.format),202)})
  app.get('/api/v1/import/preview/:id',c=>c.json(imports.get(c.req.param('id'))))
  app.delete('/api/v1/import/preview/:id',c=>c.json(imports.cancel(c.req.param('id'))))
  app.post('/api/v1/import/commit',async c=>{const b=await c.req.json();if(!Array.isArray(b.parcalar)||b.parcalar.length>500)throw new ApiError('INVALID_IMPORT',"Import up to 500 tracks at a time.",400);b.parcalar.forEach(validTrack);const id=store.db.transaction(()=>{const id=store.createList(b.name||"Imported playlist");store.add(id,b.parcalar);return id})();return c.json({id},201)})
  app.get('/api/v1/archive/jobs',c=>c.json({jobs:store.jobs()}))
  app.post('/api/arsive-ekle',async c=>{if(process.env.ARCHIVE_DISABLED==='1')throw new ApiError('STAGING_READ_ONLY',"Archive downloads are disabled on this server.",403);const b=await c.req.json();return c.json(await archive.start(b.parca||{id:randomUUID(),baslik:b.baslik,sanatci:b.sanatci,kaynak:'youtube'}),202)})
  app.get('/api/arsive-ekle/:id',c=>{const j=store.getJob(c.req.param('id'));if(!j)throw new ApiError('NOT_FOUND',"Download not found.",404);return c.json(j)})
  app.post('/api/v1/archive/jobs/:id/select',async c=>c.json(await archive.select(c.req.param('id'),(await c.req.json()).candidateId)))
  app.get('/api/yt/album/:id',async c=>c.json(await catalog.album('youtube',c.req.param('id'),c.req.raw.signal)))
  return {resume:()=>{imports.resume();spotify.recover()},recommend,stop:()=>{imports.stop();spotify.stop();catalog.stop()},catalogArtist:catalog.artist,catalogAlbum:catalog.album}
}

export async function migrateNavidrome(store,subsonic,mapSong){
  if(store.setting('navidromeMigrationV1'))return
  const starred=await subsonic('getStarred2.view'),lists=await subsonic('getPlaylists.view')
  const full=[];for(const p of lists.playlists?.playlist||[]){const r=await subsonic('getPlaylist.view',{id:p.id});full.push(r.playlist)}
  store.db.transaction(()=>{for(const p of starred.starred2?.song||[])store.favorite(mapSong(p),true)
    for(const p of full){const origin='navidrome:'+p.id;const exists=store.db.prepare('SELECT id FROM playlists WHERE origin=?').get(origin);if(exists)continue;const id=store.createList(p.name,origin);store.add(id,(p.entry||[]).map(mapSong))}
    store.setting('navidromeMigrationV1',{at:Date.now(),lists:full.length})
  })()
}
