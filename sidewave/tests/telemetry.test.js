import {test} from 'node:test'
import assert from 'node:assert/strict'
import {startAttempt,consumeBudget,streamStarted} from '../src/telemetry.js'
test('source retries preserve the original deadline while later seeks have a separate budget',()=>{
 const real=Date.now;let clock=1000;Date.now=()=>clock
 try{startAttempt('deadline-test');clock+=9000;assert.equal(consumeBudget('deadline-test'),6000);startAttempt('deadline-test');clock+=6001;assert.equal(consumeBudget('deadline-test'),0);streamStarted('deadline-test');clock+=100000;assert.equal(consumeBudget('deadline-test'),15000)}finally{Date.now=real}
})
