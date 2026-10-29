import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRange, proxyAudio } from '../src/stream.js'
const context=range=>({req:{raw:new Request('http://localhost/audio'),header:name=>name==='range'?range:undefined}})
test('byte ranges support suffix/open end and reject invalid/multiple ranges',()=>{
 assert.deepEqual(parseRange('bytes=-10',100),{start:90,end:99});assert.deepEqual(parseRange('bytes=20-',100),{start:20,end:99});assert.deepEqual(parseRange('bytes=0-1000',100),{start:0,end:99})
 for(const value of ['bytes=100-','bytes=40-20','bytes=0-1,3-4','bytes=-0','bytes=-'])assert.throws(()=>parseRange(value,100))
})
test('expired remote URL refreshes once and forwards format headers and Range',async()=>{
 const forces=[],requests=[];const response=await proxyAudio(context('bytes=0-2'),async force=>{forces.push(force);return{url:'https://example.test/audio',headers:{Referer:'https://music.youtube.com'}}},{source:'youtube',fetcher:async(url,opts)=>{requests.push(opts);return requests.length===1?new Response('expired',{status:403}):new Response(new Uint8Array([1,2,3]),{status:206,headers:{'content-type':'audio/webm','content-range':'bytes 0-2/100'}})}})
 assert.deepEqual(forces,[false,true]);assert.equal(requests[1].headers.Range,'bytes=0-2');assert.equal(requests[1].headers.Referer,'https://music.youtube.com');assert.equal(response.status,206);assert.equal((await response.arrayBuffer()).byteLength,3)
})
test('HTML and repeated failures are never served as playable media',async()=>{
 await assert.rejects(proxyAudio(context(),async()=>({url:'https://example.test'}),{fetcher:async()=>new Response('login',{headers:{'content-type':'text/html'}})}),e=>e.code==='INVALID_MEDIA')
 let n=0;await assert.rejects(proxyAudio(context(),async()=>({url:'https://example.test'}),{source:'youtube',fetcher:async()=>{n++;return new Response(null,{status:403})}}),e=>e.code==='SOURCE_UNAVAILABLE');assert.equal(n,2)
})
test('416 retains total size and request cancellation cancels upstream body',async()=>{
 const r=await proxyAudio(context('bytes=500-'),async()=>({url:'https://example.test'}),{fetcher:async()=>new Response(null,{status:416,headers:{'content-range':'bytes */100'}})});assert.equal(r.status,416);assert.equal(r.headers.get('content-range'),'bytes */100')
 let cancelled=false;const body=new ReadableStream({start(c){c.enqueue(new Uint8Array([1]))},cancel(){cancelled=true}});const audio=await proxyAudio(context(),async()=>({url:'https://example.test'}),{fetcher:async()=>new Response(body,{headers:{'content-type':'audio/mpeg'}})});await audio.body.cancel();assert.equal(cancelled,true)
})

test('aggregate deadline cancels an uncooperative resolver before it returns',async()=>{
 let signal;const started=Date.now()
 await assert.rejects(proxyAudio(context(),(_force,s)=>{signal=s;return new Promise(()=>{})},{budgetMs:25}),e=>e.code==='START_TIMEOUT')
 assert.ok(signal.aborted);assert.ok(Date.now()-started<250)
})
test('upstream headers alone cannot satisfy the first-audio-byte deadline',async()=>{
 let cancelled=false;const started=Date.now()
 const body=new ReadableStream({cancel(){cancelled=true}})
 await assert.rejects(proxyAudio(context(),async()=>({url:'https://example.test'}),{budgetMs:25,fetcher:async()=>new Response(body,{headers:{'content-type':'audio/webm'}})}),e=>e.code==='START_TIMEOUT')
 assert.ok(cancelled);assert.ok(Date.now()-started<250)
})
test('refresh shares the original deadline and receives the same cancellation signal',async()=>{
 const signals=[],forces=[];let calls=0
 await assert.rejects(proxyAudio(context(),async(force,signal)=>{
   signals.push(signal);forces.push(force)
   if(force)return new Promise(()=>{})
   return{url:'https://example.test'}
 },{source:'youtube',budgetMs:25,fetcher:async()=>{calls++;return new Response(null,{status:403})}}),e=>e.code==='START_TIMEOUT')
 assert.deepEqual(forces,[false,true]);assert.equal(calls,1);assert.equal(signals[0],signals[1]);assert.ok(signals[0].aborted)
})
test('typed resolver authentication errors are not retried',async()=>{
 let calls=0
 await assert.rejects(proxyAudio(context(),async()=>{calls++;throw Object.assign(new Error('Oturum gerekli'),{code:'SOURCE_AUTH_REQUIRED',status:403,retryable:false})},{source:'youtube'}),e=>e.code==='SOURCE_AUTH_REQUIRED'&&e.retryable===false)
 assert.equal(calls,1)
})
test('incoming cancellation during resolve and before request stops work',async()=>{
 const controller=new AbortController(),ctx={req:{raw:{signal:controller.signal},header:()=>undefined}}
 let signal
 const pending=proxyAudio(ctx,(_force,s)=>{signal=s;return new Promise(()=>{})})
 controller.abort()
 await assert.rejects(pending,e=>e.code==='PLAYBACK_CANCELLED');assert.ok(signal.aborted)
 let called=false
 await assert.rejects(proxyAudio(ctx,async()=>{called=true;return{url:'https://example.test'}}),e=>e.code==='PLAYBACK_CANCELLED')
 assert.equal(called,false)
})
test('empty audio response fails before committing success',async()=>{
 await assert.rejects(proxyAudio(context(),async()=>({url:'https://example.test'}),{fetcher:async()=>new Response(new Uint8Array(),{headers:{'content-type':'audio/mpeg'}})}),e=>e.code==='EMPTY_MEDIA')
})
test('idle timeout still bounds a stalled body after its first chunk',async()=>{
 let cancelled=false
 const upstream=new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2,3]))},cancel(){cancelled=true}})
 const response=await proxyAudio(context(),async()=>({url:'https://example.test'}),{budgetMs:50,idleMs:25,fetcher:async()=>new Response(upstream,{headers:{'content-type':'audio/webm'}})})
 const reader=response.body.getReader()
 assert.deepEqual(Array.from((await reader.read()).value),[1,2,3])
 await assert.rejects(reader.read(),e=>e.code==='STREAM_TIMEOUT');assert.ok(cancelled)
})
test('416 and invalid content remove the incoming abort listener',async()=>{
 for(const status of [416,200]){
  const signal=new EventTarget();signal.aborted=false
  let added=0,removed=0
  const add=signal.addEventListener.bind(signal),remove=signal.removeEventListener.bind(signal)
  signal.addEventListener=(...args)=>{added++;return add(...args)}
  signal.removeEventListener=(...args)=>{removed++;return remove(...args)}
  const ctx={req:{raw:{signal},header:()=>undefined}}
  const run=proxyAudio(ctx,async()=>({url:'https://example.test'}),{fetcher:async()=>new Response(null,{status,headers:{'content-type':'text/html'}})})
  if(status===416)assert.equal((await run).status,416)
  else await assert.rejects(run,e=>e.code==='INVALID_MEDIA')
  assert.equal(added,removed)
 }
})
