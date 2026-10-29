import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { normalize } from './store.js'
import { ApiError } from './telemetry.js'

const hash=value=>createHash('sha256').update(value).digest('hex').slice(0,32)
const invalid=()=>new ApiError('INVALID_SPOTIFY_HISTORY',"Choose a Spotify data ZIP: Extended streaming history, Account data or Technical log information.",400)

export function readSpotifyHistory(buffer){
  if(buffer.length>64*1024*1024)throw new ApiError('IMPORT_TOO_LARGE',"Files must be smaller than 64 MB.",413)
  return new Promise((resolve,reject)=>{
    const child=spawn('python3',['-I',new URL('./spotify-history-reader.py',import.meta.url).pathname],{stdio:['pipe','pipe','pipe']})
    let size=0,output=[],settled=false
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish(invalid())},60000)
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value)}
    child.on('error',()=>finish(invalid()));child.stdin.on('error',()=>{});child.stderr.resume()
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>96*1024*1024){child.kill('SIGKILL');finish(invalid())}else output.push(chunk)})
    child.on('close',code=>{if(code!==0)return finish(invalid());try{finish(null,JSON.parse(Buffer.concat(output).toString('utf8')))}catch{finish(invalid())}})
    child.stdin.end(buffer)
  })
}

// Listening history is a taste signal, never likes: it feeds artist affinity, early-skip penalties,
// daily mixes and On Repeat. Plays are stored per account and deduplicated, so re-importing is safe.
export function createSpotifyHistory(store){
  store.db.exec(`CREATE TABLE IF NOT EXISTS external_plays(id TEXT PRIMARY KEY,played_at INTEGER NOT NULL,ms INTEGER NOT NULL,uri TEXT,artist TEXT,artist_key TEXT,title TEXT,track_id TEXT,end_reason TEXT,skipped INTEGER NOT NULL DEFAULT 0,source TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS external_plays_artist ON external_plays(artist_key,played_at);
    CREATE INDEX IF NOT EXISTS external_plays_track ON external_plays(track_id);`)
  // Recordings already known from a Spotify library import: URI → metadata and the chosen match.
  function knownUris(){
    const known=new Map()
    try{for(const r of store.db.prepare("SELECT json FROM spotify_import_rows WHERE json LIKE '%spotify:track:%'").all()){const row=JSON.parse(r.json);if(row.spotifyUri)known.set(row.spotifyUri,row)}}catch{/* No library import yet. */}
    return known
  }
  function apply(parsed){
    const known=knownUris(),insert=store.db.prepare('INSERT OR IGNORE INTO external_plays VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    let added=0,matched=0,ms=0,first=Infinity,last=0;const unknown=new Set(),trackIds=new Map()
    const trackFor=row=>{
      if(!row?.selected)return null
      if(!trackIds.has(row.spotifyUri)){try{trackIds.set(row.spotifyUri,store.upsert(row.selected).appId)}catch{trackIds.set(row.spotifyUri,null)}}
      return trackIds.get(row.spotifyUri)
    }
    store.db.transaction(()=>{
      for(const p of parsed.plays||[]){
        const at=Date.parse(p.at);if(!Number.isFinite(at))continue
        const row=p.uri?known.get(p.uri):null,artist=p.artist||row?.sanatci||'',title=p.title||row?.baslik||''
        if(!artist&&p.uri)unknown.add(p.uri)
        const source=(parsed.kinds||[]).includes('extended')?'extended':(parsed.kinds||[]).includes('account')?'account':'technical'
        const id=hash((p.uri||normalize(artist)+'|'+normalize(title))+'@'+Math.round(at/1000))
        const result=insert.run(id,at,Math.min(p.ms||0,24*3600000),p.uri||null,artist||null,normalize(artist)||null,title||null,trackFor(row),p.end||null,p.skipped?1:0,source)
        if(result.changes){added++;ms+=p.ms||0;first=Math.min(first,at);last=Math.max(last,at);if(artist)matched++}
      }
    })()
    const onRepeat=(parsed.onRepeat||[]).map(uri=>known.get(uri)).filter(Boolean).map(row=>trackFor(row)).filter(Boolean)
    if(onRepeat.length)store.setting('spotifyOnRepeat',[...new Set(onRepeat)])
    const terms=Object.entries(parsed.terms||{}).sort((a,b)=>b[1]-a[1]).slice(0,40)
    if(terms.length)store.setting('spotifyTaste',Object.fromEntries(terms))
    store.setting('dailyMixes',null) // Rebuild today's mixes with the new signal.
    const total=store.db.prepare('SELECT COUNT(*) n,SUM(ms) ms,SUM(artist IS NOT NULL) named,MIN(played_at) first,MAX(played_at) last FROM external_plays').get()
    return {added,addedHours:Math.round(ms/360000)/10,identified:matched,unidentifiedTracks:unknown.size,onRepeat:onRepeat.length,terms:terms.length,
      total:{plays:total.n,hours:Math.round((total.ms||0)/360000)/10,identified:total.named||0,first:total.first,last:total.last},
      // Technical logs carry IDs only; names arrive with Account data or Extended streaming history.
      needsNames:unknown.size>0}
  }
  function summary(){
    const t=store.db.prepare('SELECT COUNT(*) n,SUM(ms) ms,SUM(artist IS NOT NULL) named,MIN(played_at) first,MAX(played_at) last FROM external_plays').get()
    const top=store.db.prepare("SELECT artist,SUM(ms) ms,COUNT(*) n FROM external_plays WHERE artist IS NOT NULL GROUP BY artist_key ORDER BY ms DESC LIMIT 10").all()
    return {plays:t.n,hours:Math.round((t.ms||0)/360000)/10,identified:t.named||0,first:t.first,last:t.last,topArtists:top.map(r=>({artist:r.artist,hours:Math.round(r.ms/360000)/10,plays:r.n}))}
  }
  return {apply,summary}
}

/** Artist listening (ms) and repeated early skips from imported history, in the same shape as local signals. */
export function externalSignals(store,{now=Date.now()}={}){
  const has=store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='external_plays'").get()
  if(!has)return {listening:new Map(),skippedArtists:new Map()}
  // Older listening counts less: full weight for the last 90 days, half up to a year.
  const listening=new Map(store.db.prepare(`SELECT artist_key a,SUM(ms*CASE WHEN played_at>? THEN 1.0 ELSE 0.5 END) ms FROM external_plays WHERE artist_key IS NOT NULL AND played_at>? GROUP BY artist_key`).all(now-90*86400000,now-365*86400000).map(r=>[r.a,Number(r.ms)||0]))
  const skippedArtists=new Map(store.db.prepare(`SELECT artist_key a,COUNT(DISTINCT COALESCE(uri,title)) n FROM external_plays WHERE artist_key IS NOT NULL AND skipped=1 AND ms>=1000 AND ms<30000 AND played_at>? GROUP BY artist_key HAVING n>=3`).all(now-180*86400000).map(r=>[r.a,r.n]))
  // An artist you also finish often is not a skip pattern.
  for(const [a] of skippedArtists){const done=store.db.prepare("SELECT COUNT(*) n FROM external_plays WHERE artist_key=? AND skipped=0 AND ms>=60000").get(a).n;if(done>=3)skippedArtists.delete(a)}
  return {listening,skippedArtists}
}
