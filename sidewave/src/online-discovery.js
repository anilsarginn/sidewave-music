import {randomUUID} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {ApiError} from './telemetry.js'
import {normalize, validTrack} from './store.js'
const exec=promisify(execFile)

export function cosine(a,b){
 if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length||a.length===0||![...a,...b].every(Number.isFinite))return null
 const aa=Math.hypot(...a),bb=Math.hypot(...b);if(!aa||!bb)return null
 return Math.max(0,Math.min(1,a.reduce((n,x,i)=>n+x*b[i],0)/(aa*bb)))
}
export function createExcerptAnalyzer({url,resolveSource}){
 return async(track,signal,attempt=0)=>{
  const source=await resolveSource(track,signal,attempt>0)
  const u=new URL(source.url);if(u.protocol!=='https:')throw Error('invalid source')
  // Only trusted resolver headers; never log command arguments or persist URLs.
  const headers=Object.entries(source.headers||{}).filter(([k,v])=>/^[a-zA-Z0-9-]+$/.test(k)&&typeof v==='string'&&!/[\r\n]/.test(v)).map(([k,v])=>`${k}: ${v}\r\n`).join('')
  const offset=Number(track.sure)>75?30:0
  const args=['-nostdin','-v','error','-threads','1','-rw_timeout','10000000',...(headers?['-headers',headers]:[]),'-ss',String(offset),'-i',source.url,'-t','45','-vn','-ac','1','-ar','16000','-f','s16le','pipe:1']
  let pcm
  try{pcm=(await exec('ffmpeg',args,{encoding:'buffer',timeout:45000,maxBuffer:16000*2*47,signal})).stdout}
  catch {throw new ApiError('EXCERPT_UNAVAILABLE',"An audio sample could not be retrieved.",502,true)}
  if(pcm.length<16000*2*9)throw Error('short audio')
  const r=await fetch(url+'/embedding',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:pcm,signal})
  if(!r.ok)throw new ApiError('EXCERPT_ANALYSIS_FAILED',"The audio sample could not be analyzed.",502,r.status>=500)
  const data=await r.json()
  if(!data.model?.startsWith('musicnn-excerpt-v1:')||!Array.isArray(data.vector)||data.vector.length!==200||!data.vector.every(Number.isFinite))throw Error('invalid embedding')
  return {...data,offset}
 }
}

export function createOnlineDiscovery({store,related,analyze,canAnalyze=()=>true,now=Date.now}){
 const db=store.db
 db.exec(`CREATE TABLE IF NOT EXISTS discovery_sessions(id TEXT PRIMARY KEY,seed_id TEXT NOT NULL,json TEXT NOT NULL,updated INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS discovery_seed ON discovery_sessions(seed_id,updated);
 CREATE TABLE IF NOT EXISTS discovery_vectors(source_key TEXT PRIMARY KEY,track_id TEXT NOT NULL,json TEXT NOT NULL,updated INTEGER NOT NULL);
 INSERT OR IGNORE INTO migrations VALUES(11,datetime('now'));`)
 let busy=false,stopped=false,timer=null,controller=null
 const inflight=new Map(),sourceKey=p=>p.kaynak+':'+p.id
 const read=id=>{const row=db.prepare('SELECT json FROM discovery_sessions WHERE id=?').get(id);return row?JSON.parse(row.json):null}
 const save=s=>{s.updated=now();db.prepare('INSERT INTO discovery_sessions VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json,updated=excluded.updated').run(s.id,s.seed.appId,JSON.stringify(s),s.updated)}
 const vector=p=>{const row=db.prepare('SELECT json FROM discovery_vectors WHERE source_key=?').get(sourceKey(p));return row?JSON.parse(row.json):null}
 const hidden=()=>new Set([...store.history(20).map(p=>p.appId),...db.prepare('SELECT track_id FROM favorites UNION SELECT track_id FROM entries').all().map(r=>r.track_id)])
 function eligible(seed,candidates){
  const excluded=hidden(),seen=new Set([seed.appId]),artists=new Map()
  return candidates.filter(p=>{
   if(seen.has(p.appId)||excluded.has(p.appId)||store.isDismissed(p.appId))return false
   const artist=normalize(p.sanatci),uses=artists.get(artist)||0
   if(uses>=2)return false
   seen.add(p.appId);artists.set(artist,uses+1);return true
  }).slice(0,24)
 }
 function result(id,{mix=false,count=20}={}){
  const s=read(id);if(!s)throw new ApiError('NOT_FOUND',"Discovery session not found.",404)
  const seedVector=vector(s.seed),candidates=new Map(s.candidates.map(p=>[p.appId,p]))
  // A bounded growing pool of analyzed recordings, distinct from the archive index.
  if(seedVector)for(const row of db.prepare('SELECT track_id FROM discovery_vectors ORDER BY updated DESC LIMIT 2000').all()){
   const p=store.getTrack(row.track_id);if(p)candidates.set(p.appId,p)
  }
  let matches=[...candidates.values()].map(p=>{
   const v=seedVector&&vector(p),score=v?.model===seedVector?.model?cosine(seedVector?.vector,v?.vector):null
   const reason=score===null?"From this recording’s catalog connections":"Audio samples compared with MusiCNN"
   return {parca:{...p,reason,reasonType:score===null?'catalog':'sonic_excerpt'},similarity:score,method:score===null?'catalog':'audio_excerpt'}
  }).sort((a,b)=>(b.similarity??-1)-(a.similarity??-1))
  const selected=new Set(eligible(s.seed,matches.map(m=>m.parca)).slice(0,count).map(p=>p.appId))
  matches=matches.filter(m=>selected.has(m.parca.appId))
  const scored=matches.filter(m=>m.similarity!==null).length,pending=s.pending.length
  const state=pending?(canAnalyze()?'analyzing':'waiting'):s.failed.length?'partial':'ready'
  return {state:matches.length?'ready':'no_results',method:scored?'hybrid':'catalog',source:'youtube',scoreMeaning:scored?'excerpt_audio_similarity':null,seed:s.seed,
   message:matches.length?(scored?"Audio-similar matches appear first. Other tracks are catalog recommendations.":"New tracks found through catalog connections. Audio similarity has not been measured yet."):"No new tracks remain after excluding recent plays and your library.",
   analysis:{id:s.id,state:analyze?state:'unavailable',completed:s.completed,total:s.total,failed:s.failed.length,sampleSeconds:45,scope:'excerpt',message:!analyze?"Audio analysis is unavailable.":pending?"Comparing audio samples from up to 8 tracks in the background.":s.failed.length?"Some audio samples were unavailable. Those tracks are shown as catalog recommendations.":"Audio comparison complete."},
   matches,parcalar:mix?[s.seed,...matches.map(m=>m.parca)]:matches.map(m=>m.parca)}
 }
 async function start(raw,{signal,mix=false,count=20}={}){
  const input=validTrack(raw),stored=store.upsert(input),seed={...stored,...input,appId:stored.appId}
  if(seed.kaynak!=='youtube')throw new ApiError('ARCHIVE_REQUIRED',"No playable source was found for this recording.",409)
  const old=db.prepare('SELECT id FROM discovery_sessions WHERE seed_id=? AND updated>? ORDER BY updated DESC LIMIT 1').get(seed.appId,now()-86400000)
  if(old && read(old.id)?.candidates.length)return result(old.id,{mix,count})
  if(!inflight.has(seed.appId)){
   if(inflight.size>=4)throw new ApiError('DISCOVERY_BUSY',"Discovery is busy. Try again shortly.",503,true)
   const work=(async()=>{
    const response=await related(seed,AbortSignal.timeout(8000))
    const all=[]
    for(const p of (response.parcalar||[]).slice(0,50)){
     try{if(p.kaynak==='youtube'&&/^[\w-]{11}$/.test(p.id))all.push({...store.upsert(p),...validTrack(p)})}catch{}
    }
    const candidates=eligible(seed,all),batch=[seed,...candidates.slice(0,8)],pending=analyze?batch.filter(p=>!vector(p)):[]
    const queued=db.prepare('SELECT json FROM discovery_sessions').all().filter(r=>JSON.parse(r.json).pending.length>0).length
    if(pending.length&&queued>=6)throw new ApiError('DISCOVERY_BUSY',"The discovery queue is full. Try again shortly.",503,true)
    const s={id:randomUUID(),seed,candidates,pending,total:batch.length,completed:batch.length-pending.length,failed:[]}
    save(s)
    db.prepare('DELETE FROM discovery_sessions WHERE updated<?').run(now()-7*86400000)
    return s.id
   })().finally(()=>inflight.delete(seed.appId))
   inflight.set(seed.appId,work)
  }
  const id=await inflight.get(seed.appId);signal?.throwIfAborted();return result(id,{mix,count})
 }
 async function tick(){
  if(busy||stopped||!analyze||!canAnalyze())return
  const s=db.prepare('SELECT json FROM discovery_sessions ORDER BY updated').all().map(r=>JSON.parse(r.json)).find(s=>s.pending.length)
  if(!s)return
  busy=true;controller=new AbortController()
  const p=s.pending[0]
  try{
   if(!vector(p)){
    const data=await analyze(p,AbortSignal.any([controller.signal,AbortSignal.timeout(65000)]),s.attempts?.[sourceKey(p)]||0)
    if(cosine(data.vector,data.vector)===null)throw Error('invalid analysis')
    db.prepare('INSERT INTO discovery_vectors VALUES(?,?,?,?) ON CONFLICT(source_key) DO UPDATE SET json=excluded.json,updated=excluded.updated').run(sourceKey(p),p.appId,JSON.stringify(data),now())
    db.prepare('DELETE FROM discovery_vectors WHERE source_key IN (SELECT source_key FROM discovery_vectors ORDER BY updated DESC LIMIT -1 OFFSET 2000)').run()
   }
   s.completed++
  }catch(e){if(stopped)return;const key=sourceKey(p);s.attempts||={};s.attempts[key]=(s.attempts[key]||0)+1;if(s.attempts[key]<2 && e.retryable!==false)s.pending.push(p);else s.failed.push(key)}
  finally{if(!stopped){s.pending.shift();save(s)}busy=false;controller=null}
 }
 function retry(id){
  const s=read(id);if(!s)throw new ApiError('NOT_FOUND',"Discovery session not found.",404)
  if(s.pending.length)return result(id)
  if(s.lastRetry && now()-s.lastRetry<60000)throw new ApiError('RATE_LIMITED',"Wait one minute before trying again.",429,true)
  const failed=new Set(s.failed);s.pending=[s.seed,...s.candidates.slice(0,8)].filter(p=>failed.has(sourceKey(p)));s.failed=[];s.attempts={};s.lastRetry=now();save(s);return result(id)
 }
 return {start,result,retry,tick,startWorker(){timer=setInterval(()=>void (store.forAccounts?store.forAccounts(tick):tick()),2000);timer.unref()},stop(){stopped=true;clearInterval(timer);controller?.abort()}}
}
