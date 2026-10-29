import test from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { createStore } from '../src/store.js'
import { installApi } from '../src/api-v1.js'
import { rediscoverHistory } from '../src/rediscover.js'
import { outsidePlaylists } from '../src/recommendations.js'
import { createMembership } from '../src/membership.js'

test('Made for you excludes playlist recordings and aliases on fresh, cached and stale responses',async()=>{
 const store=createStore(':memory:'),app=new Hono();let offline=false
 const saved={id:'saved-track',kaynak:'kutuphane',baslik:'In My Playlist',sanatci:'An Artist',sure:200}
 const alias={...saved,id:'alias000001',kaynak:'youtube',sure:undefined}
 const fresh={id:'fresh-track',kaynak:'kutuphane',baslik:'A New Find',sanatci:'Another Artist',sure:210}
 const service=installApi(app,{store,subsonic:async()=>{if(offline)throw new Error('offline');return {randomSongs:{song:[saved,alias,fresh]}}},mapSong:p=>p,ytres:async()=>{throw new Error('offline')},searchAll:async()=>({parcalar:[]}),archive:{}})
 try{
  let response=await(await app.request('/api/v1/recommendations')).json();assert.ok(response.parcalar.some(p=>p.id===saved.id))
  const list=store.createList('My playlist');store.add(list,[saved])
  response=await(await app.request('/api/v1/recommendations')).json();assert.deepEqual(response.parcalar.map(p=>p.id),[fresh.id])
  let home=await(await app.request('/api/v1/home')).json();assert.deepEqual(home.sections.forYou.data.map(p=>p.id),[fresh.id])
  store.db.prepare('INSERT OR REPLACE INTO selections VALUES(?,?,?)').run('forYou',JSON.stringify([store.upsert(saved),store.upsert(alias),store.upsert(fresh)]),Date.now())
  store.event({event:'playing',parca:{id:'seed0000001',kaynak:'youtube',baslik:'A Different Seed',sanatci:'Seed Artist',sure:100}});offline=true
  home=await(await app.request('/api/v1/home')).json();assert.equal(home.sections.forYou.state,'stale');assert.deepEqual(home.sections.forYou.data.map(p=>p.id),[fresh.id])
  store.db.prepare('DELETE FROM entries WHERE playlist_id=?').run(list)
  assert.ok(outsidePlaylists(store)(store.upsert(saved)))
 }finally{service.stop();store.close()}
})
test('playlist exclusions belong to the active account',()=>{
 const base=createStore(':memory:'),membership=createMembership(base,':memory:')
 try{
  for(const id of ['one','two'])base.db.prepare('INSERT INTO members(id,username,username_key,password_hash,created,legacy_owner) VALUES(?,?,?,?,?,0)').run(id,id,id,'hash',Date.now())
  const p={id:'track',kaynak:'youtube',baslik:'Song',sanatci:'Artist',sure:200},store=membership.store
  membership.context.run('one',()=>{store.add(store.createList('One'),[p]);assert.equal(outsidePlaylists(store)(store.upsert(p)),false)})
  membership.context.run('two',()=>assert.equal(outsidePlaylists(store)(store.upsert(p)),true))
 }finally{membership.stop();base.close()}
})
test('Rediscover changes every refresh, prioritizes unshown tracks, respects dismissals and balances artists',()=>{
 const store=createStore(':memory:')
 try{
  for(let i=0;i<100;i++)store.event({event:'playing',occurredAt:Date.now()-100000+i*100,parca:{id:'history-'+i,kaynak:'youtube',baslik:'Song '+i,sanatci:'Artist '+i%20,sure:200}})
  const hidden=store.history(100).at(-1);store.dismiss(hidden)
  const recent=new Set(store.history(20).map(p=>p.appId)),first=rediscoverHistory(store,{pick:n=>n-1}),second=rediscoverHistory(store,{pick:n=>n-1})
  assert.equal(first.length,12);assert.equal(second.length,12)
  assert.ok(first.every(p=>!recent.has(p.appId)&&p.appId!==hidden.appId))
  const seen=new Set(first.map(p=>p.appId));assert.ok(second.every(p=>!seen.has(p.appId)))
  const counts=new Map();for(const p of second)counts.set(p.sanatci,(counts.get(p.sanatci)||0)+1);assert.ok([...counts.values()].every(n=>n<=2))
 }finally{store.close()}
})
test('a small Rediscover pool still rotates its order without inventing history',()=>{
 const store=createStore(':memory:')
 try{
  for(let i=0;i<23;i++)store.event({event:'playing',occurredAt:Date.now()-50000+i*100,parca:{id:'small-'+i,kaynak:'youtube',baslik:'Song '+i,sanatci:'Artist '+i,sure:200}})
  const first=rediscoverHistory(store,{pick:n=>n-1}),second=rediscoverHistory(store,{pick:n=>n-1})
  assert.equal(first.length,3);assert.equal(second.length,3);assert.notDeepEqual(first.map(p=>p.id),second.map(p=>p.id))
  assert.deepEqual([...first.map(p=>p.id)].sort(),[...second.map(p=>p.id)].sort())
 }finally{store.close()}
})
