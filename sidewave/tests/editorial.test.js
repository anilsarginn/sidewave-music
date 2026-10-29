import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createStore } from '../src/store.js'
import { createEditorialService } from '../src/editorial.js'
import { EDITORIAL } from '../src/collections.js'

function catalog(){let calls=0,fail=false;return {get calls(){return calls},set fail(value){fail=value},search:async path=>{
 calls++;if(fail)throw new Error('offline')
 const artist=new URL('http://test'+path).searchParams.get('q')
 const songs=Array.from({length:30},(_,i)=>({id:createHash('sha256').update(artist+i).digest('hex').slice(0,11),sanatci:artist,baslik:'Song '+i,sure:180}))
 return {sonuclar:[...songs,{...songs[0],id:'duplicate01'},{...songs[1],id:'remaster001',baslik:'Song 1 (2019 Remastered)'},{id:'wrongartist',sanatci:'Tribute Band',baslik:'Fake song',sure:200},{id:'bad-remix01',sanatci:artist,baslik:'Song 0 (Remix)',sure:180}]}
}}}
test('80 real catalog rows, distinct recordings and artists, then 8 fresh additions after Monday without a visitor',async()=>{
 const store=createStore(':memory:'),provider=catalog();let now=Date.parse('2026-10-21T10:00:00+03:00')
 try{
  const service=createEditorialService({baseStore:store,entries:[EDITORIAL[0]],ytres:provider.search,now:()=>now})
  await service.tick();const first=await service.editorial(EDITORIAL[0].id)
  assert.equal(first.parcalar.length,80);assert.equal(first.refreshAt,Date.parse('2026-10-26T00:00:00+03:00'))
  assert.ok(first.parcalar.every(p=>p.sanatci!=='Tribute Band'&&!p.baslik.includes('Remix')))
  assert.equal(new Set(first.parcalar.map(p=>p.sanatci+'|'+p.baslik.replace(' (2019 Remastered)',''))).size,80)
  const counts=new Map();for(const p of first.parcalar)counts.set(p.sanatci,(counts.get(p.sanatci)||0)+1)
  assert.ok([...counts.values()].every(n=>n<=5));assert.ok(counts.size>=16)
  const before=provider.calls;await service.tick();assert.equal(provider.calls,before)
  now=first.refreshAt;await service.tick();const second=await service.editorial(EDITORIAL[0].id)
  assert.equal(second.parcalar.length,88);assert.equal(second.addedCount,8)
  const prior=new Set(first.parcalar.map(p=>p.id));assert.ok(second.parcalar.slice(0,8).every(p=>!prior.has(p.id)))
  assert.equal(second.parcalar.filter(p=>prior.has(p.id)).length,80)
  assert.ok(!('seen' in second));assert.equal(store.lists().length,0)
 }finally{store.close()}
})
test('upgrades permanent 12-song snapshots, persists state across restart and retries an outage without data loss',async()=>{
 const store=createStore(':memory:'),provider=catalog();let now=Date.parse('2026-10-21T10:00:00+03:00')
 try{
  let service=createEditorialService({baseStore:store,entries:[EDITORIAL[0]],ytres:provider.search,now:()=>now})
  const legacy=Array.from({length:12},(_,i)=>({id:'old'+String(i).padStart(8,'0'),sanatci:EDITORIAL[0].seeds[i][0],baslik:'Old song '+i,sure:200,kaynak:'youtube'}))
  store.db.prepare('INSERT INTO editorial_collections VALUES(?,?,?)').run(EDITORIAL[0].id,JSON.stringify({parcalar:legacy,revision:1,updatedAt:now-86400000}),now)
  // Cached rows remain immediately available during a background upgrade.
  assert.equal((await service.editorial(EDITORIAL[0].id)).parcalar.length,12)
  await service.tick();const first=await service.editorial(EDITORIAL[0].id);assert.equal(first.parcalar.length,80)
  assert.deepEqual(first.parcalar.slice(0,12),legacy)
  service=createEditorialService({baseStore:store,entries:[EDITORIAL[0]],ytres:provider.search,now:()=>now})
  const before=provider.calls;await service.tick();assert.equal(provider.calls,before)
  now=first.refreshAt;provider.fail=true;await service.tick()
  const failed=await service.editorial(EDITORIAL[0].id);assert.deepEqual(failed.parcalar,first.parcalar);assert.equal(failed.updatedAt,first.updatedAt)
  const after=provider.calls;await service.tick();assert.equal(provider.calls,after)
  now+=3600000;provider.fail=false;await service.tick();assert.equal((await service.editorial(EDITORIAL[0].id)).parcalar.length,88)
 }finally{store.close()}
})
test('concurrent empty-list requests share resolution, unknown lists fail, and the rolling collection stays bounded',async()=>{
 const store=createStore(':memory:'),provider=catalog();let now=Date.parse('2026-10-21T10:00:00+03:00')
 try{
  const service=createEditorialService({baseStore:store,entries:[EDITORIAL[0]],ytres:provider.search,now:()=>now})
  const [a,b]=await Promise.all([service.editorial(EDITORIAL[0].id),service.editorial(EDITORIAL[0].id)])
  assert.deepEqual(a,b);const calls=provider.calls;await service.editorial(EDITORIAL[0].id);assert.equal(provider.calls,calls)
  await assert.rejects(()=>service.editorial('missing'),/Session not found/)
  for(let i=0;i<18;i++){now+=7*86400000;await service.tick()}
  const result=await service.editorial(EDITORIAL[0].id);assert.equal(result.parcalar.length,200)
  assert.equal(new Set(result.parcalar.map(p=>p.id)).size,200)
 }finally{store.close()}
})
