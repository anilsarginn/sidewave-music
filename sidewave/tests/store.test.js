import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore, sameRecording } from '../src/store.js'
import { migrateNavidrome } from '../src/api-v1.js'
const yt={id:'12345678901',baslik:'Bir Şarkı',sanatci:'Sanatçı',sure:200,kaynak:'youtube'}
const local={...yt,id:'local-1',kaynak:'kutuphane'}
test('mixed sources merge only identical recording with duration evidence',()=>{
 const s=createStore(':memory:');const a=s.upsert(yt);s.favorite(yt,true);const b=s.upsert(local)
 assert.equal(a.appId,b.appId);assert.equal(b.kaynak,'kutuphane');assert.equal(s.favorites()[0].id,'local-1')
 assert.notEqual(s.upsert({...yt,id:'live',baslik:'Bir Şarkı (Live)'}).appId,a.appId)
 assert.notEqual(s.upsert({...yt,id:'unknown',sure:null}).appId,a.appId);s.close()
})
test('duplicate playlist entries have independent stable IDs and reorder/remove correctly',()=>{
 const s=createStore(':memory:'),id=s.createList('Karışık');const p=s.add(id,[yt,local,yt]);assert.equal(new Set(p.parcalar.map(p=>p.entryId)).size,3)
 const ids=p.parcalar.map(p=>p.entryId).reverse();s.updateList(id,{entryIds:ids,ad:'Yeni'})
 assert.deepEqual(s.list(id).parcalar.map(p=>p.entryId),ids);s.remove(id,ids[1]);assert.equal(s.list(id).parcalar.length,2)
 assert.throws(()=>s.updateList(id,{entryIds:[ids[0],ids[0]]}),/has changed/);s.close()
})
test('favorites jobs history and device state survive reopen; heartbeat never takes over',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sidewave-')),file=join(dir,'db.sqlite');let s=createStore(file)
 s.favorite(yt,true);s.event({id:'event-1',event:'playing',parca:yt});s.event({id:'event-1',event:'playing',parca:yt})
 s.saveJob({id:'job',trackKey:'key',durum:'indiriliyor'});s.device('a',{queue:[yt],index:0,position:42,state:'playing'});s.device('b',{queue:[],index:0,position:0,state:'paused'})
 assert.equal(s.setting('activeDeviceId'),null);s.takeover('a');s.device('b',{queue:[],position:0});assert.equal(s.setting('activeDeviceId'),'a')
 assert.equal(s.takeover('b').position,42);s.close();s=createStore(file)
 assert.equal(s.favorites().length,1);assert.equal(s.history().length,1);assert.equal(s.getJob('job').durum,'indiriliyor');assert.equal(s.setting('activeDeviceId'),'b');s.close();rmSync(dir,{recursive:true})
})
test('migration is idempotent and performs no remote mutation',async()=>{
 const s=createStore(':memory:'),calls=[];const nd=async(name)=>{calls.push(name);return name==='getStarred2.view'?{starred2:{song:[yt]}}:name==='getPlaylists.view'?{playlists:{playlist:[{id:'old'}]}}:{playlist:{id:'old',name:'Eski',entry:[yt]}}}
 await migrateNavidrome(s,nd,p=>p);await migrateNavidrome(s,nd,p=>p)
 assert.equal(s.lists().length,1);assert.equal(s.favorites().length,1);assert.equal(calls.length,3);s.close()
})
test('recording index backfills records written by a rollback image without changing the old table shape',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sidewave-index-')),file=join(dir,'db.sqlite');let s=createStore(file)
 // Older image writes remain valid even after the index migration.
 s.db.prepare('INSERT INTO tracks VALUES(?,?)').run('legacy-app-id',JSON.stringify(yt));s.close();s=createStore(file)
 assert.equal(s.upsert(local).appId,'legacy-app-id');assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM recording_keys').get().n,1)
 assert.match(s.db.prepare('EXPLAIN QUERY PLAN SELECT track_id FROM recording_keys WHERE key=?').get('key').detail,/INDEX/)
 s.close();rmSync(dir,{recursive:true,force:true})
})

test('device revisions reject stale queues and takeover commands are idempotent',()=>{
 const store=createStore(':memory:')
 try{
  const a=store.device('a',{queue:[{id:'one'}],position:12,state:'playing'}),b=store.device('b',{queue:[],position:0})
  store.takeover('a','first');const result=store.takeover('b','transfer-1')
  assert.equal(result.position,12);assert.ok(result.queueRevision>b.queueRevision)
  assert.throws(()=>store.device('b',{queue:[{id:'stale'}],queueRevision:b.queueRevision}),e=>e.code==='DEVICE_CONFLICT')
  assert.deepEqual(store.takeover('b','transfer-1'),result)
  assert.deepEqual(store.device('b',{queue:[{id:'legacy'}]}).queue,result.queue)
  const fresh=store.device('b',{queue:result.queue,position:14,queueRevision:result.queueRevision})
  assert.equal(fresh.position,14);assert.equal(fresh.queueRevision,result.queueRevision+1)
 }finally{store.close()}
})
test('a device’s own playback events never invalidate its next heartbeat',()=>{
 const store=createStore(':memory:')
 const first=store.device('phone',{queue:[],index:-1,state:'paused'})
 store.device('phone',{...first,queue:[{id:'a'}],index:0,state:'playing'},{selfReport:true})
 assert.doesNotThrow(()=>store.device('phone',{queueRevision:first.queueRevision,queue:[{id:'a'}],index:0,state:'playing'}))
 // Another party changing the queue still requires the device to rejoin.
 const now=store.devices().find(d=>d.id==='phone')
 store.device('phone',{queueRevision:now.queueRevision,queue:[],index:-1})
 assert.throws(()=>store.device('phone',{queueRevision:now.queueRevision,queue:[],index:-1}),e=>e.code==='DEVICE_CONFLICT')
 store.close()
})
