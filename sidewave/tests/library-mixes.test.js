import test from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { createStore } from '../src/store.js'
import { installApi } from '../src/api-v1.js'

const song=(id,artist,title='Song '+id)=>({id,kaynak:'kutuphane',baslik:title,sanatci:artist,sure:200,kapakId:'cover-'+artist})
function setup(random){
 const store=createStore(':memory:'),app=new Hono()
 app.onError((e,c)=>c.json({code:e.code},e.status||500))
 const service=installApi(app,{store,subsonic:async()=>({randomSongs:{song:random}}),mapSong:p=>p,ytres:async()=>{throw new Error('offline')},searchAll:async()=>({parcalar:[]}),archive:{}})
 return {store,app,close(){service.stop();store.close()}}
}

test('playlist summaries count entries and offer up to four distinct covers without loading the list',async()=>{
 const s=setup([]);try{
  const id=s.store.createList('Road');s.store.add(id,[song('a','One'),song('b','One'),song('c','Two'),song('d','Three'),song('e','Four'),song('f','Five')])
  s.store.favorite(song('a','One'),true)
  const body=await(await s.app.request('/api/listeler')).json()
  assert.equal(body.begeniSayisi,1)
  const [list]=body.listeler;assert.equal(list.parcaSayisi,6);assert.equal(list.sure,1200)
  assert.deepEqual(list.kapaklar.map(k=>k.kapakId),['cover-One','cover-Two','cover-Three','cover-Four'])
 }finally{s.close()}
})

test('playlist recommendations never repeat its recordings',async()=>{
 const s=setup([song('a','One'),song('x','Other'),song('y','Third'),song('b','One','Song b')])
 try{
  const id=s.store.createList('Road');s.store.add(id,[song('a','One'),song('b','One')])
  const body=await(await s.app.request(`/api/v1/playlists/${id}/recommendations`)).json()
  assert.deepEqual(body.parcalar.map(p=>p.id).sort(),['x','y'])
  assert.equal((await s.app.request('/api/v1/playlists/missing/recommendations')).status,404)
 }finally{s.close()}
})

test('daily mixes form around artists you return to and stay stable for the day',async()=>{
 const random=Array.from({length:30},(_,i)=>song('r'+i,'Related '+(i%15)))
 const s=setup(random)
 try{
  assert.deepEqual((await(await s.app.request('/api/v1/mixes')).json()).mixes,[],'no listening yet, no mixes')
  for(const p of [song('m1','Mabel'),song('m2','Mabel'),song('t1','Teoman')])s.store.event({event:'playing',parca:p})
  s.store.favorite(song('m1','Mabel'),true)
  const first=await(await s.app.request('/api/v1/mixes')).json()
  assert.ok(first.mixes.length>=1);assert.equal(first.mixes[0].ad,'Daily Mix 1');assert.match(first.mixes[0].altyazi,/Mabel/)
  const detail=await(await s.app.request('/api/v1/mixes/mix-1')).json()
  assert.ok(detail.parcalar.length>=8);assert.equal(detail.parcalar[0].sanatci,'Mabel')
  assert.equal(new Set(detail.parcalar.map(p=>p.appId)).size,detail.parcalar.length,'no duplicates')
  const again=await(await s.app.request('/api/v1/mixes')).json();assert.deepEqual(again,first)
  assert.equal((await s.app.request('/api/v1/mixes/mix-9')).status,404)
 }finally{s.close()}
})
