import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {createLoudness,gainFor,parseIntegratedLoudness,TARGET_LUFS} from '../src/loudness.js'

test('gain only attenuates towards the target',()=>{
 assert.equal(gainFor(TARGET_LUFS),1)
 assert.ok(Math.abs(gainFor(-8)-Math.pow(10,-6/20))<1e-9)
 assert.equal(gainFor(-20),1,'quiet tracks are never boosted')
 assert.equal(gainFor(null),1)
})
test('parses the integrated value from the ebur128 summary, not per-frame lines',()=>{
 const log='[Parsed_ebur128_0] t: 1.2 M: -20.1 S: -21.0 I: -30.0 LUFS\n[Parsed_ebur128_0] Summary:\n\n  Integrated loudness:\n    I:          -9.4 LUFS\n    Threshold: -19.6 LUFS\n'
 assert.equal(parseIntegratedLoudness(log),-9.4)
 assert.equal(parseIntegratedLoudness('no summary'),null)
})
test('provider, ReplayGain and measured values are cached per recording and shared',async()=>{
 const db=new Database(':memory:');let calls=0,measured=0
 const l=createLoudness({db,ytres:async()=>{calls++;return {lufs:-8.29}},localUrl:p=>'http://nd/'+p.id,measure:async url=>{measured++;assert.equal(url,'http://nd/local');return -11.5}})
 const yt={kaynak:'youtube',id:'kJQP7kiw5Fk'}
 assert.equal(l.known(yt),undefined)
 const [a,b]=await Promise.all([l.ensure(yt),l.ensure(yt)])
 assert.equal(a,-8.29);assert.equal(b,-8.29);assert.equal(calls,1,'concurrent requests share one lookup')
 assert.equal(l.known(yt),-8.29)
 assert.equal(await l.ensure({kaynak:'kutuphane',id:'tagged',replayGain:{trackGain:-6}}),-12)
 assert.equal(await l.ensure({kaynak:'kutuphane',id:'local'}),-11.5);assert.equal(measured,1)
 assert.equal(await l.ensure({kaynak:'other',id:'x'}),null)
})
test('unknown results are remembered for a week instead of retried on every play',async()=>{
 const db=new Database(':memory:');let t=1_000_000,calls=0
 const l=createLoudness({db,ytres:async()=>{calls++;return {lufs:null}},localUrl:()=>'',now:()=>t})
 const p={kaynak:'youtube',id:'aaaaaaaaaaa'}
 assert.equal(await l.ensure(p),null);assert.equal(l.known(p),null);await l.ensure(p);assert.equal(calls,1)
 t+=8*86400000;assert.equal(l.known(p),undefined);await l.ensure(p);assert.equal(calls,2)
})
