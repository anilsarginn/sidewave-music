import { normalize } from './store.js'
import { ApiError, log } from './telemetry.js'

// Curator-approved artist circles keep each station's musical identity intact.
// Candidate recordings always come from the live catalog, never invented IDs.
export const EDITORIAL_ARTISTS = {
 'jazz-after-hours':['Yussef Kamaal','Kokoroko','Esbjörn Svensson Trio','Takuya Kuroda','Hania Rani','Nala Sinephro','Svaneborg Kardyb','Sons of Kemet'],
 'funk-roots':['Delvon Lamarr Organ Trio','The Greyboy Allstars','The Fearless Flyers','Cookin’ on 3 Burners','Speedometer','The Haggis Horns','Ghost-Note','The Poets of Rhythm'],
 'electronic-horizons':['Apparat','Maribou State','Tourist','Weval','Jan Blomqvist','Ben Böhmer','Nils Frahm','Âme'],
 'slow-motion':['Tommy Guerrero','DJ Shadow','Little People','Kognitif','Tor','Blockhead','Quantic','Wax Tailor'],
 'guitar-universe':['Arch Echo','Scale the Summit','Covet','Angel Vivaldi','Aaron Marshall','Syncatto','Sungazer','Toska'],
 'soul-colors':['Cleo Sol','Lianne La Havas','Erykah Badu','Brittany Howard','Mayer Hawthorne','Thee Sacred Souls','Bobby Womack','Sharon Jones & The Dap-Kings'],
 'disco-orbit':['Dabeull','L’Éclair','Polo & Pan','Chromeo','Lindstrøm','Dimitri From Paris','Kraak & Smaak','Yuksek'],
 'psychedelic-roots':['Dina Ögon','Lalalar','Şatellites','Kit Sebastian','Balthvs','Hermanos Gutiérrez','Mdou Moctar','Dengue Fever'],
}
const REVISION=2,INITIAL_SIZE=80,WEEKLY_ADDITIONS=8,MAX_SIZE=200,HOUR=3600000
const nextMonday=now=>{const d=new Date(now+3*HOUR),day=d.getUTCDay()||7;d.setUTCDate(d.getUTCDate()+8-day);d.setUTCHours(0,0,0,0);return d.getTime()-3*HOUR}
const key=p=>artist(p)+'|'+normalize(p.baslik.replace(/\s*[\[(](?:\d{4} )?remaster(?:ed)?[^\])]*[\])]/gi,'').replace(/\s*[-–] (?:\d{4} )?remaster(?:ed)?.*$/i,''))
const artist=p=>normalize(p.sanatcilar?.[0]?.ad||p.sanatci)
const valid=p=>p&&/^[\w-]{11}$/.test(p.id)&&typeof p.baslik==='string'&&p.baslik.trim()&&p.sanatci&&p.sure>45&&p.sure<1800&&!/\b(karaoke|tribute|sped up|slowed|8d audio|full album|complete album|remix|live at|live from|live session)\b/i.test(p.baslik)

export function createEditorialService({baseStore,entries,ytres,now=Date.now}) {
 baseStore.db.exec('CREATE TABLE IF NOT EXISTS editorial_collections(id TEXT PRIMARY KEY,json TEXT NOT NULL,updated INTEGER NOT NULL)')
 const inflight=new Map(),controller=new AbortController()
 let timer,stopped=false,working=false
 const cached=id=>{const row=baseStore.db.prepare('SELECT json FROM editorial_collections WHERE id=?').get(id);return row?JSON.parse(row.json):null}
 const publicData=old=>{if(!old)return {};const {seen,seenIds,attemptAt,retryAt,...data}=old;return data}
 const meta=entry=>{const {seeds,...info}=entry,old=cached(entry.id);return {...info,owner:'Sidewave',editable:false,parcaSayisi:old?.parcalar.length??null,updatedAt:old?.updatedAt,refreshAt:old?.refreshAt,addedCount:old?.addedCount||0}}
 const due=old=>!old||(!old.retryAt||now()>=old.retryAt)&&(old.revision!==REVISION||now()>=old.refreshAt||old.parcalar.length<INITIAL_SIZE)
 function save(id,result){baseStore.db.prepare('INSERT OR REPLACE INTO editorial_collections VALUES(?,?,?)').run(id,JSON.stringify(result),now())}
 async function refresh(id) {
  const entry=entries.find(e=>e.id===id);if(!entry)throw new ApiError('NOT_FOUND',"Session not found.",404)
  if(inflight.has(id))return inflight.get(id)
  const work=(async()=>{
   const old=cached(id),prior=old?.parcalar||[],initial=old?.revision!==REVISION||prior.length<INITIAL_SIZE
   const target=initial?Math.max(0,INITIAL_SIZE-prior.length):WEEKLY_ADDITIONS
   const seen=new Set([...(old?.seen||[]),...prior.map(key)]),seenIds=new Set([...(old?.seenIds||[]),...prior.map(p=>p.id)])
   const additions=[],pools=new Map(),roster=[...new Set([...entry.seeds.map(s=>s[0]),...EDITORIAL_ARTISTS[id]||[]])]
   const allowed=new Set(roster.map(normalize)),jobs=[...roster]
   let successes=0
   await Promise.all(Array.from({length:2},async()=>{while(jobs.length&&!stopped){const name=jobs.shift();try{
    const response=await ytres('/ara?q='+encodeURIComponent(name)+'&limit=40',{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])})
    const candidates=response.sonuclar||response.parcalar||[];successes++
    pools.set(normalize(name),candidates.filter(p=>valid(p)&&allowed.has(artist(p))).map(p=>({...p,kaynak:'youtube'})))
   }catch{ /* Keep the last successful list and retry transient failures. */ }}}))
   if(stopped)return {...meta(entry),...publicData(old),parcalar:prior}
   // Round-robin approved artists: a list should not become one artist's album.
   const queues=roster.map(name=>[...(pools.get(normalize(name))||[])])
   const counts=new Map();if(initial)for(const p of prior)counts.set(artist(p),(counts.get(artist(p))||0)+1)
   for(let pass=0;pass<40&&additions.length<target;pass++)for(const queue of queues){
    const p=queue.shift();if(!p||seen.has(key(p))||seenIds.has(p.id))continue
    const a=artist(p),count=counts.get(a)||0;if(count>=(initial?5:2))continue
    seen.add(key(p));seenIds.add(p.id);counts.set(a,count+1);additions.push(p)
    if(additions.length>=target)break
   }
   if(!prior.length&&!additions.length)throw new ApiError('COLLECTION_UNAVAILABLE',"This session could not be loaded. Please try again.",503,true)
   const parcalar=(initial?[...prior,...additions]:[...additions,...prior]).slice(0,MAX_SIZE)
   const complete=additions.length>=target
   const updatedAt=additions.length?now():(old?.updatedAt||now())
   const result={parcalar,updatedAt,revision:REVISION,refreshAt:complete?nextMonday(now()):(old?.refreshAt||nextMonday(now())),partial:parcalar.length<INITIAL_SIZE,addedCount:additions.length,seen:[...seen],seenIds:[...seenIds],attemptAt:now(),retryAt:complete?0:now()+HOUR}
   // No duplicates masquerading as growth; a dry week retries in an hour.
   if(!complete&&parcalar.length>=INITIAL_SIZE)result.refreshAt=Math.min(result.refreshAt,now())
   save(id,result)
   log('editorial_refreshed',{id,count:parcalar.length,added:additions.length,catalogs:successes,complete})
   return {...meta(entry),...publicData(result)}
  })().catch(error=>{
   const old=cached(id);if(old?.parcalar.length){save(id,{...old,retryAt:now()+HOUR,attemptAt:now()});return {...meta(entry),...publicData(old)}}
   throw error
  }).finally(()=>inflight.delete(id))
  inflight.set(id,work);return work
 }
 async function tick(){
  if(working||stopped)return;working=true
  try{for(const entry of entries){const old=cached(entry.id);if(due(old)){await refresh(entry.id).catch(e=>log('editorial_refresh_failed',{id:entry.id,code:e.code||'CATALOG_UNAVAILABLE'}));}if(stopped)break}}
  finally{working=false}
 }
 async function editorial(id){
  const entry=entries.find(e=>e.id===id);if(!entry)throw new ApiError('NOT_FOUND',"Session not found.",404)
  const old=cached(id)
  if(old?.parcalar.length){return {...meta(entry),...publicData(old)}}
  return refresh(id)
 }
 function start(){if(timer)return;stopped=false;timer=setInterval(()=>void tick(),60000);timer.unref();void tick()}
 function stop(){stopped=true;clearInterval(timer);controller.abort()}
 return {editorial,meta,refresh,tick,start,stop}
}
