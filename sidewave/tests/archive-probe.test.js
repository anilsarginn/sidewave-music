import {test} from 'node:test'
import assert from 'node:assert/strict'
import {verifyArchiveStream} from '../src/archive-probe.js'
test('verifies ID-addressed audio without assuming virtual Subsonic path exists on disk',async()=>{
 let cancelled=false
 assert.equal(await verifyArchiveStream('http://navidrome.test/stream',undefined,async(_,{headers})=>{
  assert.equal(headers.Range,'bytes=0-1023')
  return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('fLaCdata'))},cancel(){cancelled=true}}),{status:206,headers:{'content-type':'audio/flac'}})
 }),true)
 assert.equal(cancelled,true)
})
test('archive probe rejects empty and disguised provider errors and cancels unread bodies',async()=>{
 for(const [status,mime,body] of [[404,'audio/flac','missing'],[200,'text/html','<html>'],[200,'audio/mpeg','{"error":"missing"}'],[200,'audio/mpeg','']]){
  assert.equal(await verifyArchiveStream('http://navidrome.test/stream',undefined,async()=>new Response(body,{status,headers:{'content-type':mime}})),false)
 }
})
