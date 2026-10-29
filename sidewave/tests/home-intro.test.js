import test from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { createStore } from '../src/store.js'
import { createMembership } from '../src/membership.js'
import { greetingWindow, installHomeIntro, PHILOSOPHER_QUOTES } from '../src/home-intro.js'

test('Istanbul morning/noon/evening/night boundaries and a night spanning midnight',()=>{
 const at=time=>greetingWindow(Date.parse('2026-10-21T'+time+'+03:00'))
 assert.equal(at('05:59:59').key,'2026-10-20:night')
 assert.equal(at('06:00:00').greeting,'Good morning')
 assert.equal(at('11:59:59').greeting,'Good morning')
 assert.equal(at('12:00:00').greeting,'Good afternoon')
 assert.equal(at('18:00:00').greeting,'Good evening')
 assert.equal(at('22:00:00').greeting,'Good night')
 assert.equal(at('22:00:00').key,greetingWindow(Date.parse('2026-10-22T02:00:00+03:00')).key)
})
test('one greeting per period, idempotent requests, a full quote bag without repeats, and persistence',async()=>{
 const store=createStore(':memory:'),app=new Hono();app.onError((e,c)=>c.json({message:e.message},e.status||500));let clock=Date.parse('2026-10-21T08:00:00+03:00')
 try {
  const {visit}=installHomeIntro(app,{store,now:()=>clock,pick:n=>n-1})
  const first=visit('first-visit');assert.equal(first.kind,'greeting');assert.deepEqual(visit('first-visit'),first)
  const quotes=Array.from({length:PHILOSOPHER_QUOTES.length},(_,i)=>visit('quote-'+i))
  assert.ok(quotes.every(q=>q.kind==='quote'&&q.quote.source.startsWith('https://')))
  assert.equal(new Set(quotes.map(q=>q.quote.id)).size,PHILOSOPHER_QUOTES.length)
  assert.notEqual(visit('after-cycle').quote.id,quotes.at(-1).quote.id)
  // A new service instance reads the durable per-account state.
  const restarted=installHomeIntro(new Hono(),{store,now:()=>clock})
  assert.equal(restarted.visit('reload').kind,'quote')
  clock=Date.parse('2026-10-21T12:00:00+03:00')
  assert.equal(visit('noon').greeting,'Good afternoon');assert.equal(visit('noon-reload').kind,'quote')
  const malformed=await app.request('/api/v1/home/intro',{method:'POST',body:'{}',headers:{'Content-Type':'application/json'}})
  assert.equal(malformed.status,400)
 }finally{store.close()}
})
test('accounts claim greetings independently and concurrent tabs never consume the same greeting',async()=>{
 const base=createStore(':memory:'),membership=createMembership(base,':memory:'),app=new Hono()
 try{
  for(const id of ['one','two'])base.db.prepare('INSERT INTO members(id,username,username_key,password_hash,created,legacy_owner) VALUES(?,?,?,?,?,0)').run(id,id,id,'hash',Date.now())
  const {visit}=installHomeIntro(app,{store:membership.store})
  const results=await Promise.all(['one','one','two'].map((id,i)=>membership.context.run(id,async()=>visit('visit-'+i))))
  assert.deepEqual(results.map(r=>r.kind),['greeting','quote','greeting'])
 }finally{membership.stop();base.close()}
})
