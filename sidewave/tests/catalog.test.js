import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createStore} from '../src/store.js'

test('twenty artist identities preserve namesakes, source boundaries and versioned releases',()=>{
 const s=createStore(':memory:')
 try{
  const ids=new Set()
  for(let i=0;i<20;i++){
   const artist=s.catalog.put('artist',i%2?'youtube':'kutuphane',`artist-${i}`,{ad:i<4?'People Around':`Sanatçı ${i}`})
   ids.add(artist.appId)
   assert.equal(s.catalog.put('artist',artist.kaynak,artist.id,{ad:artist.ad}).appId,artist.appId)
  }
  assert.equal(ids.size,20)
  const a=s.catalog.put('artist','youtube','same',{ad:'A'}),b=s.catalog.put('artist','kutuphane','same',{ad:'A'})
  assert.notEqual(a.appId,b.appId)
  const studio=s.catalog.put('album','youtube','album-a',{ad:'Album'}),live=s.catalog.put('album','youtube','album-b',{ad:'Album (Live)'})
  assert.notEqual(studio.appId,live.appId)
  assert.equal(s.catalog.library().sanatcilar.length,0)
  assert.throws(()=>s.catalog.select('artist',studio.appId,true),{code:'NOT_FOUND'})
  assert.throws(()=>s.catalog.select('artist',a.appId,'true'),{code:'INVALID_SELECTION'})
 }finally{s.close()}
})
test('follows and saved albums persist across reopen without touching track likes or other entities',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sidewave-catalog-')),path=join(dir,'db.sqlite');let s=createStore(path)
 try{
  const a=s.catalog.put('artist','youtube','artist',{ad:'People Around',biyografi:'Bio'},true)
  const b=s.catalog.put('artist','youtube','other',{ad:'People Around'},true)
  const album=s.catalog.put('album','youtube','album',{ad:'Bliss',parcalar:[]},true)
  s.catalog.select('artist',a.appId,true);s.catalog.select('artist',a.appId,true);s.catalog.select('album',album.appId,true)
  const p=s.upsert({id:'track',kaynak:'youtube',baslik:'Song',sanatci:'People Around & Guest',sanatciId:'artist',album:'Bliss',albumId:'album',sure:20})
  assert.equal(s.catalog.get(a.appId).ad,'People Around')
  assert.equal(s.catalog.get(a.appId).biyografi,'Bio')
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM track_credits WHERE track_id=?').get(p.appId).n,1)
  s.close();s=createStore(path)
  assert.equal(s.catalog.get(a.appId).takip,true);assert.equal(s.catalog.get(b.appId).takip,false)
  assert.equal(s.catalog.library().sanatcilar.length,1);assert.equal(s.catalog.library().albumler[0].kayitli,true)
  assert.equal(s.favorites().length,0)
  s.catalog.select('artist',a.appId,false);s.catalog.select('album',album.appId,false)
  assert.deepEqual(s.catalog.library(),{sanatcilar:[],albumler:[]})
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM migrations WHERE version=3').get().n,1)
 }finally{s.close();rmSync(dir,{recursive:true,force:true})}
})
test('different explicit artist IDs never collapse same-name recordings within one provider',()=>{
 const s=createStore(':memory:')
 try{
  const one=s.upsert({id:'one',kaynak:'youtube',baslik:'Same Song',sanatci:'Namesake',sanatciId:'channel-one',sure:200})
  const two=s.upsert({id:'two',kaynak:'youtube',baslik:'Same Song',sanatci:'Namesake',sanatciId:'channel-two',sure:200})
  assert.notEqual(one.appId,two.appId)
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM tracks').get().n,2)
 }finally{s.close()}
})
