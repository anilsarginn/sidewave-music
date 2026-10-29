import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createStore} from '../src/store.js'
import {createAnalysisJobs} from '../src/analysis-jobs.js'
test('archive analysis submissions persist, coalesce and retry a busy provider without marking ready',async()=>{
 const store=createStore(':memory:');let calls=0,busy=true,release
 const jobs=createAnalysisJobs({store,enabled:true,scan:async()=>{},enqueue:async()=>{calls++;if(busy)throw Error('busy');await new Promise(r=>{release=r});return{task_id:'analysis-1'}}})
 try{
  assert.equal((await jobs.tick()).state,'idle')
  store.saveJob({id:'archive-1',trackKey:'song-1',durum:'hazir',localTrack:{id:'song-1'}})
  assert.equal((await jobs.tick()).state,'waiting');assert.equal(store.setting('sonicSubmittedJobs'),null)
  busy=false;const request=jobs.tick();await new Promise(r=>setImmediate(r));assert.equal((await jobs.tick()).state,'busy');release();assert.equal((await request).state,'submitted')
  assert.equal((await jobs.tick()).state,'idle');assert.equal(calls,2)
  assert.deepEqual(store.setting('sonicSubmittedJobs'),['archive-1'])
  assert.equal(store.getJob('archive-1').durum,'hazir')
 }finally{jobs.stop();store.close()}
})
