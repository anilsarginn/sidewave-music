import { randomUUID } from 'node:crypto'
import { ApiError } from './telemetry.js'

const sources = new Set(['kutuphane', 'youtube'])
export function createCatalog(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS catalog_entities(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('artist','album')),json TEXT NOT NULL,updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS catalog_sources(kind TEXT NOT NULL,source TEXT NOT NULL,source_id TEXT NOT NULL,entity_id TEXT NOT NULL REFERENCES catalog_entities(id),PRIMARY KEY(kind,source,source_id));
    CREATE TABLE IF NOT EXISTS artist_follows(entity_id TEXT PRIMARY KEY REFERENCES catalog_entities(id),created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS saved_albums(entity_id TEXT PRIMARY KEY REFERENCES catalog_entities(id),created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS track_credits(track_id TEXT NOT NULL REFERENCES tracks(id),entity_id TEXT NOT NULL REFERENCES catalog_entities(id),role TEXT NOT NULL,PRIMARY KEY(track_id,entity_id,role));
    INSERT OR IGNORE INTO migrations VALUES(3,datetime('now'));`)
  function get(id, kind) {
    const row = db.prepare('SELECT * FROM catalog_entities WHERE id=?').get(id)
    if (!row || (kind && kind !== row.kind)) return null
    const table = row.kind === 'artist' ? 'artist_follows' : 'saved_albums'
    const selected = !!db.prepare(`SELECT 1 FROM ${table} WHERE entity_id=?`).get(id)
    return {...JSON.parse(row.json), appId: row.id, updatedAt: row.updated, ...(row.kind === 'artist' ? {takip: selected} : {kayitli: selected})}
  }
  function find(kind, source, id) {
    const row = db.prepare('SELECT entity_id FROM catalog_sources WHERE kind=? AND source=? AND source_id=?').get(kind, source, id)
    return row ? get(row.entity_id, kind) : null
  }
  const put = db.transaction((kind, source, id, data, detail = false) => {
    if (!['artist', 'album'].includes(kind) || !sources.has(source) || typeof id !== 'string' || !id || id.length > 256 || typeof data.ad !== 'string' || !data.ad.trim())
      throw new ApiError('INVALID_CATALOG_ENTITY', "A valid artist or album is required.", 400)
    // Provider identity is evidence. A matching display name never merges artists or releases.
    const prior = find(kind, source, id), appId = prior?.appId || randomUUID()
    const clean = Object.fromEntries(Object.entries(data).filter(([key, value]) => !['appId','takip','kayitli','updatedAt','stale','warning'].includes(key) && value != null))
    if (kind === 'album' && clean.yil != null) { const year = Number(clean.yil); if (Number.isInteger(year) && year > 0) clean.yil = year; else delete clean.yil }
    const json = {...prior, ...clean, id, kaynak: source, detayAlindi: detail || !!prior?.detayAlindi}
    delete json.appId; delete json.takip; delete json.kayitli; delete json.updatedAt
    db.prepare('INSERT INTO catalog_entities VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json,updated=excluded.updated').run(appId, kind, JSON.stringify(json), detail ? Date.now() : prior?.updatedAt || 0)
    db.prepare('INSERT OR IGNORE INTO catalog_sources VALUES(?,?,?,?)').run(kind, source, id, appId)
    return get(appId, kind)
  })
  function select(kind, id, yes) {
    if (typeof yes !== 'boolean') throw new ApiError('INVALID_SELECTION', "Selection must be true or false.", 400)
    if (!get(id, kind)) throw new ApiError('NOT_FOUND', "This item was not found. Open its page first.", 404)
    const table = kind === 'artist' ? 'artist_follows' : 'saved_albums'
    if (yes) db.prepare(`INSERT OR IGNORE INTO ${table} VALUES(?,?)`).run(id, Date.now())
    else db.prepare(`DELETE FROM ${table} WHERE entity_id=?`).run(id)
    return get(id, kind)
  }
  function library() {
    const list = (table, kind) => db.prepare(`SELECT entity_id FROM ${table} ORDER BY created DESC`).all().map(row => get(row.entity_id, kind))
    return {sanatcilar: list('artist_follows', 'artist'), albumler: list('saved_albums', 'album')}
  }
  function credit(trackId, p) {
    const references = Array.isArray(p.sanatcilar) ? p.sanatcilar : p.sanatciId && p.sanatci ? [{id:p.sanatciId,ad:p.sanatci}] : []
    const artists = references.filter(a=>a && typeof a.id === "string" && (a.ad || a.name)).slice(0,20).map((a,index)=>{
      const artist = find('artist',p.kaynak,a.id) || put('artist',p.kaynak,a.id,{ad:a.ad || a.name})
      db.prepare('INSERT OR IGNORE INTO track_credits VALUES(?,?,?)').run(trackId,artist.appId,index===0?'primary':'featured')
      return {appId:artist.appId,id:artist.id,ad:artist.ad,kaynak:artist.kaynak}
    })
    const album = p.albumId && p.album ? find('album',p.kaynak,p.albumId) || put('album',p.kaynak,p.albumId,{ad:p.album,sanatci:p.sanatci,sanatciId:p.sanatciId}) : null
    return {artists,albumAppId:album?.appId}
  }
  return {get,find,put,select,library,credit}
}

export function installCatalogApi(app,{store,subsonic,ytres,mapSong,artistCatalog}) {
  const catalog=store.catalog
  async function artist(source,id,signal,{refresh=false}={}) {
    const prior=catalog.find('artist',source,id)
    if (!sources.has(source)) throw new ApiError('INVALID_SOURCE',"Invalid catalog source.",400)
    if (!refresh && prior?.detayAlindi && prior.catalogVersion===2 && Date.now()-prior.updatedAt<90000) return prior
    try {
      let data
      if(source==='youtube') {
        const a=await artistCatalog(id,signal)
        data={ad:a.ad,abone:a.abone,biyografi:a.biyografi,gorselUrl:a.gorsel,
          albumler:(a.albumler||[]).map(al=>catalog.put('album',source,al.id,{...al,sanatci:a.ad,sanatciId:id})),
          enCokDinlenen:(a.parcalar||[]).map(p=>store.upsert({...p,kaynak:source})),benzer:a.benzer||[],diskografiTam:!!a.diskografiTam}
      } else {
        const a=await subsonic('getArtist.view',{id},signal), s=a.artist
        if (!s?.id || !s.name) throw new ApiError('NOT_FOUND',"Artist not found.",404)
        const [info,top]=await Promise.allSettled([subsonic('getArtistInfo2.view',{id,includeNotPresent:false},signal),subsonic('getTopSongs.view',{artist:s.name,count:20},signal)])
        const bi=info.status==='fulfilled'?info.value.artistInfo2||{}:{}
        const albums=s.album||[], pending=[...albums], recordings=[];let failedAlbums=0
        await Promise.all(Array.from({length:Math.min(4,albums.length)},async()=>{while(pending.length){const album=pending.shift();try{const r=await subsonic('getAlbum.view',{id:album.id},signal);recordings.push(...(r.album?.song||[]))}catch(e){if(signal?.aborted)throw e;failedAlbums++}}}))
        const all=[...new Map(recordings.map(p=>[p.id,p])).values()].map(p=>store.upsert(mapSong(p)))
        const popular=(top.status==='fulfilled'?top.value.topSongs?.song||[]:[]).map(p=>store.upsert(mapSong(p)))
        data={ad:s.name,kapakId:s.coverArt||id,gorselUrl:bi.largeImageUrl||bi.mediumImageUrl,biyografi:(bi.biography||'').replace(/<[^>]*>/g,'').trim(),
          albumler:(s.album||[]).map(al=>catalog.put('album',source,al.id,{ad:al.name,sanatci:s.name,sanatciId:id,yil:al.year,parcaSayisi:al.songCount,kapakId:al.coverArt||al.id,tur:'album'})),
          enCokDinlenen:popular.length?popular:all.slice(0,20),parcalar:all,parcaBasligi:popular.length?"Popular tracks":"From your library",catalogWarning:failedAlbums?"Some library albums are unavailable right now.":'',
          benzer:(bi.similarArtist||[]).filter(a=>a.id && a.id!=='-1').slice(0,12).map(a=>({id:a.id,ad:a.name,kaynak:source})),diskografiTam:true}
      }
      return catalog.put('artist',source,id,{...data,catalogVersion:2},true)
    } catch(e) {
      if (signal?.aborted) throw e
      if(prior?.detayAlindi) return {...prior,stale:true,warning:"The source is not responding. Showing its last saved page."}
      throw e
    }
  }
  async function album(source,id,signal) {
    if (!sources.has(source)) throw new ApiError('INVALID_SOURCE',"Invalid catalog source.",400)
    const prior=catalog.find('album',source,id)
    if(prior?.detayAlindi && prior.catalogVersion===2 && Date.now()-prior.updatedAt<90000)return prior
    try {
      let data
      if(source==='youtube') {const a=await ytres('/album?browseId='+encodeURIComponent(id),{signal});data={...a,parcalar:(a.parcalar||[]).map(p=>store.upsert({...p,kaynak:source}))}}
      else {const r=await subsonic('getAlbum.view',{id},signal),a=r.album;if(!a?.id || !a.name)throw new ApiError('NOT_FOUND',"Album not found.",404)
        data={ad:a.name,sanatci:a.artist,sanatciId:a.artistId,yil:a.year,kapakId:a.coverArt||id,parcaSayisi:a.songCount,toplamSure:a.duration,tur:'album',parcalar:(a.song||[]).map(p=>store.upsert(mapSong(p)))}}
      return catalog.put('album',source,id,{...data,catalogVersion:2},true)
    }catch(e){if(signal?.aborted)throw e;if(prior?.detayAlindi)return {...prior,stale:true,warning:"The source is not responding. Showing its last saved album."};throw e}
  }
  let scanning=false,stopped=false,lastScan=0
  async function scanReleases(){
    if(scanning||stopped||Date.now()-lastScan<60000)return;scanning=true;lastScan=Date.now()
    try{const follows=catalog.library().sanatcilar
      for(let offset=0;offset<follows.length&&!stopped;offset+=3){
        await Promise.all(follows.slice(offset,offset+3).map(async follow=>{
          try{const profile=await artist(follow.kaynak,follow.id,AbortSignal.timeout(8000),{refresh:true});if(!profile.stale)store.setting('releaseScan:'+follow.appId,{updatedAt:Date.now()})}catch{}
        }))
        if(offset+3<follows.length)await new Promise(r=>{const timer=setTimeout(r,1000);timer.unref()})
      }
    }finally{scanning=false}
  }
  async function releases(){
    let follows=catalog.library().sanatcilar
    // Fresh tiny libraries can be populated immediately; large libraries scan in bounded background batches.
    if(follows.length<=3&&!follows.every(f=>store.setting('releaseScan:'+f.appId)))await scanReleases()
    else if(!scanning)void scanReleases()
    follows=catalog.library().sanatcilar
    const dates=follows.map(f=>store.setting('releaseScan:'+f.appId)?.updatedAt||0),stale=dates.some(at=>Date.now()-at>86400000)
    const items=[...new Map(follows.flatMap(f=>f.albumler||[]).map(a=>[a.appId||a.kaynak+':'+a.id,a])).values()].sort((a,b)=>(Number(b.yil)||0)-(Number(a.yil)||0)).slice(0,60)
    return {items,stale,updatedAt:dates.length?Math.min(...dates):null,refreshing:scanning,warning:stale?"Updating releases in the background. Showing the last available results.":null,followedCount:follows.length,coveredArtists:dates.filter(Boolean).length}
  }
  app.get('/api/v1/library/releases',async c=>c.json(await releases()))
  const scanTimer=process.env.SKIP_LISTEN==='1'?null:setInterval(()=>void (store.forAccounts?store.forAccounts(scanReleases):scanReleases()),6*3600000);scanTimer?.unref()
  app.get('/api/v1/library',c=>c.json(catalog.library()))
  app.get('/api/v1/catalog/artists/:source/:id',async c=>c.json(await artist(c.req.param('source'),c.req.param('id'),c.req.raw.signal)))
  app.get('/api/v1/catalog/albums/:source/:id',async c=>c.json(await album(c.req.param('source'),c.req.param('id'),c.req.raw.signal)))
  for(const [kind,path,action,field] of [['artist','artists','follow','takip'],['album','albums','save','kayitli']]) {
    app.get(`/api/v1/${path}/:id`,async c=>{const entity=catalog.get(c.req.param('id'),kind);if(!entity)throw new ApiError('NOT_FOUND',"Track not found.",404);return c.json(await (kind==='artist'?artist:album)(entity.kaynak,entity.id,c.req.raw.signal))})
    app.put(`/api/v1/${path}/:id/${action}`,async c=>c.json(catalog.select(kind,c.req.param('id'),(await c.req.json())[field])))
  }
  app.get('/api/v1/artists/:id/releases',async c=>{
    const entity=catalog.get(c.req.param('id'),'artist');if(!entity)throw new ApiError('NOT_FOUND',"Artist not found.",404)
    let a=await artist(entity.kaynak,entity.id,c.req.raw.signal)
    const type=c.req.query('type')||'all', order=c.req.query('sort')||'newest'
    if(!['all','album','single'].includes(type)||!['newest','oldest','name'].includes(order))throw new ApiError('INVALID_FILTER',"Invalid release filter.",400)
    const offset=Number(c.req.query('offset')||0),limit=Number(c.req.query('limit')||24)
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new ApiError('INVALID_PAGE',"Invalid page.",400)
    if(c.req.query('expand')==='true' && entity.kaynak==='youtube') {
      const types=type==='all'?['album','single']:[type]
      const results=await Promise.all(types.map(kind=>ytres('/yayimlar?browseId='+encodeURIComponent(entity.id)+'&kind='+kind,{signal:AbortSignal.any([c.req.raw.signal,AbortSignal.timeout(8000)])})))
      const replacement=results.flatMap(result=>result.items||[]).map(al=>catalog.put('album','youtube',al.id,al))
      const completeTypes={...a.completeTypes,...Object.fromEntries(types.map((kind,i)=>[kind,results[i].complete===true]))}
      a=catalog.put('artist',entity.kaynak,entity.id,{...a,albumler:[...(a.albumler||[]).filter(al=>!types.includes(al.tur)),...replacement],completeTypes,diskografiTam:completeTypes.album===true && completeTypes.single===true},true)
    }
    const all=(a.albumler||[]).filter(al=>type==='all'||al.tur===type).sort((x,y)=>order==='name'?x.ad.localeCompare(y.ad,'tr'):order==='oldest'?(Number(x.yil)||0)-(Number(y.yil)||0):(Number(y.yil)||0)-(Number(x.yil)||0))
    return c.json({items:all.slice(offset,offset+limit),total:all.length,nextOffset:offset+limit<all.length?offset+limit:null,complete:!!a.diskografiTam || (type!=='all' && a.completeTypes?.[type]===true),...(a.warning?{warning:a.warning}:{})})
  })
  return {artist,album,releases,stop:()=>{stopped=true;clearInterval(scanTimer)}}
}
