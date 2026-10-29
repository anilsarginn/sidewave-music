import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, unlink, rename, stat, statfs, open } from 'node:fs/promises'
import { join } from 'node:path'
import { createReadStream } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ApiError, count } from './telemetry.js'
import { parseRange } from './stream.js'

const GiB=1024**3, MiB=1024**2
const run=promisify(execFile)
async function probe(path,expected){
  const {stdout}=await run('ffprobe',['-v','error','-show_entries','format=duration,format_name:stream=codec_type,codec_name,duration','-of','json',path],{timeout:15000,maxBuffer:65536})
  const data=JSON.parse(stdout),audio=data.streams?.find(s=>s.codec_type==='audio')
  const duration=Number(data.format?.duration||audio?.duration)
  if(!audio||!Number.isFinite(duration)||duration<=0||(Number(expected)>0&&Math.abs(duration-Number(expected))>Math.max(3,Number(expected)*.01)))throw new ApiError('CACHE_INVALID_AUDIO',"The audio file could not be verified.",502)
  // Decode the complete file. A valid header alone does not prove completion.
  await run('ffmpeg',['-v','error','-xerror','-i',path,'-map','0:a:0','-f','null','-'],{timeout:120000,maxBuffer:65536})
  return {duration,format:data.format.format_name,codec:audio.codec_name}
}

function readContentRange(response){
  const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range')||'')
  if(!match)throw new ApiError('CACHE_INVALID_RANGE',"The source returned an invalid audio range.",502)
  const [start,end,total]=match.slice(1).map(Number)
  if(![start,end,total].every(Number.isSafeInteger)||start>end||end>=total)throw new ApiError('CACHE_INVALID_RANGE',"The source returned an invalid audio range.",502)
  return {start,end,total}
}
async function* sourceBytes(initial,source,signal,fetcher){
  if(initial.status===200){yield* initial.body;return}
  let response=initial,offset=0
  const total=readContentRange(initial).total,mime=initial.headers.get('content-type'),etag=initial.headers.get('etag')
  try{while(offset<total){
    const range=readContentRange(response)
    if(response.status!==206||range.start!==offset||range.total!==total||range.end>Math.min(total-1,offset+MiB-1)||response.headers.get('content-type')!==mime||(etag&&response.headers.get('etag')!==etag))throw new ApiError('CACHE_REPRESENTATION_CHANGED',"The source’s audio format changed.",502)
    let received=0
    for await(const chunk of response.body){received+=chunk.length;if(received>range.end-range.start+1)throw new ApiError('CACHE_INVALID_RANGE',"The source’s audio range does not match.",502);yield chunk}
    if(received!==range.end-range.start+1)throw new ApiError('CACHE_INCOMPLETE',"The audio file is incomplete.",502)
    offset=range.end+1
    if(offset<total)response=await fetcher(source.url,{headers:{...source.headers,Range:`bytes=${offset}-${Math.min(total-1,offset+MiB-1)}`,...(etag?{'If-Range':etag}:{})},signal})
  }}finally{await response.body?.cancel().catch(()=>{})}
}

export function createAudioCache({store,root,resolveSource,fetcher=fetch,verify=probe,freeBytes=async()=>{const s=await statfs(root);return s.bavail*s.bsize},reserveBytes=10*GiB,maxEntryBytes=256*MiB,now=Date.now}){
  const db=store.db,jobs=new Map(),pins=new Map(),leases=new Map(),tasks=new Set();let stopped=false,maintenance=Promise.resolve()
  db.exec(`CREATE TABLE IF NOT EXISTS audio_cache(key TEXT PRIMARY KEY,track_id TEXT NOT NULL,size INTEGER NOT NULL,mime TEXT NOT NULL,duration REAL NOT NULL,format TEXT NOT NULL,last_used INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS preparations(id TEXT PRIMARY KEY,cache_key TEXT NOT NULL,state TEXT NOT NULL,priority TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL,code TEXT);
    CREATE INDEX IF NOT EXISTS preparations_key ON preparations(cache_key);
    INSERT OR IGNORE INTO migrations VALUES(8,datetime('now'));`)
  db.prepare("UPDATE preparations SET state='interrupted',code='SERVER_RESTARTED' WHERE state IN ('accepted','warming')").run()
  if(!db.prepare('PRAGMA table_info(audio_cache)').all().some(c=>c.name==='digest'))db.exec('ALTER TABLE audio_cache ADD COLUMN digest TEXT');
  db.prepare("INSERT OR IGNORE INTO migrations VALUES(10,datetime('now'))").run()
  const keyFor=p=>createHash('sha256').update(p.kaynak+':'+p.id).digest('hex')
  const filename=key=>join(root,key+'.audio')
  const config=()=>({enabled:true,capacityBytes:10*GiB,maxAgeDays:30,...store.setting('audioCacheConfig')})
  const ready=(async()=>{
    await mkdir(root,{recursive:true,mode:0o700})
    const indexed=new Set(db.prepare('SELECT key FROM audio_cache').all().map(r=>r.key+'.audio'))
    for(const name of await readdir(root))if(/^[a-f0-9-]+\.(part|audio)$/.test(name)&&(!indexed.has(name)||name.endsWith('.part')))await unlink(join(root,name)).catch(()=>{})
    for(const r of db.prepare('SELECT key,size FROM audio_cache').all())if((await stat(filename(r.key)).catch(()=>null))?.size!==r.size)db.prepare('DELETE FROM audio_cache WHERE key=?').run(r.key)
    for(const r of db.prepare('SELECT key FROM audio_cache WHERE digest IS NULL').all()){const hash=createHash('sha256');for await(const chunk of createReadStream(filename(r.key)))hash.update(chunk);db.prepare('UPDATE audio_cache SET digest=? WHERE key=?').run(hash.digest('hex'),r.key)}
    await prune()
  })()
  ready.catch(()=>{}) // Cache storage failure must not become an unhandled rejection.
  const setState=(key,state,code=null)=>db.prepare("UPDATE preparations SET state=?,code=?,updated=? WHERE cache_key=? AND state IN ('accepted','warming')").run(state,code,now(),key)
  function status(id){const r=db.prepare('SELECT * FROM preparations WHERE id=?').get(id);if(r?.state==='ready'&&!db.prepare('SELECT 1 FROM audio_cache WHERE key=?').get(r.cache_key))r.state='expired';if(!r)throw new ApiError('PREPARATION_NOT_FOUND',"Preparation not found.",404);return {id:r.id,state:r.state,priority:r.priority,updatedAt:r.updated,code:r.code,delivery:r.state==='ready'?'temporary_cache':undefined}}
  async function cached(p){await ready;if(!config().enabled)return null;const key=keyFor(p),r=db.prepare('SELECT * FROM audio_cache WHERE key=?').get(key);if(!r)return null
    if((await stat(filename(key)).catch(()=>null))?.size!==r.size){db.prepare('DELETE FROM audio_cache WHERE key=?').run(key);return null}
    db.prepare('UPDATE audio_cache SET last_used=? WHERE key=?').run(now(),key);return r
  }
  function lease(track,requestId,duration=track.sure){
    if(!requestId)return
    const key=keyFor(track),expires=now()+Math.min(12*3600000,Math.max(120000,(Number(duration)||0)*1000+120000))
    leases.set(requestId,{key,expires})
  }
  function release(requestId){leases.delete(requestId)}
  function leased(key){for(const [id,value]of leases){if(value.expires<=now())leases.delete(id);else if(value.key===key)return true}return false}
  async function prune(clear=false,needed=0){
    const rows=db.prepare('SELECT * FROM audio_cache ORDER BY last_used ASC').all(),cfg=config();let used=rows.reduce((a,r)=>a+r.size,0),removed=0
    for(const r of rows){if(pins.has(r.key)||jobs.has(r.key)||leased(r.key))continue
      if(clear||r.last_used<now()-cfg.maxAgeDays*86400000||used+needed>cfg.capacityBytes){await unlink(filename(r.key)).catch(e=>{if(e.code!=='ENOENT')throw e});db.prepare('DELETE FROM audio_cache WHERE key=?').run(r.key);used-=r.size;removed++}}
    return {removed,usedBytes:used}
  }
  function clean(clear=false,needed=0){const result=maintenance.then(()=>prune(clear,needed));maintenance=result.catch(()=>{});return result}
  function pump(){if(stopped)return;const running=[...jobs.values()].filter(j=>j.running);let active=running.length,speculative=running.filter(j=>j.priority==='next').length
    for(const j of [...jobs.values()].filter(j=>!j.running).sort((a,b)=>(a.priority==='next')-(b.priority==='next'))){if(active>=2)break;if(j.priority==='next'&&speculative>=1)continue;j.running=true;active++;if(j.priority==='next')speculative++
      const task=fill(j).catch(e=>{setState(j.key,'failed',e.code==='ENOSPC'?'CACHE_DISK_FULL':/^(CACHE_|SOURCE_|RESOLVE_|RATE_)/.test(e.code||'')?e.code:'CACHE_SOURCE_FAILED');count('sidewave_cache_fill_total',j.priority,'failed')}).finally(()=>{jobs.delete(j.key);tasks.delete(task);pump()});tasks.add(task)}}
  async function fill(j){
    await ready
    const cfg=config();if(!cfg.enabled)throw new ApiError('CACHE_DISABLED',"Audio caching is disabled.",409)
    // Reserve the maximum entry size for each in-flight fill before accepting bytes.
    if(await freeBytes()<reserveBytes+maxEntryBytes*2)throw new ApiError('CACHE_DISK_RESERVE',"Keeping enough free disk space.",507)
    await clean(false,maxEntryBytes*2)
    if(stats().usedBytes+maxEntryBytes*2>cfg.capacityBytes)throw new ApiError('CACHE_CAPACITY',"There is not enough cache space.",507)
    setState(j.key,'warming')
    const signal=AbortSignal.any([j.controller.signal,AbortSignal.timeout(180000)])
    let response,source
    for(let retry=0;retry<2;retry++){
      source=await resolveSource(j.track,retry>0,signal)
      response=await fetcher(source.url,{headers:{...source.headers,Range:`bytes=0-${MiB-1}`},signal})
      if(retry===0&&[403,410,429,500,502,503,504].includes(response.status)){await response.body?.cancel();continue}break
    }
    const mime=response.headers.get('content-type')?.split(';')[0]||''
    if(![200,206].includes(response.status)||!response.body||! /^(audio\/|video\/(webm|mp4)|application\/octet-stream)/.test(mime)){await response.body?.cancel();throw new ApiError('CACHE_INVALID_RESPONSE',"The source returned no audio.",502)}
    const firstRange=response.status===206?readContentRange(response):null
    const expected=firstRange?.total||Number(response.headers.get('content-length'))||0
    if(expected>maxEntryBytes){await response.body.cancel();throw new ApiError('CACHE_ENTRY_LIMIT',"This track exceeds the cache limit.",413)}
    const partial=join(root,j.key+'.part'),file=await open(partial,'wx',0o600);let size=0,lastCheck=0;const hash=createHash('sha256')
    try{
      for await(const chunk of sourceBytes(response,source,signal,fetcher)){hash.update(chunk);size+=chunk.length;if(size>maxEntryBytes)throw new ApiError('CACHE_ENTRY_LIMIT',"This track exceeds the cache limit.",413)
        if(size-lastCheck>MiB){lastCheck=size;if(await freeBytes()<reserveBytes)throw new ApiError('CACHE_DISK_RESERVE',"Keeping enough free disk space.",507)}
        let offset=0;while(offset<chunk.length){const w=await file.write(chunk,offset,chunk.length-offset);if(!w.bytesWritten)throw new Error('Empty write');offset+=w.bytesWritten}}
      await file.sync();await file.close()
      if(!size||(expected&&size!==expected))throw new ApiError('CACHE_INCOMPLETE',"The audio file is incomplete.",502)
      const meta=await verify(partial,j.track.sure)
      if(signal.aborted||stopped||!config().enabled)throw new ApiError('CACHE_CANCELLED',"Preparation cancelled.",499)
      await rename(partial,filename(j.key))
      db.prepare('INSERT OR REPLACE INTO audio_cache VALUES(?,?,?,?,?,?,?,?)').run(j.key,j.track.appId||j.track.id,size,mime,meta.duration,meta.format,now(),hash.digest('hex'))
      setState(j.key,'ready');count('sidewave_cache_fill_total',j.priority,'ready')
    }finally{await file.close().catch(()=>{});await unlink(partial).catch(()=>{})}
  }
  async function prepare(track,priority='next'){
    await ready;const key=keyFor(track),hit=await cached(track),id=randomUUID(),state=hit?'ready':config().enabled?'accepted':'disabled'
    db.prepare('INSERT INTO preparations VALUES(?,?,?,?,?,?,?)').run(id,key,state,priority==='playback'?'playback':'next',now(),now(),null)
    if(state==='accepted'){
      let j=jobs.get(key)
      if(!j){if(jobs.size>=32){setState(key,'failed','CACHE_QUEUE_FULL');return status(id)}j={key,track,priority:priority==='playback'?'playback':'next',controller:new AbortController(),running:false};jobs.set(key,j)}
      else {if(priority==='playback')j.priority='playback';if(j.running)db.prepare("UPDATE preparations SET state='warming' WHERE id=?").run(id)}
      pump()
    }
    // Bound historical subscription storage. Shared jobs are never owned by a subscriber.
    db.prepare("DELETE FROM preparations WHERE updated<? AND state NOT IN ('accepted','warming')").run(now()-86400000)
    return status(id)
  }
  function cancel(id){status(id);const key=db.prepare('SELECT cache_key FROM preparations WHERE id=?').get(id).cache_key;db.prepare("UPDATE preparations SET state='cancelled',updated=? WHERE id=?").run(now(),id)
    const job=jobs.get(key),needed=db.prepare("SELECT 1 FROM preparations WHERE cache_key=? AND state IN ('accepted','warming') LIMIT 1").get(key)
    if(job?.priority==='next'&&!needed){job.controller.abort();if(!job.running){jobs.delete(key);pump()}}
    return status(id)}
  function stats(){const r=db.prepare('SELECT COUNT(*) AS entries,COALESCE(SUM(size),0) AS usedBytes FROM audio_cache').get();return {...config(),...r,activeFills:[...jobs.values()].filter(j=>j.running).length,queued:jobs.size,pinned:pins.size,maxEntryBytes,reserveBytes}}
  async function configure(value){const previous=config(),next={...previous};if('enabled'in value){if(typeof value.enabled!=='boolean')throw new ApiError('INVALID_CACHE_CONFIG',"Invalid cache setting.",400);next.enabled=value.enabled}
    if('capacityBytes'in value){if(!Number.isSafeInteger(value.capacityBytes)||value.capacityBytes<512*MiB||value.capacityBytes>1024*GiB)throw new ApiError('INVALID_CACHE_CONFIG',"Capacity must be between 512 MiB and 1 TiB.",400);next.capacityBytes=value.capacityBytes}
    store.setting('audioCacheConfig',next);if(!next.enabled)for(const j of jobs.values())j.controller.abort();await clean();return stats()}
  async function serve(c,track){
    const r=await cached(track);if(!r)return null
    if(c.req.query('cacheVersion')&&c.req.query('cacheVersion')!==r.digest)throw new ApiError('CACHE_EXPIRED',"The audio copy changed. You can play it again.",410,true)
    lease(track,c.req.query('requestId'),r.duration)
    pins.set(r.key,(pins.get(r.key)||0)+1);let released=false
    const release=()=>{if(released)return;released=true;const n=(pins.get(r.key)||1)-1;if(n)pins.set(r.key,n);else pins.delete(r.key)}
    let range;const headers={'Content-Type':r.mime,'Accept-Ranges':'bytes','Cache-Control':'private, no-store','X-Sidewave-Delivery':'temporary_cache'}
    try{range=parseRange(c.req.header('range'),r.size)}catch(e){release();if(e.status===416)return new Response(null,{status:416,headers:{...headers,'Content-Range':`bytes */${r.size}`}});throw e}
    const start=range?.start||0,end=range?.end??r.size-1
    headers['Content-Length']=String(end-start+1);if(range)headers['Content-Range']=`bytes ${start}-${end}/${r.size}`
    let input;try{const handle=await open(filename(r.key),'r');input=handle.createReadStream({start,end})}catch{release();db.prepare('DELETE FROM audio_cache WHERE key=?').run(r.key);return null}
    const abort=()=>input.destroy();c.req.raw.signal.addEventListener('abort',abort,{once:true});if(c.req.raw.signal.aborted)abort()
    const finish=()=>{c.req.raw.signal.removeEventListener('abort',abort);release()};input.once('close',finish);input.once('error',finish)
    const iterator=input[Symbol.asyncIterator](),body=new ReadableStream({async pull(controller){try{const v=await iterator.next();if(v.done){finish();controller.close()}else controller.enqueue(new Uint8Array(v.value))}catch(e){finish();controller.error(e)}},cancel(){input.destroy();finish()}})
    count('sidewave_cache_read_total','temporary_cache','hit');return new Response(body,{status:range?206:200,headers})
  }
  const interval=setInterval(()=>{ready.then(()=>clean()).catch(()=>{})},3600000);interval.unref()
  return {ready,cached,prepare,status,cancel,stats,configure,serve,lease,release,clear:async()=>{await ready;return clean(true)},stop:async()=>{stopped=true;clearInterval(interval);for(const j of jobs.values())j.controller.abort();await ready;await Promise.allSettled([...tasks])}}
}
