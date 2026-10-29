import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createStore} from '../src/store.js'
import {createOnlineDiscovery,cosine} from '../src/online-discovery.js'
const p=(id,artist=id)=>({id:id.repeat(11),baslik:'Song '+id,sanatci:artist,kaynak:'youtube',sure:200})
test('online discovery returns novel catalog tracks immediately, never invents scores or archives',async()=>{
 const store=createStore(':memory:');let calls=0
 try{
 store.favorite(p('b'),true);store.event({event:'playing',parca:p('c')});store.dismiss(p('d'))
 const d=createOnlineDiscovery({store,related:async()=>{calls++;return{parcalar:[p('a'),p('b'),p('c'),p('d'),p('e','Group'),p('f','Group'),p('g','Group'),p('h')]}}})
 const r=await d.start(p('a'));assert.deepEqual(r.parcalar.map(p=>p.id),['e','f','h'].map(x=>x.repeat(11)));assert.equal(r.method,'catalog');assert.ok(r.matches.every(m=>m.similarity===null));assert.equal(store.jobs().length,0)
 await d.start(p('a'));assert.equal(calls,1)
 }finally{store.close()}
})
test('bounded background jobs persist vectors, recover after restart and separate model versions',async()=>{
 const store=createStore(':memory:');let allow=false,calls=0
 const options={store,related:async()=>({parcalar:[p('b'),p('c')]}),canAnalyze:()=>allow,analyze:async t=>{calls++;if(t.id===p('c').id)throw Error('private URL');return{model:'test',vector:[1,t.id===p('a').id?0:.1],seconds:45}}}
 try{
 let d=createOnlineDiscovery(options);const r=await d.start(p('a'));assert.equal(r.analysis.state,'waiting');await d.tick();assert.equal(calls,0)
 d.stop();d=createOnlineDiscovery(options);allow=true;await d.tick();await d.tick();await d.tick();await d.tick()
 const ready=d.result(r.analysis.id);assert.equal(ready.analysis.state,'partial');assert.equal(ready.analysis.failed,1);assert.ok(ready.matches[0].similarity>.99);assert.equal(ready.matches[1].similarity,null);assert.ok(!JSON.stringify(ready).includes('private'))
 await d.start(p('a'));await d.tick();assert.equal(calls,4)
 }finally{store.close()}
})
test('concurrent requests deduplicate; exclusions apply again when polling; mix preserves seed',async()=>{
 const store=createStore(':memory:');let calls=0
 try{const d=createOnlineDiscovery({store,related:async()=>{calls++;await new Promise(r=>setTimeout(r,5));return{parcalar:[p('b')]}}})
 const [a,b]=await Promise.all([d.start(p('a')),d.start(p('a'))]);assert.equal(a.analysis.id,b.analysis.id);assert.equal(calls,1)
 store.favorite(p('b'),true);assert.deepEqual(d.result(a.analysis.id,{mix:true}).parcalar.map(p=>p.id),[p('a').id])
 assert.equal(cosine([NaN],[1]),null);assert.equal(cosine([0],[0]),null);assert.equal(cosine([1,0],[1]),null)
 }finally{store.close()}
})
test('exact local copy retains online discovery identity; analysis budgets and model boundaries are enforced',async()=>{
 const store=createStore(':memory:');const analyzed=[]
 try{
 store.upsert({...p('a'),id:'local',kaynak:'kutuphane'})
 const d=createOnlineDiscovery({store,related:async()=>({parcalar:'bcdefghijklm'.split('').map(x=>p(x))}),analyze:async t=>{analyzed.push(t.id);return{model:t.id===p('b').id?'different':'same',vector:[1,0],seconds:45}}})
 const r=await d.start(p('a'));assert.equal(r.seed.kaynak,'youtube');assert.equal(r.analysis.total,9)
 for(let i=0;i<15;i++)await d.tick()
 assert.equal(analyzed.length,9)
 const ready=d.result(r.analysis.id);assert.equal(ready.matches.find(m=>m.parca.id===p('b').id).similarity,null);assert.equal(ready.matches.find(m=>m.parca.id===p('c').id).similarity,1)
 }finally{store.close()}
})
test('failed excerpts stop after two attempts; explicit retry preserves successful work and is rate limited',async()=>{
 const store=createStore(':memory:');let calls=0
 try{
 const d=createOnlineDiscovery({store,related:async()=>({parcalar:[p('b')]}),analyze:async t=>{calls++;if(t.id===p('a').id)throw Error('temporary');return{model:'test',vector:[1,0]}}})
 const r=await d.start(p('a'));for(let i=0;i<8;i++)await d.tick();assert.equal(calls,3);assert.equal(d.result(r.analysis.id).analysis.state,'partial')
 d.retry(r.analysis.id);await d.tick();await d.tick();assert.equal(calls,5);assert.throws(()=>d.retry(r.analysis.id),{code:'RATE_LIMITED'})
 }finally{store.close()}
})
