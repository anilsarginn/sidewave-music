// Time-synced lyrics from LRCLIB (free, community maintained), with the library's own lyrics as a
// fallback. Results, including "not found", are cached so each recording is looked up once a month.
const LRCLIB='https://lrclib.net/api'
const NOISE=/\s*[([][^)\]]*\b(official|video|audio|lyrics?|lyric video|visuali[sz]er|remaster(ed)?|hd|hq|4k|clip|mv|m\/v|explicit)\b[^)\]]*[)\]]/gi

export function cleanTitle(title){return String(title||'').replace(NOISE,'').replace(/\s+-\s+topic$/i,'').replace(/\s{2,}/g,' ').trim()}
export function primaryArtist(artist){return String(artist||'').split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bx\b|\bve\b|\bwith\b)\s*/i)[0].trim()}

export function parseLrc(text){
  const lines=[]
  for(const raw of String(text||'').split(/\r?\n/)){
    const stamps=[...raw.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)]
    if(!stamps.length)continue
    const words=raw.replace(/\[[^\]]*\]/g,'').trim()
    for(const m of stamps)lines.push({t:Number(m[1])*60+Number(m[2])+(m[3]?Number(m[3].padEnd(3,'0'))/1000:0),text:words})
  }
  return lines.sort((a,b)=>a.t-b.t)
}

export function createLyrics({db,fetch=globalThis.fetch,now=Date.now,libraryLyrics=async()=>null}){
  db.exec('CREATE TABLE IF NOT EXISTS lyrics(key TEXT PRIMARY KEY,json TEXT NOT NULL,fetched INTEGER NOT NULL)')
  const request=async(path,signal)=>{
    const r=await fetch(LRCLIB+path,{headers:{'User-Agent':'Sidewave/0.1 (self-hosted music client)'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(6000)]):AbortSignal.timeout(6000)})
    if(r.status===404)return null
    if(!r.ok)throw new Error('LRCLIB '+r.status)
    return r.json()
  }
  async function lookup(track,signal){
    const title=cleanTitle(track.baslik),artist=primaryArtist(track.sanatci)
    if(!title||!artist)return null
    const params=new URLSearchParams({track_name:title,artist_name:artist})
    if(track.album)params.set('album_name',track.album)
    if(Number.isFinite(track.sure)&&track.sure>0)params.set('duration',String(Math.round(track.sure)))
    let hit=await request('/get?'+params,signal)
    if(!hit){
      // The exact endpoint needs matching album and duration; search tolerates differences.
      const found=await request('/search?'+new URLSearchParams({track_name:title,artist_name:artist}),signal)
      const close=(Array.isArray(found)?found:[]).filter(x=>!Number.isFinite(track.sure)||!x.duration||Math.abs(x.duration-track.sure)<=4)
      hit=close.find(x=>x.syncedLyrics)||close.find(x=>x.plainLyrics)||null
    }
    if(!hit||hit.instrumental)return hit?.instrumental?{instrumental:true}:null
    return {synced:hit.syncedLyrics?parseLrc(hit.syncedLyrics):null,plain:hit.plainLyrics||null}
  }
  async function get(track,signal){
    const key=(track.kaynak||'')+':'+(track.id||'')
    const row=db.prepare('SELECT json,fetched FROM lyrics WHERE key=?').get(key)
    if(row&&now()-row.fetched<30*86400000)return JSON.parse(row.json)
    let result=null
    // A network failure is not "no lyrics": serve the old copy or an uncached empty answer.
    try{result=await lookup(track,signal)}catch{if(row)return JSON.parse(row.json);const own=await libraryLyrics(track,signal).catch(()=>null);return {synced:null,plain:own||null,instrumental:false,source:own?'library':null}}
    if(!result?.synced?.length&&!result?.plain&&!result?.instrumental){const own=await libraryLyrics(track,signal).catch(()=>null);if(own)result={synced:null,plain:own,source:'library'}}
    const value={synced:result?.synced?.length?result.synced:null,plain:result?.plain||null,instrumental:!!result?.instrumental,source:result?.source||(result?'lrclib':null)}
    db.prepare('INSERT OR REPLACE INTO lyrics VALUES(?,?,?)').run(key,JSON.stringify(value),now())
    return value
  }
  return {get}
}
