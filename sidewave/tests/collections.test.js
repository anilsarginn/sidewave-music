import test from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { createHash } from 'node:crypto'
import { createStore } from '../src/store.js'
import { createMembership } from '../src/membership.js'
import { EDITORIAL, installCollections, weekWindow } from '../src/collections.js'

test('Istanbul weeks change at Monday midnight, including Sunday UTC',()=>{
 const sunday=Date.parse('2026-10-18T20:59:59Z'),monday=sunday+1000
 assert.equal(weekWindow(sunday).week,'2026-10-12')
 assert.equal(weekWindow(monday).week,'2026-10-19')
 assert.equal(weekWindow(monday).refreshAt,Date.parse('2026-10-25T21:00:00Z'))
})
test('editorial selections are read-only application content, resolved and persisted without personal playlists',async()=>{
 const store=createStore(':memory:'),app=new Hono();let calls=0
 try{
  const service=installCollections(app,{store,baseStore:store,ytres:async path=>{calls++;const artist=new URL('http://test'+path).searchParams.get('q');return {sonuclar:Array.from({length:12},(_,i)=>({id:createHash('sha256').update(artist+i).digest('hex').slice(0,11),sanatci:artist,baslik:'Song '+i,sure:210}))}},subsonic:async()=>({}),mapSong:p=>p})
  const list=await service.editorial(EDITORIAL[0].id);assert.equal(list.parcalar.length,80);assert.equal(list.editable,false)
  assert.equal(store.lists().length,0);const before=calls
  await service.editorial(EDITORIAL[0].id);assert.equal(calls,before)
  const summaries=await(await app.request('/api/v1/collections')).json();assert.equal(summaries.listeler.length,8)
  await assert.rejects(()=>service.editorial('missing'),/Session not found/)
 }finally{store.close()}
})
test('weekly selection excludes known/dismissed songs, limits artists, stays stable and refreshes next week',async()=>{
 const store=createStore(':memory:'),app=new Hono();let now=Date.parse('2026-10-20T10:00:00Z'),calls=0
 try{
  const seed=store.favorite({id:'seed0000001',kaynak:'youtube',baslik:'Seed',sanatci:'Playlistner'},true)
  const hidden=store.upsert({id:'hidden00001',kaynak:'youtube',baslik:'Hidden',sanatci:'Other'});store.dismiss(hidden)
  const candidates=Array.from({length:60},(_,i)=>({id:String(i).padStart(11,'0'),kaynak:'youtube',baslik:'Track '+i,sanatci:'Artist '+Math.floor(i/4)}))
  const service=installCollections(app,{store,baseStore:store,now:()=>now,ytres:async()=>{calls++;return {parcalar:[seed,hidden,...candidates]}},subsonic:async()=>({randomSongs:{song:[]}}),mapSong:p=>p})
  const first=await service.weekly();assert.equal(first.parcalar.length,30);assert.ok(first.personalized)
  assert.ok(first.parcalar.every(p=>p.id!==seed.id&&p.id!==hidden.id))
  const counts=new Map();for(const p of first.parcalar)counts.set(p.sanatci,(counts.get(p.sanatci)||0)+1);assert.ok([...counts.values()].every(n=>n<=2))
  const before=calls;const second=await service.weekly();assert.deepEqual(second.parcalar,first.parcalar);assert.equal(calls,before)
  now+=7*86400000;const next=await service.weekly();assert.notEqual(next.week,first.week);assert.ok(calls>before)
 }finally{store.close()}
})
test('concurrent accounts generate independent weekly snapshots',async()=>{
 const base=createStore(':memory:'),membership=createMembership(base,':memory:'),app=new Hono(),store=membership.store
 try{
  for(const id of ['account-a','account-b'])base.db.prepare('INSERT INTO members(id,username,username_key,password_hash,created,legacy_owner) VALUES(?,?,?,?,?,0)').run(id,id,id,'hash',Date.now())
  const service=installCollections(app,{store,baseStore:base,ytres:async path=>{await new Promise(r=>setTimeout(r,5));const id=new URL('http://x'+path).searchParams.get('id');return {parcalar:Array.from({length:4},(_,i)=>({id:(id+i).slice(-11).padStart(11,'0'),baslik:id+' '+i,sanatci:'Artist '+i}))}},subsonic:async()=>({randomSongs:{song:[]}}),mapSong:p=>p})
  const results=await Promise.all(['account-a','account-b'].map((id,i)=>membership.context.run(id,async()=>{store.favorite({id:'seed000000'+i,kaynak:'youtube',baslik:'Seed',sanatci:'Artist'},true);return service.weekly()})))
  assert.notDeepEqual(results[0].parcalar.map(p=>p.id),results[1].parcalar.map(p=>p.id))
 }finally{membership.stop();base.close()}
})
