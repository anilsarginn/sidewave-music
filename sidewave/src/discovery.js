import {ApiError,count as recordCount,observe} from './telemetry.js'

/** Source IDs come only from stored references; display names never identify sonic inputs. */
export function createDiscovery({store,subsonic,sonicSubsonic=subsonic,mapSong,online,coverage=async()=>null,audioArtists=async()=>[],bridge={toTrack:async id=>id,fromTrack:async id=>id,toArtist:async id=>id,fromArtist:async id=>id}}) {
  let cached=null
  async function capabilities(signal) {
    if(cached && cached.until>Date.now())return cached.value
    try {
      const [extensions,analysis]=await Promise.all([sonicSubsonic('getOpenSubsonicExtensions.view',{},signal),coverage(signal).catch(()=>null)])
      const available=(extensions.openSubsonicExtensions||[]).some(e=>e.name==='sonicSimilarity' && (e.versions||[]).includes(1))
      const value={available,method:'audio',source:'navidrome',state:available?'available':'unsupported',message:available?"Available for analyzed tracks in your library.":"Audio similarity is not ready yet.",analysis}
      cached={value,until:Date.now()+15000};return value
    }catch {return {available:false,method:'audio',source:'navidrome',state:'unavailable',message:"Audio similarity is unavailable.",analysis:null}}
  }
  async function requireCapability(signal) {
    const c=await capabilities(signal)
    if(!c.available)throw new ApiError('SONIC_UNAVAILABLE',c.message,503,true)
  }
  async function localTrack(raw,signal) {
    if(!raw || typeof raw.id!=='string' || !['kutuphane','youtube'].includes(raw.kaynak))throw new ApiError('INVALID_TRACK',"Choose a track.",400)
    let source=store.db.prepare('SELECT track_id FROM sources WHERE source=? AND source_id=?').get(raw.kaynak,raw.id)
    if(!source && raw.kaynak==='kutuphane') {const r=await subsonic('getSong.view',{id:raw.id},signal);if(r.song?.id!==raw.id)throw new ApiError('NOT_FOUND',"Library track not found.",404);source={track_id:store.upsert(mapSong(r.song)).appId}}
    const local=source && store.db.prepare("SELECT source_id FROM sources WHERE track_id=? AND source='kutuphane'").get(source.track_id)
    if(!local)throw new ApiError('ARCHIVE_REQUIRED',"Audio similarity requires a verified library copy of this recording.",409)
    const verified=await subsonic('getSong.view',{id:local.source_id},signal)
    if(verified.song?.id!==local.source_id)throw new ApiError('ARCHIVE_REQUIRED',"This library copy is not currently playable.",409)
    return store.upsert(mapSong(verified.song))
  }
  async function verifiedTracks(matches,signal) {
    const output=[],seen=new Set()
    // Verify against the playback catalog, not a potentially stale analysis replica.
    for(const match of matches.slice(0,100)) {
      const id=await bridge.fromTrack(match.entry?.id,signal)
      if(!id || seen.has(id))continue
      seen.add(id)
      try {
        const r=await subsonic('getSong.view',{id},signal)
        if(r.song?.id!==id)continue
        const score=Number(match.similarity)
        output.push({parca:store.upsert(mapSong(r.song)),similarity:typeof match.similarity==='number' && score>=0 && score<=1?score:null})
      }catch(e){if(signal?.aborted)throw e}
    }
    return output
  }
  async function similar(raw,{count=20,signal,mix=false}={}) {
    if(raw?.kaynak==='youtube' && online)return online.start(raw,{count,signal,mix})
    let seed
    try {seed=await localTrack(raw,signal)} catch(e) {if(e.code==='ARCHIVE_REQUIRED' && raw?.kaynak==='youtube' && online)return online.start(raw,{count,signal,mix});throw e}
    await requireCapability(signal)
    const sonicId=await bridge.toTrack(seed.id,signal)
    let result
    try { result=await sonicSubsonic('getSonicSimilarTracks.view',{id:sonicId,count:Math.min(100,count+1)},signal) }
    catch { throw new ApiError('SONIC_NOT_READY',"Audio discovery is not ready for this track yet. Please try again shortly.",409,true) }
    const matches=await verifiedTracks(result.sonicMatch||[],signal)
    const recent=new Set(store.history(20).map(p=>p.appId)),artists=new Map()
    const filtered=matches.filter(m=>{
      if(m.parca.appId===seed.appId || store.isDismissed(m.parca.appId))return false
      if(mix) {if(recent.has(m.parca.appId))return false;const artist=m.parca.sanatciId||m.parca.sanatci,uses=artists.get(artist)||0;if(uses>=2)return false;artists.set(artist,uses+1)}
      return true
    }).slice(0,count)
    return {state:filtered.length?'ready':'no_results',method:'audio',source:'navidrome',scoreMeaning:'audio_similarity',message:filtered.length?null:"No suitable audio matches were found for this track yet.",seed,matches:filtered,parcalar:mix?[seed,...filtered.map(m=>m.parca)]:filtered.map(m=>m.parca)}
  }
  async function path(start,end,{count=12,signal}={}) {
    const [first,last]=await Promise.all([localTrack(start,signal),localTrack(end,signal)])
    if(first.appId===last.appId)throw new ApiError('SAME_ANCHOR',"Choose different start and end tracks.",400)
    await requireCapability(signal)
    const [firstId,lastId]=await Promise.all([bridge.toTrack(first.id,signal),bridge.toTrack(last.id,signal)])
    let result
    try { result=await sonicSubsonic('findSonicPath.view',{startSongId:firstId,endSongId:lastId,count},signal) }
    catch { throw new ApiError('SONIC_NOT_READY',"Audio analysis is not ready for this path yet. Please try again later.",409,true) }
    const matches=await verifiedTracks(result.sonicMatch||[],signal)
    if(matches[0]?.parca.id!==first.id || matches.at(-1)?.parca.id!==last.id || matches.length<2)throw new ApiError('INCOMPLETE_SONIC_PATH',"A playable path could not be built between these tracks.",409)
    return {state:'ready',method:'audio',source:'navidrome',scoreMeaning:'similarity_to_start',matches,parcalar:matches.map(m=>m.parca)}
  }
  async function artists(id,signal) {
    const artist=store.catalog.get(id,'artist')
    if(!artist)throw new ApiError('NOT_FOUND',"Artist not found.",404)
    if(artist.kaynak!=='kutuphane')throw new ApiError('ARCHIVE_REQUIRED',"Artist similarity requires analyzed library recordings.",409)
    await requireCapability(signal)
    const sonicId=await bridge.toArtist(artist.id,signal)
    const r=await sonicSubsonic('getArtistInfo2.view',{id:sonicId,includeNotPresent:false},signal)
    const related=await Promise.all((r.artistInfo2?.similarArtist||[]).map(async a=>({...a,id:await bridge.fromArtist(a.id,signal)})))
    if(!related.some(a=>a.id && a.id!==artist.id)) {
      // Some providers omit artist_id even for a valid audio result. Resolve only
      // through its representative files' explicit artist references, never a name search.
      const candidates=await audioArtists(sonicId,signal).catch(()=>[])
      for(const candidate of candidates.slice(0,12)) {
        const songIds=[...new Set((candidate.component_matches||[]).flatMap(m=>m.artist2_representative_songs||[]).map(p=>p.item_id).filter(Boolean))].slice(0,12)
        const refs=new Map()
        for(const sonicTrackId of songIds) {
          const localId=await bridge.fromTrack(sonicTrackId,signal);if(!localId)continue
          try {const song=(await subsonic('getSong.view',{id:localId},signal)).song;if(song?.artistId)refs.set(song.artistId,song.artist)}catch(e){if(signal?.aborted)throw e}
        }
        if(refs.size!==1)continue
        const [id,name]=[...refs][0]
        if(id!==artist.id && name && !related.some(a=>a.id===id))related.push({id,name})
      }
    }
    return {method:'audio',source:'navidrome',message:related.some(a=>a.id && a.id!==artist.id)?null:"No audio-similar artists were found yet.",sanatcilar:related.filter(a=>a.id && a.id!==artist.id && a.id!=='-1').map(a=>store.catalog.put('artist','kutuphane',a.id,{ad:a.name,kapakId:a.coverArt||a.id}))}
  }
  return {capabilities,similar,path,artists}
}
export function installDiscoveryApi(app,options) {
  const discovery=createDiscovery(options)
  async function measure(operation,work){const start=Date.now();try{const data=await work();recordCount('sidewave_discovery_requests_total',operation,data.state||'ready');return data}catch(e){recordCount('sidewave_discovery_requests_total',operation,e.code||'error');throw e}finally{observe('sidewave_discovery_seconds',operation,Date.now()-start)}}
  if(options.online)app.get('/api/v1/discovery/sessions/:id',c=>c.json(options.online.result(c.req.param('id'),{mix:c.req.query('mix')==='true',count:20})))
  if(options.online)app.post('/api/v1/discovery/sessions/:id/retry',c=>c.json(options.online.retry(c.req.param('id'))))
  const signal=c=>AbortSignal.any([c.req.raw.signal,AbortSignal.timeout(12000)])
  const count=(value,fallback,max=50)=>{if(value===undefined)return fallback;if(!Number.isInteger(value)||value<2||value>max)throw new ApiError('INVALID_COUNT',"Invalid track count.",400);return value}
  app.get('/api/v1/discovery/capabilities',async c=>c.json(await discovery.capabilities(signal(c))))
  for(const [route,mix] of [['similar-tracks',false],['instant-mix',true]])app.post('/api/v1/discovery/'+route,async c=>{const b=await c.req.json();return c.json(await measure(route,()=>discovery.similar(b.parca,{count:count(b.count,20),signal:signal(c),mix})))})
  app.post('/api/v1/discovery/path',async c=>{const b=await c.req.json();return c.json(await measure('path',()=>discovery.path(b.start,b.end,{count:count(b.count,12),signal:signal(c)})))})
  app.get('/api/v1/discovery/artists/:id',async c=>c.json(await measure('artists',()=>discovery.artists(c.req.param('id'),signal(c)))))
  return discovery
}
