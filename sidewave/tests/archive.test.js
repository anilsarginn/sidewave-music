import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,mkdir,writeFile,rm,symlink,readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createArchive,verifyArchiveFile } from '../src/archive.js'
import { createStore } from '../src/store.js'

const media=duration=>({streams:[{codec_type:'audio',codec_name:'flac'}],format:{duration:String(duration)}})
async function fixture(t){
 const musicRoot=await mkdtemp(join(tmpdir(),'sidewave-archive-'))
 await mkdir(join(musicRoot,'downloads'),{recursive:true})
 t.after(()=>rm(musicRoot,{recursive:true,force:true}))
 const file=async(dir,size=8)=>{await mkdir(join(musicRoot,'downloads',dir),{recursive:true});const path=join(musicRoot,'downloads',dir,'Song.flac');await writeFile(path,Buffer.alloc(size));return path}
 const job={selected:{dosyaAdi:'Song.flac',boyut:8,sure:200},parca:{baslik:'Song',sanatci:'Artist',sure:200}}
 return{musicRoot,file,job}
}

test('verifier examines all basename matches instead of choosing the first',async t=>{
 const{musicRoot,file,job}=await fixture(t)
 await file('a-wrong-size',3);await file('b-wrong-duration');const expected=await file('c-correct')
 const verified=await verifyArchiveFile(job,{musicRoot,probe:async path=>media(path.includes('wrong-duration')?240:200)})
 assert.equal(verified.file,expected);assert.equal(verified.duration,200);assert.equal(verified.codec,'flac')
})
test('multiple size and duration matches are ambiguous and never imported',async t=>{
 const{musicRoot,file,job}=await fixture(t);await file('a');await file('b')
 await assert.rejects(verifyArchiveFile(job,{musicRoot,probe:async()=>media(200)}),e=>e.code==='AMBIGUOUS_LOCAL_FILE'&&e.retryable===false)
})
test('exact transfer path wins and maps the slskd mount correctly',async t=>{
 const{musicRoot,file,job}=await fixture(t);await file('a');const expected=await file('b');let probed=[]
 const verified=await verifyArchiveFile(job,{musicRoot,transfer:{localFilename:'/data/downloads/b/Song.flac'},probe:async path=>{probed.push(path);return media(200)}})
 assert.equal(verified.file,expected);assert.deepEqual(probed,[expected])
})
test('missing exact transfer path never silently selects a different same-name file',async t=>{
 const{musicRoot,file,job}=await fixture(t);await file('another-download')
 assert.equal(await verifyArchiveFile(job,{musicRoot,transfer:{localFilename:'/data/downloads/missing/Song.flac'},probe:async()=>assert.fail('must not probe unrelated file')}),null)
})
test('traversal, symlinks outside downloads and files elsewhere in music are rejected',async t=>{
 const{musicRoot,job}=await fixture(t);const outside=join(musicRoot,'unrelated.flac');await writeFile(outside,Buffer.alloc(8))
 await symlink(outside,join(musicRoot,'downloads','link.flac'))
 for(const localFilename of [outside,'../unrelated.flac',join(musicRoot,'downloads','link.flac')]){
  await assert.rejects(verifyArchiveFile(job,{musicRoot,transfer:{localFilename},probe:async()=>media(200)}),e=>e.code==='INVALID_FILE')
 }
})
test('audio codec, finite duration and expected recording duration are verified',async t=>{
 const{musicRoot,file,job}=await fixture(t);await file('only')
 for(const invalid of [{streams:[],format:{duration:200}},media(0),media(NaN),{streams:[{codec_type:'audio',codec_name:'unknown'}],format:{duration:200}}]){
  await assert.rejects(verifyArchiveFile(job,{musicRoot,probe:async()=>invalid}),e=>e.code==='INVALID_MEDIA')
 }
 await assert.rejects(verifyArchiveFile(job,{musicRoot,probe:async()=>media(240)}),e=>e.code==='RECORDING_MISMATCH')
})
test('unknown duration is accepted only after explicit candidate confirmation',async t=>{
 const{musicRoot,file,job}=await fixture(t);await file('only');delete job.parca.sure;delete job.selected.sure
 assert.equal(await verifyArchiveFile(job,{musicRoot,probe:async()=>assert.fail('unconfirmed file')}),null)
 job.selectedByUser=true
 const verified=await verifyArchiveFile(job,{musicRoot,probe:async()=>media(201.75)})
 assert.equal(verified.duration,201.75)
})
test('confirmed file duration enriches missing source duration without changing title or artist',async t=>{
 const{musicRoot,file}=await fixture(t);const localFilename=await file('selected')
 const store=createStore(':memory:');t.after(()=>store.close())
 const source=store.upsert({id:'aaaaaaaaaaa',kaynak:'youtube',baslik:'Song (Live)',sanatci:'Artist'})
 const candidate={candidateId:'candidate',dosyaAdi:'Song.flac',boyut:8,kullanici:'peer',tamYol:'Artist\\Song.flac'}
 store.saveJob({id:'job',trackKey:source.appId,parca:source,durum:'eslesme_bekliyor',candidates:[candidate],createdAt:Date.now()})
 let scanned=false
 const archive=createArchive({store,musicRoot,jobsRoot:join(musicRoot,'jobs'),mapSong:p=>p,soulseekSonuclari:()=>[],probeFile:async()=>media(201.75),
  slskd:async()=>[{username:'peer',directories:[{files:[{filename:candidate.tamYol,size:8,state:'Completed, Succeeded',localFilename}]}]}],
  subsonic:async endpoint=>{if(endpoint==='startScan.view'){scanned=true;return{}}return{searchResult3:{song:scanned?[{id:'local',kaynak:'kutuphane',baslik:'Song (Live)',sanatci:'Artist',sure:202}]:[]}}},
 })
 await archive.select('job','candidate')
 for(let i=0;i<100&&store.getJob('job').durum!=='hazir';i++)await new Promise(r=>setTimeout(r,5))
 const result=store.getJob('job')
 assert.equal(result.durum,'hazir');assert.equal(result.selectedByUser,true);assert.equal(result.parca.sure,201.75)
 assert.equal(result.parca.baslik,'Song (Live)');assert.equal(result.parca.sanatci,'Artist')
 assert.equal(result.localTrack.appId,source.appId)
 assert.ok(await readFile(join(musicRoot,'jobs','import.request'),'utf8'))
})
