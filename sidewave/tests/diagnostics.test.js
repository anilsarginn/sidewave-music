import test from 'node:test'
import assert from 'node:assert/strict'
import {Hono} from 'hono'
import Database from 'better-sqlite3'
import {installDiagnostics} from '../src/diagnostics.js'

test('stores crash frames, notifies once per signature per day and lists only for the owner',async()=>{
 const db=new Database(':memory:'),sent=[],app=new Hono();let owner=true
 app.use('*',async(c,next)=>{c.set('member',{id:'m1',username:'anil'});await next()})
 installDiagnostics(app,{db,requireOwner:async(c,next)=>owner?next():c.json({code:'OWNER_ONLY'},403),notify:async t=>{sent.push(t)}})
 const post=body=>app.request('/api/v1/diagnostics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
 const crash={version:'1.9.0',time:1,frames:'java.lang.IllegalStateException\n  at a.b(C.kt:1)',device:'Pixel <7>',sdk:34}
 assert.equal((await post(crash)).status,201);assert.equal((await post(crash)).status,201)
 assert.equal((await post({version:'1.9.0'})).status,400)
 await new Promise(r=>setImmediate(r))
 assert.equal(sent.length,1);assert.match(sent[0],/Pixel &lt;7&gt;/)
 const list=await(await app.request('/api/v1/diagnostics')).json();assert.equal(list.reports.length,2);assert.equal(list.reports[0].version,'1.9.0')
 owner=false;assert.equal((await app.request('/api/v1/diagnostics')).status,403)
})
