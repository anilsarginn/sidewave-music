import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createStore} from '../src/store.js'
import {createImportJobs} from '../src/import-jobs.js'
const wait=ms=>new Promise(r=>setTimeout(r,ms))
test('large previews return promptly, process every row with two workers, and persist progress',async()=>{
 const store=createStore(':memory:');let active=0,max=0,count=0
 const jobs=createImportJobs(store,async q=>{active++;max=Math.max(max,active);await wait(1);count++;active--;return{parcalar:[{id:q,baslik:q,sanatci:'',kaynak:'youtube'}]}})
 const start=performance.now(),job=jobs.start(Array.from({length:120},(_,i)=>'Song '+i).join('\n'),'text');assert.ok(performance.now()-start<100);assert.equal(job.total,120);assert.equal(job.pending,true)
 for(let i=0;i<1000&&jobs.get(job.jobId).pending;i++)await wait(5)
 const result=jobs.get(job.jobId);assert.equal(result.completed,120);assert.equal(count,120);assert.equal(max,2);assert.ok(result.rows.every(r=>r.status==='matched'));jobs.stop();store.close()
})
test('cancel aborts in-flight source work and never overwrites cancelled state',async()=>{
 const store=createStore(':memory:');let signal
 const jobs=createImportJobs(store,async(q,opts)=>{signal=opts.signal;await wait(25);return{parcalar:[]}})
 const job=jobs.start('One\nTwo\nThree');jobs.cancel(job.jobId);assert.equal(signal.aborted,true);await wait(40)
 assert.equal(jobs.get(job.jobId).pending,false);assert.equal(jobs.get(job.jobId).cancelled,true);jobs.stop();store.close()
})
test('restart resumes older pending jobs even when newer previews are completed',async()=>{
 const store=createStore(':memory:')
 const first=createImportJobs(store,async()=>{await wait(30);return{parcalar:[]}}),old=first.start('Older')
 first.stop();await wait(35)
 for(let i=0;i<3;i++)store.db.prepare('INSERT INTO import_jobs VALUES(?,?,?)').run('complete'+i,JSON.stringify({jobId:'complete'+i,pending:false,rows:[]}),Date.now()+i+1)
 let searched=0;const resumed=createImportJobs(store,async()=>{searched++;return{parcalar:[]}});resumed.resume()
 for(let i=0;i<20&&resumed.get(old.jobId).pending;i++)await wait(5)
 assert.equal(searched,1);assert.equal(resumed.get(old.jobId).pending,false);resumed.stop();store.close()
})
