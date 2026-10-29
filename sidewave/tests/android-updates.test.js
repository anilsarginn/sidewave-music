import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createAndroidUpdates } from '../src/android-updates.js'
const ANDROID_CERTIFICATE='a'.repeat(64)

test('Android release requires an immutable, complete, hashed artifact and expected package/certificate',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'sidewave-update-')),updates=createAndroidUpdates(dir,{certificateSha256:ANDROID_CERTIFICATE}),bytes=Buffer.from('synthetic APK artifact')
 try{
  await assert.rejects(updates.latest(),e=>e.code==='UPDATE_NOT_PUBLISHED')
  const data={packageName:'com.sarginlabs.sidewave',versionCode:4,versionName:'1.2.0',minSdk:29,sizeBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),certificateSha256:ANDROID_CERTIFICATE,url:'/downloads/sidewave-4.apk',notes:'Güncellemeler',publishedAt:new Date().toISOString()}
  const publish=d=>writeFileSync(join(dir,'android-update.json'),JSON.stringify(d));publish(data)
  await assert.rejects(updates.latest(),e=>e.code==='UPDATE_NOT_READY')
  writeFileSync(join(dir,'sidewave-4.apk'),bytes);assert.equal((await updates.latest()).versionCode,4)
  await assert.rejects(createAndroidUpdates(dir,{certificateSha256:''}).latest(),e=>e.code==='INVALID_UPDATE')
  const [a,b]=await Promise.all([updates.latest(),updates.latest()]);assert.deepEqual(a,b)
  for(const change of [{url:'https://untrusted.example/app.apk'},{url:'/downloads/../../other.apk'},{certificateSha256:'0'.repeat(64)},{packageName:'other.app'},{sizeBytes:0},{versionCode:0}]){
   publish({...data,...change});await assert.rejects(updates.latest(),e=>e.code==='INVALID_UPDATE')
  }
  publish(data);writeFileSync(join(dir,'sidewave-4.apk'),Buffer.alloc(bytes.length,0));await assert.rejects(updates.latest(),e=>e.code==='INVALID_UPDATE')
 }finally{rmSync(dir,{recursive:true,force:true})}
})
