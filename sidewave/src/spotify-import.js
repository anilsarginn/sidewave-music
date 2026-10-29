import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { normalize, validTrack } from './store.js'
import { ApiError } from './telemetry.js'

const hash=value=>createHash('sha256').update(value).digest('hex')
const invalid=()=>new ApiError('INVALID_SPOTIFY_EXPORT',"Choose an Exportify ZIP / CSV or Spotify Playlist / YourLibrary JSON file. English and Turkish Exportify columns are supported. This file is invalid or contains no supported library data.",400)
const text=value=>typeof value==='string'?value.trim().slice(0,2000):''

export function readSpotifyExport(buffer,{fileName='Spotify.json'}={}){
  if(buffer.length>64*1024*1024)throw new ApiError('IMPORT_TOO_LARGE',"Files must be smaller than 64 MB.",413)
  return new Promise((resolve,reject)=>{
    const child=spawn('python3',[new URL('./spotify-export-reader.py',import.meta.url).pathname,text(fileName)],{stdio:['pipe','pipe','pipe']})
    let size=0,output=[],settled=false
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish(invalid())},15000)
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value)}
    child.on('error',()=>finish(invalid()));child.stdin.on('error',()=>{});child.stderr.resume()
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>32*1024*1024){child.kill('SIGKILL');finish(invalid())}else output.push(chunk)})
    child.on('close',code=>{if(code!==0)return finish(invalid());try{finish(null,parseSpotifyDocuments(JSON.parse(Buffer.concat(output).toString('utf8'))))}catch{finish(invalid())}})
    child.stdin.end(buffer)
  })
}

// Export schemas have changed over time. Recognize explicit playlist/library shapes only;
// listening history, saved albums, and followed artists must never become liked songs.
export function parseSpotifyDocuments(documents){
  const collections=[],warnings=[],names=new Map();let hasLibrary=false,hasPlaylists=false,total=0,csvCount=0
  const track=(raw,playlist=false)=>{
    const p=playlist?(raw?.track||raw?.localTrack):raw
    const baslik=text(p?.trackName||p?.track||p?.name),sanatci=text(p?.artistName||p?.artist||p?.artists?.map(a=>typeof a==='string'?a:a.name).join(', '))
    const uri=text(p?.trackUri||p?.uri)
    const unsupported=!p||!baslik||!sanatci||!!raw?.episode||!!raw?.localTrack||p?.type==='episode'||(uri&&!uri.startsWith('spotify:track:'))
    return {baslik:baslik||text(raw?.episode?.episodeName)||"Unavailable track",sanatci,album:text(p?.albumName||p?.album?.name||p?.album),spotifyUri:uri,
      sure:Number(p?.duration_ms)>0?Number(p.duration_ms)/1000:null,status:unsupported?'unsupported':'pending',candidates:[],selected:null}
  }
  for(const document of documents){
    const data=document.data
    if(!data||typeof data!=='object'||Array.isArray(data))throw invalid()
    if(document.format==='csv'){
      if(!Array.isArray(data.tracks))throw invalid()
      const file=text(document.name),name=file.split('/').pop().replace(/\.csv$/i,'').slice(0,200)||"Exportify playlist"
      collections.push({key:'csv:'+file,name,kind:'playlist',rows:data.tracks.map(p=>track(p))});csvCount++;hasPlaylists=true;continue
    }
    if(Array.isArray(data.playlists)){
      hasPlaylists=true
      for(const playlist of data.playlists){
        if(!playlist||!Array.isArray(playlist.items))throw invalid()
        const name=text(playlist.name)||"Untitled Spotify playlist";if(name.length>200)throw invalid()
        const occurrence=(names.get(name)||0)+1;names.set(name,occurrence)
        const uri=text(playlist.uri||playlist.playlistUri),key=uri.startsWith('spotify:playlist:')?uri:'name:'+name+':'+occurrence
        collections.push({key,name,kind:'playlist',rows:playlist.items.map(p=>track(p,true))})
      }
    }
    if(Array.isArray(data.tracks)){
      hasLibrary=true
      let liked=collections.find(c=>c.kind==='favorites')
      if(!liked){liked={key:'liked-songs',name:"Liked Songs",kind:'favorites',rows:[]};collections.push(liked)}
      liked.rows.push(...data.tracks.map(p=>track(p)))
    }
  }
  if(!hasLibrary&&!hasPlaylists)throw invalid()
  if(!hasLibrary)warnings.push(csvCount?"CSV files were opened as playlists. Choose your liked songs file below; filenames are not used to identify likes.":"No YourLibrary file was found. Add YourLibrary.json to import your liked songs.")
  if(csvCount)warnings.push("CSV filenames become playlist names. Check that your Exportify download includes all your playlists and liked songs.")
  if(!hasPlaylists)warnings.push("No Playlist file was found. This download contains liked songs only.")
  if([...names.values()].some(n=>n>1))warnings.push("Playlists with identical names are kept separate. Without Spotify IDs, the name and file order identify a repeated import.")
  const keys=new Set()
  for(const collection of collections){
    if(keys.has(collection.key))throw new ApiError('DUPLICATE_SPOTIFY_PLAYLIST',"The same Spotify playlist appears twice. Choose a data package from one account.",400)
    keys.add(collection.key);const occurrences=new Map()
    collection.rows=collection.rows.filter(row=>{
      const identity=row.spotifyUri||[row.sanatci,row.baslik,row.album].join('|')
      const n=(occurrences.get(identity)||0)+1;occurrences.set(identity,n)
      row.sourceKey=hash(identity)+':'+n
      return collection.kind!=='favorites'||n===1
    })
    total+=collection.rows.length
  }
  if(collections.length>2000||total>100000)throw new ApiError('IMPORT_TOO_LARGE',"This package exceeds 2,000 playlists or 100,000 tracks. Import Playlist JSON files separately.",400)
  return {collections,warnings,total,hasLibrary,hasPlaylists}
}

function recordingMetadata(p){
  const featured=[]
  let title=p.baslik.replace(/\s*[([]\s*(?:feat\.?|ft\.?|featuring)\s+([^\])]+)[)\]]/gi,(_,names)=>{featured.push(...names.split(/,\s*|\s+&\s+/));return ''})
  // Presentation-only labels carry no performance identity. Live/remix/cover words stay.
  title=title.replace(/\s*\((?:official audio|official video|lyrics|lyric video|visualizer)\)/gi,'')
  if(/^(?:[a-z]\.){2,}[a-z]?\.?$/i.test(title.trim()))title=title.replace(/\./g,'')
  title=title.replace(/\b(\d{4})\s+remaster(?:ed)?\b/gi,'remaster $1').replace(/\bremastered\b/gi,'remaster')
  const credits=[...String(p.sanatci||'').split(/,\s*/),...(p.sanatcilar||[]).map(a=>a.ad),...featured].map(normalize).filter(Boolean)
  return {title:normalize(title),credits:[...new Set(credits)].sort().join('|')}
}
export function chooseSpotifyMatch(row,candidates){
  const expected=recordingMetadata(row)
  const exact=candidates.filter(p=>{
    const duration=row.sure?Number(p.sure)>0&&Math.abs(p.sure-row.sure)<=3:!!row.album&&normalize(p.album)===normalize(row.album)
    if(!duration)return false
    const actual=recordingMetadata(p),album=!!row.album&&normalize(row.album)===normalize(p.album)
    const title=expected.title===actual.title || album&&expected.title.replace(/(?:^| )original mix$/,'').trim()===actual.title.replace(/(?:^| )original mix$/,'').trim()
    const credits=expected.credits===actual.credits || album&&!expected.credits.includes('|')&&!actual.credits.includes('|')&&expected.credits.replace(/ /g,'')===actual.credits.replace(/ /g,'')
    return title&&credits
  })
  const unique=new Map()
  for(const p of exact){const key=p.appId||`${p.kaynak}:${p.id}`;if(!unique.has(key)||p.kaynak==='kutuphane')unique.set(key,p)}
  return unique.size===1?[...unique.values()][0]:null
}

export function createSpotifyImports(store,search){
  const db=store.db,controllers=new Map()
  db.exec(`CREATE TABLE IF NOT EXISTS spotify_import_jobs(id TEXT PRIMARY KEY,json TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS spotify_import_collections(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES spotify_import_jobs(id),source_key TEXT NOT NULL,name TEXT NOT NULL,kind TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS spotify_import_rows(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES spotify_import_jobs(id),collection_id TEXT NOT NULL REFERENCES spotify_import_collections(id),position INTEGER NOT NULL,json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS spotify_import_rows_job ON spotify_import_rows(job_id,collection_id,position);
    CREATE TABLE IF NOT EXISTS spotify_import_applied(origin TEXT NOT NULL,source_key TEXT NOT NULL,entry_id TEXT,PRIMARY KEY(origin,source_key));
    INSERT OR IGNORE INTO migrations VALUES(4,datetime('now'));`)
  function save(job){db.prepare('UPDATE spotify_import_jobs SET json=? WHERE id=?').run(JSON.stringify(job),job.id);return job}
  function get(id){const r=db.prepare('SELECT json FROM spotify_import_jobs WHERE id=?').get(id);if(!r)throw new ApiError('NOT_FOUND',"Spotify import not found.",404);return JSON.parse(r.json)}
  function collections(id){return db.prepare('SELECT * FROM spotify_import_collections WHERE job_id=? ORDER BY rowid').all(id).map(c=>({id:c.id,name:c.name,kind:c.kind,canBeFavorites:c.source_key.startsWith('csv:'),
    ...db.prepare(`SELECT COUNT(*) AS total,SUM(json_extract(json,'$.status')='pending') AS pending,SUM(json_extract(json,'$.selected') IS NOT NULL AND json_extract(json,'$.selected')!='null') AS selected FROM spotify_import_rows WHERE collection_id=?`).get(c.id)}))}
  function status(id){const job=get(id);return {...job,collections:collections(id),counts:db.prepare(`SELECT COUNT(*) AS total,SUM(json_extract(json,'$.status')='pending') AS pending,SUM(json_extract(json,'$.selected') IS NOT NULL AND json_extract(json,'$.selected')!='null') AS selected,SUM(json_extract(json,'$.status')='unsupported') AS unsupported,SUM(json_extract(json,'$.status')='ambiguous') AS ambiguous,SUM(json_extract(json,'$.status')='unmatched') AS unmatched,SUM(json_extract(json,'$.status')='error') AS errors FROM spotify_import_rows WHERE job_id=?`).get(id)}}
  function rows(id,{collectionId,offset=0,filter='all'}={}){
    const job=get(id);offset=Number(offset);if(!Number.isSafeInteger(offset)||offset<0||!['all','review','selected'].includes(filter))throw new ApiError('INVALID_PAGE',"Invalid page.",400)
    let where='job_id=?';const args=[id]
    if(collectionId){where+=' AND collection_id=?';args.push(collectionId)}
    if(filter==='review')where+=" AND json_extract(json,'$.selected') IS NULL AND json_extract(json,'$.status')!='pending'"
    if(filter==='selected')where+=" AND json_extract(json,'$.selected') IS NOT NULL"
    const total=db.prepare('SELECT COUNT(*) AS n FROM spotify_import_rows WHERE '+where).get(...args).n
    const items=db.prepare('SELECT * FROM spotify_import_rows WHERE '+where+' ORDER BY rowid LIMIT 50 OFFSET ?').all(...args,offset).map(r=>{
      const row=JSON.parse(r.json),c=db.prepare('SELECT source_key FROM spotify_import_collections WHERE id=?').get(r.collection_id)
      const origin='spotify-export:'+hash(job.label)+':'+hash(c.source_key)
      return {...row,id:r.id,collectionId:r.collection_id,position:r.position,applied:!!db.prepare('SELECT 1 FROM spotify_import_applied WHERE origin=? AND source_key=?').get(origin,row.sourceKey)}
    })
    return {items,total,nextOffset:offset+items.length<total?offset+items.length:null}
  }
  function writeRow(id,row){db.prepare('UPDATE spotify_import_rows SET json=? WHERE id=?').run(JSON.stringify(row),id)}
  async function process(id){if(controllers.has(id))return;const ctrl=new AbortController();controllers.set(id,ctrl)
    try{
      const job=get(id);if(!['matching','paused'].includes(job.state))return;job.state='matching';save(job)
      const pending=db.prepare("SELECT id,json FROM spotify_import_rows WHERE job_id=? AND json_extract(json,'$.status')='pending' ORDER BY rowid").all(id)
      let cursor=0;const inFlight=new Map()
      async function worker(){while(cursor<pending.length&&!ctrl.signal.aborted){
        const r=pending[cursor++],row=JSON.parse(r.json),key=[row.spotifyUri,row.baslik,row.sanatci,row.album,row.sure].join('|')
        try{
          let task=inFlight.get(key)
          if(!task){task=(async()=>{
            const result=await search([row.sanatci,row.baslik].join(' '),{tracksOnly:true,signal:AbortSignal.any([ctrl.signal,AbortSignal.timeout(10000)])})
            const candidates=(result.parcalar||[]).slice(0,8).map(p=>({...validTrack(p),...(p.appId?{appId:p.appId}:{})}))
            const selected=chooseSpotifyMatch(row,candidates)
            return {candidates,selected,status:selected?'matched':candidates.length?'ambiguous':Object.values(result.hata||{}).some(Boolean)?'error':'unmatched'}
          })();inFlight.set(key,task);if(inFlight.size>1000)inFlight.delete(inFlight.keys().next().value)}
          const result=await task;if(ctrl.signal.aborted)return;Object.assign(row,result)
        }catch{if(ctrl.signal.aborted)return;row.status='error';row.message="Search failed. Please try again."}
        writeRow(r.id,row)
      }}
      await Promise.all([worker(),worker()]);if(!ctrl.signal.aborted){job.state='ready';save(job)}
    }catch{if(!ctrl.signal.aborted){try{const job=get(id);job.state='paused';if(!job.warnings.includes("Matching stopped. Try again to continue."))job.warnings.push("Matching stopped. Try again to continue.");save(job)}catch{}}}finally{controllers.delete(id)}
  }
  function start(parsed,label="My Spotify account"){
    label=text(label);if(!label||label.length>80)throw new ApiError('INVALID_NAME',"Account labels must be 1–80 characters.",400)
    const fingerprint=hash(label+'|'+JSON.stringify(parsed.collections))
    const prior=db.prepare("SELECT id FROM spotify_import_jobs WHERE json_extract(json,'$.fingerprint')=?").get(fingerprint)
    if(prior)return status(prior.id)
    if(db.prepare("SELECT 1 FROM spotify_import_jobs WHERE json_extract(json,'$.state')='matching'").get())throw new ApiError('IMPORT_BUSY',"Pause the current Spotify import first.",429,true)
    const job={id:randomUUID(),label,fingerprint,state:'matching',warnings:parsed.warnings,hasLibrary:parsed.hasLibrary,hasPlaylists:parsed.hasPlaylists,createdAt:Date.now(),lastCommit:null}
    db.transaction(()=>{
      db.prepare('INSERT INTO spotify_import_jobs VALUES(?,?,?)').run(job.id,JSON.stringify(job),job.createdAt)
      for(const c of parsed.collections){const cid=randomUUID();db.prepare('INSERT INTO spotify_import_collections VALUES(?,?,?,?,?)').run(cid,job.id,c.key,c.name,c.kind)
        c.rows.forEach((row,i)=>db.prepare('INSERT INTO spotify_import_rows VALUES(?,?,?,?,?)').run(randomUUID(),job.id,cid,i,JSON.stringify(row)))
      }
    })();void process(job.id);return status(job.id)
  }
  function pause(id){const job=get(id);if(job.state==='matching'){job.state='paused';save(job);controllers.get(id)?.abort()}return status(id)}
  function resume(id,retry=false){const job=get(id);if(controllers.has(id))throw new ApiError('IMPORT_BUSY',"Pausing. Please try again.",409,true)
    if(db.prepare("SELECT 1 FROM spotify_import_jobs WHERE id!=? AND json_extract(json,'$.state')='matching'").get(id))throw new ApiError('IMPORT_BUSY',"Another Spotify import is running.",429,true)
    if(retry)db.transaction(()=>{for(const r of db.prepare("SELECT id,json FROM spotify_import_rows WHERE job_id=? AND json_extract(json,'$.status') IN ('error','unmatched')").all(id)){const row=JSON.parse(r.json);row.status='pending';writeRow(r.id,row)}})()
    job.state='matching';save(job);void process(id);return status(id)
  }
  function select(id,rowId,candidateKey){const job=get(id);if(job.state==='matching')throw new ApiError('IMPORT_BUSY',"Matching is in progress. Pause it first.",409)
    const r=db.prepare('SELECT json,collection_id FROM spotify_import_rows WHERE id=? AND job_id=?').get(rowId,id);if(!r)throw new ApiError('NOT_FOUND',"Track not found.",404)
    const row=JSON.parse(r.json),p=candidateKey===null?null:row.candidates.find(p=>`${p.kaynak}:${p.id}`===candidateKey)
    if(candidateKey!==null&&!p)throw new ApiError('INVALID_SELECTION',"Choose one of this track’s matches.",400)
    const c=db.prepare('SELECT source_key FROM spotify_import_collections WHERE id=?').get(r.collection_id),origin='spotify-export:'+hash(job.label)+':'+hash(c.source_key)
    if(db.prepare('SELECT 1 FROM spotify_import_applied WHERE origin=? AND source_key=?').get(origin,row.sourceKey))throw new ApiError('IMPORT_ALREADY_APPLIED',"This track has been imported. Edit it in your playlist or liked songs.",409)
    row.selected=p;if(p)row.status='matched';else if(row.candidates.length)row.status='ambiguous';writeRow(rowId,row);return status(id)
  }
  async function research(id,rowId,query,signal){
    const job=get(id);if(job.state==='matching')throw new ApiError('IMPORT_BUSY',"Pause matching first.",409)
    const record=db.prepare('SELECT json FROM spotify_import_rows WHERE id=? AND job_id=?').get(rowId,id);if(!record)throw new ApiError('NOT_FOUND',"Track not found.",404)
    if(typeof query!=='string'||!query.trim()||query.length>300)throw new ApiError('INVALID_QUERY',"Search must be 1–300 characters.",400)
    const found=await search(query.trim(),{signal}),row=JSON.parse(db.prepare('SELECT json FROM spotify_import_rows WHERE id=? AND job_id=?').get(rowId,id).json)
    if(get(id).state==='matching')throw new ApiError('IMPORT_BUSY',"Matching restarted. Please try again.",409)
    // Explicit search only updates candidates. It never changes an applied row or chooses a recording.
    row.candidates=[...new Map([...(row.candidates||[]),...(found.parcalar||[]).slice(0,25)].map(p=>[p.kaynak+':'+p.id,p])).values()].slice(-50)
    writeRow(rowId,row);return status(id)
  }
  const favoritesFile=db.transaction((id,collectionId)=>{
    const job=get(id);if(job.state==='matching')throw new ApiError('IMPORT_BUSY',"Wait for matching to finish or pause it first.",409)
    if(job.state==='committed')throw new ApiError('IMPORT_ALREADY_APPLIED',"File type saved. Select the liked songs file before saving.",409)
    const csv=db.prepare("SELECT * FROM spotify_import_collections WHERE job_id=? AND source_key LIKE 'csv:%'").all(id)
    if(collectionId!==null&&!csv.some(c=>c.id===collectionId))throw new ApiError('INVALID_SELECTION',"Choose one of this import’s CSV files.",400)
    if(csv.some(c=>db.prepare('SELECT 1 FROM spotify_import_applied WHERE origin=?').get('spotify-export:'+hash(job.label)+':'+hash(c.source_key))))throw new ApiError('IMPORT_ALREADY_APPLIED',"File type saved. Select the liked songs file before saving the next import.",409)
    for(const c of csv)db.prepare('UPDATE spotify_import_collections SET kind=? WHERE id=?').run(c.id===collectionId?'favorites':'playlist',c.id)
    job.hasLibrary=!!db.prepare("SELECT 1 FROM spotify_import_collections WHERE job_id=? AND kind='favorites'").get(id)
    job.hasPlaylists=!!db.prepare("SELECT 1 FROM spotify_import_collections WHERE job_id=? AND kind='playlist'").get(id)
    const message="CSV files were opened as playlists. Choose your liked songs file below; filenames are not used to identify likes."
    job.warnings=job.warnings.filter(w=>w!==message);if(!job.hasLibrary)job.warnings.unshift(message)
    save(job);return status(id)
  })
  const commit=db.transaction(id=>{
    const job=get(id);if(!['ready','paused','committed'].includes(job.state))throw new ApiError('IMPORT_BUSY',"Wait for matching to finish or pause it first.",409)
    let added=0,favorites=0;const playlists=[]
    for(const c of db.prepare('SELECT * FROM spotify_import_collections WHERE job_id=? ORDER BY rowid').all(id)){
      const origin='spotify-export:'+hash(job.label)+':'+hash(c.source_key)
      const selected=db.prepare("SELECT position,json FROM spotify_import_rows WHERE collection_id=? AND json_extract(json,'$.selected') IS NOT NULL ORDER BY position").all(c.id)
      const listId=c.kind==='playlist'?store.createList(c.name,origin):null
      if(listId)playlists.push({id:listId,name:c.name})
      const applied=new Map(db.prepare('SELECT source_key,entry_id FROM spotify_import_applied WHERE origin=?').all(origin).map(r=>[r.source_key,r.entry_id]))
      const nextEntries=new Array(selected.length);let nextEntry=null
      for(let i=selected.length-1;i>=0;i--){nextEntries[i]=nextEntry;const key=JSON.parse(selected[i].json).sourceKey;if(applied.has(key))nextEntry=applied.get(key)}
      for(let i=0;i<selected.length;i++){const r=selected[i],row=JSON.parse(r.json),p=validTrack(row.selected)
        if(c.kind==='favorites'){if(!store.upsert(p).favori){store.favorite(p,true);favorites++}db.prepare('INSERT OR IGNORE INTO spotify_import_applied VALUES(?,?,NULL)').run(origin,row.sourceKey);continue}
        if(applied.has(row.sourceKey))continue
        // Insert before the next already imported item so later reviewed matches preserve order.
        const before=nextEntries[i]?db.prepare('SELECT position FROM entries WHERE id=? AND playlist_id=?').get(nextEntries[i],listId)?.position??null:null
        const t=store.upsert(p),entry=randomUUID();let position
        if(before!==null){db.prepare('UPDATE entries SET position=position+1 WHERE playlist_id=? AND position>=?').run(listId,before);position=before}
        else position=db.prepare('SELECT COALESCE(MAX(position),-1)+1 AS n FROM entries WHERE playlist_id=?').get(listId).n
        db.prepare('INSERT INTO entries VALUES(?,?,?,?)').run(entry,listId,t.appId,position)
        db.prepare('INSERT INTO spotify_import_applied VALUES(?,?,?)').run(origin,row.sourceKey,entry);added++
      }
    }
    job.lastCommit={added,favorites,playlists,at:Date.now()};job.state='committed';save(job);return status(id)
  })
  function recover(){for(const r of db.prepare("SELECT id FROM spotify_import_jobs WHERE json_extract(json,'$.state')='matching' ORDER BY created LIMIT 1").all())void process(r.id)}
  return {start,status,rows,pause,resume,select,research,favoritesFile,commit,recover,list:()=>db.prepare('SELECT id FROM spotify_import_jobs ORDER BY created DESC LIMIT 20').all().map(r=>status(r.id)),stop:()=>{for(const c of controllers.values())c.abort()}}
}

export function installSpotifyImports(app,{store,search}){
  const imports=createSpotifyImports(store,search)
  let reading=false
  if(process.env.SKIP_LISTEN!=='1')imports.recover()
  app.get('/api/v1/import/spotify/jobs',c=>c.json({jobs:imports.list()}))
  app.post('/api/v1/import/spotify/upload',async c=>{
    if(!['application/zip','application/json','application/octet-stream','application/x-zip-compressed','text/csv'].includes((c.req.header('content-type')||'').split(';')[0]))throw invalid()
    if(reading)throw new ApiError('IMPORT_BUSY',"Another Spotify file is being read. Try again shortly.",429,true)
    reading=true
    try{const parsed=await readSpotifyExport(Buffer.from(await c.req.arrayBuffer()),{fileName:c.req.query('fileName')||'Spotify.json'})
      return c.json(imports.start(parsed,c.req.query('label')),202)
    }finally{reading=false}
  })
  app.get('/api/v1/import/spotify/jobs/:id',c=>c.json(imports.status(c.req.param('id'))))
  app.get('/api/v1/import/spotify/jobs/:id/rows',c=>c.json(imports.rows(c.req.param('id'),{collectionId:c.req.query('collectionId'),offset:c.req.query('offset')||0,filter:c.req.query('filter')||'all'})))
  app.post('/api/v1/import/spotify/jobs/:id/pause',c=>c.json(imports.pause(c.req.param('id'))))
  app.post('/api/v1/import/spotify/jobs/:id/resume',async c=>c.json(imports.resume(c.req.param('id'),(await c.req.json()).retry===true)))
  app.post('/api/v1/import/spotify/jobs/:id/rows/:rowId/search',async c=>c.json(await imports.research(c.req.param('id'),c.req.param('rowId'),(await c.req.json()).query,c.req.raw.signal)))
  app.patch('/api/v1/import/spotify/jobs/:id/rows/:rowId',async c=>c.json(imports.select(c.req.param('id'),c.req.param('rowId'),(await c.req.json()).candidate)))
  app.patch('/api/v1/import/spotify/jobs/:id/favorites-file',async c=>c.json(imports.favoritesFile(c.req.param('id'),(await c.req.json()).collectionId)))
  app.post('/api/v1/import/spotify/jobs/:id/commit',c=>c.json(imports.commit(c.req.param('id'))))
  return imports
}
