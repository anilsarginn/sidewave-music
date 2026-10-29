import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,writeFile,stat,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Hono} from 'hono'
import {createStore} from '../src/store.js'
import {createAudioCache} from '../src/audio-cache.js'
const track={id:'video',kaynak:'youtube',baslik:'Original',sanatci:'Artist',sure:3}
async function fixture(t,options={}){
 const root=await mkdtemp(join(tmpdir(),'sidewave-cache-')),store=createStore(join(root,'db.sqlite'));let requests=0
 const cache=createAudioCache({store,root:join(root,'audio'),resolveSource:async()=>({url:'https://test.invalid/audio'}),fetcher:async()=>{requests++;return new Response(Buffer.alloc(1024,7),{headers:{'content-type':'audio/webm','content-length':'1024'}})},verify:async()=>({duration:3,format:'webm'}),freeBytes:async()=>100*1024**3,...options})
 await cache.ready;t.after(async()=>{await cache.stop();store.close();await rm(root,{recursive:true,force:true})})
 return{root,store,cache,requests:()=>requests}
}
async function terminal(cache,id){for(let i=0;i<100;i++){const s=cache.status(id);if(!['accepted','warming'].includes(s.state))return s;await new Promise(r=>setTimeout(r,5))}throw Error('Preparation did not finish')}
test('deduplicates shared fill, cancelled subscriber does not stop other subscriber, completed bytes support ranges',async t=>{
 const f=await fixture(t),a=await f.cache.prepare(track),b=await f.cache.prepare(track,'playback');f.cache.cancel(a.id)
 assert.equal((await terminal(f.cache,b.id)).state,'ready');assert.equal(f.cache.status(a.id).state,'cancelled');assert.equal(f.requests(),1)
 const app=new Hono();app.get('/',c=>f.cache.serve(c,track))
 const full=await app.request('/');assert.equal(full.status,200);assert.equal((await full.arrayBuffer()).byteLength,1024)
 const part=await app.request('/',{headers:{Range:'bytes=10-19'}});assert.equal(part.status,206);assert.equal(part.headers.get('content-range'),'bytes 10-19/1024');assert.equal((await part.arrayBuffer()).byteLength,10)
 const bad=await app.request('/',{headers:{Range:'bytes=1024-'}});assert.equal(bad.status,416);assert.equal(bad.headers.get('content-range'),'bytes */1024')
 assert.equal(f.cache.stats().pinned,0)
})
test('disk reserve and invalid media never publish a ready entry',async t=>{
 const low=await fixture(t,{freeBytes:async()=>1});const a=await low.cache.prepare(track);assert.equal((await terminal(low.cache,a.id)).code,'CACHE_DISK_RESERVE');assert.equal(low.requests(),0)
 const corrupt=await fixture(t,{verify:async()=>{throw Error('Corrupt audio')}});const b=await corrupt.cache.prepare(track);assert.equal((await terminal(corrupt.cache,b.id)).state,'failed');assert.equal(corrupt.cache.stats().entries,0);assert.deepEqual(await readdir(join(corrupt.root,'audio')),[])
})
test('truncated content and oversized recordings fail without changing permanent library',async t=>{
 for(const response of [()=>new Response('short',{headers:{'content-type':'audio/webm','content-length':'999'}}),()=>new Response('html',{headers:{'content-type':'text/html'}})]){
  const f=await fixture(t,{fetcher:response});const a=await f.cache.prepare(track);assert.equal((await terminal(f.cache,a.id)).state,'failed');assert.equal(f.cache.stats().entries,0);assert.equal(f.store.jobs().length,0)
 }
})
test('clear protects an open reader and restart preserves complete audio while removing partial files',async t=>{
 const f=await fixture(t),p=await f.cache.prepare(track);await terminal(f.cache,p.id)
 const app=new Hono();app.get('/',c=>f.cache.serve(c,track));const response=await app.request('/')
 assert.equal((await f.cache.clear()).removed,0);await response.arrayBuffer();assert.equal(f.cache.stats().pinned,0)
 await f.cache.stop();await writeFile(join(f.root,'audio','abc.part'),'unfinished')
 const second=createAudioCache({store:f.store,root:join(f.root,'audio'),resolveSource:async()=>{throw Error('Should remain cached')}});await second.ready
 assert.equal((await second.cached(track)).size,1024);assert.equal((await readdir(join(f.root,'audio'))).some(n=>n.endsWith('.part')),false)
 assert.equal((await second.clear()).removed,1);await second.stop()
})
test('one expired source refresh, cache disabling, and failed source produce bounded terminal states',async t=>{
 let calls=0;const f=await fixture(t,{fetcher:async()=>++calls===1?new Response(null,{status:403}):new Response('audio',{headers:{'content-type':'audio/webm'}})})
 const p=await f.cache.prepare(track);assert.equal((await terminal(f.cache,p.id)).state,'ready');assert.equal(calls,2)
 await f.cache.configure({enabled:false});assert.equal(await f.cache.cached(track),null);assert.equal((await f.cache.prepare(track)).state,'disabled')
})

test('fill concurrency reserves a playback slot and cancellation removes an unshared next job',async t=>{
 let active=0,max=0;const releases=[]
 const f=await fixture(t,{fetcher:async()=>{active++;max=Math.max(max,active);await new Promise(r=>releases.push(r));active--;return new Response('audio',{headers:{'content-type':'audio/webm'}})}})
 const first=await f.cache.prepare({...track,id:'next-a'}),queued=await f.cache.prepare({...track,id:'next-b'}),play=await f.cache.prepare({...track,id:'playing'},'playback')
 for(let i=0;i<50&&releases.length<2;i++)await new Promise(r=>setTimeout(r,5))
 assert.equal(releases.length,2);assert.equal(f.cache.status(queued.id).state,'accepted');assert.equal(f.cache.stats().activeFills,2)
 f.cache.cancel(queued.id);assert.equal(f.cache.status(queued.id).state,'cancelled');releases.splice(0).forEach(r=>r())
 assert.equal((await terminal(f.cache,first.id)).state,'ready');assert.equal((await terminal(f.cache,play.id)).state,'ready');assert.equal(max,2)
})
test('unused TTL entries are evicted, recently used entries survive maintenance',async t=>{
 let clock=Date.now();const f=await fixture(t,{now:()=>clock});const a=await f.cache.prepare(track);await terminal(f.cache,a.id)
 clock+=29*86400000;await f.cache.cached(track);clock+=2*86400000;await f.cache.configure({enabled:true});assert.equal(f.cache.stats().entries,1)
 clock+=31*86400000;await f.cache.configure({enabled:true});assert.equal(f.cache.stats().entries,0)
})

test('bounded source ranges build one complete representation and reject changed or truncated ranges',async t=>{
 for(const mode of ['valid','changed','truncated','ignored']){
  const total=1024*1024+10;let calls=0
  const f=await fixture(t,{fetcher:async(_url,{headers})=>{
   calls++;const start=calls===1?0:1024*1024,end=calls===1?1024*1024-1:total-1
   assert.equal(headers.Range,`bytes=${start}-${calls===1?end:total-1}`)
   if(calls===2&&mode==='ignored')return new Response(Buffer.alloc(total),{headers:{'content-type':'audio/webm'}})
   return new Response(Buffer.alloc(end-start+1-(calls===2&&mode==='truncated'?1:0)),{status:206,headers:{'content-type':'audio/webm','content-range':`bytes ${start}-${end}/${total}`,etag:calls===2&&mode==='changed'?'b':'a'}})
  }})
  const p=await f.cache.prepare(track);const state=await terminal(f.cache,p.id)
  assert.equal(state.state,mode==='valid'?'ready':'failed',mode)
  assert.equal(f.cache.stats().entries,mode==='valid'?1:0)
  assert.equal(calls,2)
 }
})
test('completed response leases reject a different cache representation and cleared preparation expires',async t=>{
 const f=await fixture(t),p=await f.cache.prepare(track);await terminal(f.cache,p.id)
 const hit=await f.cache.cached(track);assert.match(hit.digest,/^[a-f0-9]{64}$/)
 const app=new Hono();app.get('/',async c=>{try{return await f.cache.serve(c,track)}catch(e){return c.json({code:e.code},e.status)}})
 assert.equal((await app.request('/?cacheVersion=old')).status,410)
 const response=await app.request('/?cacheVersion='+hit.digest);assert.equal(response.status,200);await response.arrayBuffer()
 await f.cache.clear();assert.equal(f.cache.status(p.id).state,'expired')
})

test('a playback lease protects cached audio between completed range reads until the attempt ends',async t=>{
 let clock=Date.now();const f=await fixture(t,{now:()=>clock});const p=await f.cache.prepare(track);await terminal(f.cache,p.id)
 const app=new Hono();app.get('/',c=>f.cache.serve(c,track));const first=await app.request('/?requestId=playing',{headers:{Range:'bytes=0-9'}});await first.arrayBuffer()
 assert.equal(f.cache.stats().pinned,0);assert.equal((await f.cache.clear()).removed,0)
 const seek=await app.request('/?requestId=playing',{headers:{Range:'bytes=900-'}});assert.equal(seek.status,206);await seek.arrayBuffer()
 f.cache.lease(track,'second-device',3);f.cache.release('playing');assert.equal((await f.cache.clear()).removed,0)
 f.cache.release('second-device');assert.equal((await f.cache.clear()).removed,1)
 const next=await f.cache.prepare(track);await terminal(f.cache,next.id);f.cache.lease(track,'crashed-device',3)
 clock+=124000;assert.equal((await f.cache.clear()).removed,1)
})
