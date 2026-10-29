import { randomUUID, createHash } from 'node:crypto'
import { writeFile, mkdir, stat, readdir, realpath } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute, sep } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ApiError, count, log } from './telemetry.js'
import { normalize, sameRecording, validTrack } from './store.js'
const exec=promisify(execFile)
const terminal=new Set(['hazir','basarisiz','bulunamadi'])
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
async function probeAudioFile(file){
  const {stdout}=await exec('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type,codec_name','-of','json',file],{timeout:15000,maxBuffer:65536})
  return JSON.parse(stdout)
}

// Verify the selected completed transfer, never the first file sharing its name.
export async function verifyArchiveFile(job,{musicRoot,transfer={},probe=probeAudioFile,sourceDownloadsRoot='/data/downloads'}){
  const downloads=await realpath(join(musicRoot,'downloads')).catch(e=>{if(e.code==='ENOENT')return null;throw e})
  if(!downloads)return null
  const contained=file=>{const rel=relative(downloads,file);return rel!==''&&!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep)}
  const selected=job.selected||{}
  const expectedSize=Number(selected.boyut||transfer.size)
  const durations=[selected.sure,job.parca?.sure].map(Number).filter(n=>Number.isFinite(n)&&n>0)
  if(!Number.isFinite(expectedSize)||expectedSize<=0)throw new ApiError('MISSING_TRANSFER_METADATA',"The selected file’s size could not be verified.",400)
  if(!durations.length&&!job.selectedByUser)return null
  const supplied=transfer.localFilename||transfer.localPath
  let paths=[]
  if(supplied){
    if(typeof supplied!=='string')throw new ApiError('INVALID_FILE',"Invalid archive file location.",400)
    let file=supplied
    // slskd and Sidewave mount the same music directory at /data and /music.
    if(file.startsWith(sourceDownloadsRoot+'/'))file=join(downloads,file.slice(sourceDownloadsRoot.length+1))
    else if(!isAbsolute(file))file=resolve(downloads,file)
    if(!contained(resolve(file)))throw new ApiError('INVALID_FILE',"The archive file is outside the download folder.",400)
    paths=[file]
  }else{
    const collect=async(dir,depth=0)=>{
      if(depth>12)return
      for(const entry of await readdir(dir,{withFileTypes:true})){
        const file=join(dir,entry.name)
        if(entry.isDirectory())await collect(file,depth+1)
        else if(entry.isFile()&&entry.name===selected.dosyaAdi)paths.push(file)
      }
    }
    await collect(downloads)
  }
  const matches=[],visited=new Set();let invalidMedia=false,durationMismatch=false
  for(const file of paths){
    const actual=await realpath(file).catch(e=>{if(e.code==='ENOENT')return null;throw e})
    if(!actual)continue
    if(!contained(actual))throw new ApiError('INVALID_FILE',"The archive file is outside the download folder.",400)
    if(visited.has(actual))continue
    visited.add(actual)
    const info=await stat(actual)
    if(!info.isFile()||info.size!==expectedSize)continue
    let media
    try{media=await probe(actual)}catch(error){
      if(error.code==='ENOENT')throw new ApiError('MEDIA_VERIFY_FAILED',"Audio verification is unavailable.",502,true)
      invalidMedia=true;continue
    }
    const duration=Number(media?.format?.duration),audio=media?.streams?.find(s=>s.codec_type==='audio'&&s.codec_name&&s.codec_name!=='unknown')
    if(!audio||!Number.isFinite(duration)||duration<=0){invalidMedia=true;continue}
    if(durations.some(expected=>Math.abs(expected-duration)>2)){durationMismatch=true;continue}
    matches.push({file:actual,duration,codec:audio.codec_name})
  }
  if(matches.length>1)throw new ApiError('AMBIGUOUS_LOCAL_FILE',"Multiple files have the same name, size and duration. Manual review is needed.",409,false)
  if(matches.length===1)return matches[0]
  if(durationMismatch)throw new ApiError('RECORDING_MISMATCH',"The downloaded file’s duration does not match this recording.",409,false)
  if(invalidMedia)throw new ApiError('INVALID_MEDIA',"No valid audio was found in the downloaded file.",400)
  return null
}

export function createArchive({store,subsonic,slskd,mapSong,soulseekSonuclari,musicRoot,jobsRoot,probeFile=probeAudioFile}){
  const active=new Set();let interval
  const save=(j,patch)=>store.saveJob({...j,...patch})
  async function start(raw){const p=store.upsert(validTrack(raw)),trackKey=p.appId;const old=store.jobs().find(j=>j.trackKey===trackKey&&!['basarisiz','bulunamadi'].includes(j.durum));if(old)return{isId:old.id}
    const j=store.saveJob({id:randomUUID(),trackKey,parca:p,durum:p.kaynak==='kutuphane'?'hazir':'araniyor',mesaj:p.kaynak==='kutuphane'?"Ready in your library":"Finding a source…",createdAt:Date.now()});if(j.durum!=='hazir')void work(j);return{isId:j.id}}
  function candidates(items,p){return items.filter(x=>{const full=normalize(x.klasor+' '+x.dosyaAdi),title=normalize(p.baslik);return title&&full.includes(title)}).map(x=>{
      const name=normalize(x.dosyaAdi),artist=normalize(p.sanatci),full=normalize(x.klasor+' '+x.dosyaAdi)
      const version=['live','remix','cover','akustik','acoustic','instrumental'].every(w=>name.includes(w)===normalize(p.baslik).includes(w))
      const reliable=artist&&full.includes(artist)&&version&&Number(p.sure)>0&&Number(x.sure)>0&&Math.abs(p.sure-x.sure)<=2
      return {...x,candidateId:createHash('sha256').update(x.kullanici+'|'+x.tamYol).digest('hex').slice(0,20),reliable}
    }).sort((a,b)=>Number(b.reliable)-Number(a.reliable)||Number(b.bosSlot)-Number(a.bosSlot)||(b.bitrate||0)-(a.bitrate||0)).slice(0,12)}
  async function select(id,candidateId){let j=store.getJob(id);if(!j||j.durum!=='eslesme_bekliyor')throw new ApiError('JOB_CONFLICT',"This download is not awaiting a match.",409);const c=j.candidates?.find(c=>c.candidateId===candidateId);if(!c)throw new ApiError('INVALID_CANDIDATE',"No match found.",400);j=save(j,{selected:c,selectedByUser:true,durum:'indirme_baslatiliyor',mesaj:"Preparing download…"});void work(j);return j}
  async function files(){const d=await slskd('/transfers/downloads');return(d||[]).flatMap(u=>(u.directories||[]).flatMap(dir=>(dir.files||[]).map(f=>({...f,username:u.username}))))}
  async function verifyFile(j,transfer){
    const verified=await verifyArchiveFile(j,{musicRoot,transfer,probe:probeFile})
    if(!verified)return null
    await mkdir(jobsRoot,{recursive:true});await writeFile(join(jobsRoot,'import.request'),String(Date.now()))
    return verified
  }
  async function libraryMatch(j){const r=await subsonic('search3.view',{query:j.parca.baslik,songCount:50,albumCount:0,artistCount:0});return(r.searchResult3?.song||[]).map(mapSong).find(p=>sameRecording(j.parca,p))}
  async function work(initial){if(active.has(initial.id)||terminal.has(initial.durum)||initial.durum==='eslesme_bekliyor')return;active.add(initial.id)
    try{let j=store.getJob(initial.id)
      if(Date.now()-j.createdAt>24*3600000){save(j,{durum:'basarisiz',mesaj:"The download timed out. Please try again."});return}
      if(j.durum==='araniyor'){
        if(!j.searchId){const r=await slskd('/searches',{method:'POST',body:JSON.stringify({searchText:[j.parca.sanatci,j.parca.baslik].filter(Boolean).join(' ').slice(0,120)})});j=save(j,{searchId:r.id})}
        let found=[];for(let i=0;i<15;i++){const r=await slskd(`/searches/${j.searchId}?includeResponses=true`);found=soulseekSonuclari(r);if(String(r.state).includes('Completed'))break;await sleep(2000)}
        const choices=candidates(found,j.parca);if(!choices.length){save(j,{durum:'bulunamadi',mesaj:"No suitable download source was found."});return}
        const reliable=choices.filter(c=>c.reliable);if(!reliable.length){save(j,{durum:'eslesme_bekliyor',mesaj:"Choose the correct recording.",candidates:choices});return}
        j=save(j,{durum:'indirme_baslatiliyor',selected:reliable[0],candidates:choices})
      }
      if(j.durum==='indirme_baslatiliyor'){
        const existing=(await files()).find(f=>f.username===j.selected.kullanici&&f.filename===j.selected.tamYol&&!String(f.state).match(/Failed|Errored|Rejected|Cancelled/))
        if(!existing)await slskd('/transfers/downloads/'+encodeURIComponent(j.selected.kullanici),{method:'POST',body:JSON.stringify([{filename:j.selected.tamYol,size:j.selected.boyut}])})
        j=save(j,{durum:'indiriliyor',mesaj:"Downloading file…"})
      }
      if(['indiriliyor','dogrulaniyor'].includes(j.durum)){
        const f=(await files()).find(f=>f.username===j.selected.kullanici&&f.filename===j.selected.tamYol)
        if(f&&/Failed|Errored|Rejected|Cancelled/.test(f.state)){save(j,{durum:'basarisiz',mesaj:"Could not download this file. Please try again."});return}
        if(!String(f?.state).includes('Succeeded'))return
        j=save(j,{durum:'dogrulaniyor',mesaj:"Verifying audio…"})
        const ready=await libraryMatch(j);if(ready){store.upsert(ready);save(j,{durum:'hazir',mesaj:"Ready in your library",localTrack:ready});return}
        const verified=await verifyFile(j,f);if(!verified)return
        if(j.selectedByUser&&!(Number(j.parca.sure)>0)){
          const parca={...j.parca,sure:verified.duration};store.upsert(parca);j=save(j,{parca})
        }
        j=save(j,{verifiedFile:{duration:verified.duration,codec:verified.codec},durum:'ice_aktariliyor',mesaj:"Adding to your library…",importStartedAt:Date.now()})
      }
      if(j.durum==='ice_aktariliyor'){
        await subsonic('startScan.view');const ready=await libraryMatch(j)
        if(ready){const local=store.upsert(ready);save(j,{durum:'hazir',mesaj:"Ready in your library",localTrack:local});count('sidewave_archive_total','local','ready')}
        else if(Date.now()-j.importStartedAt>30*60000)save(j,{durum:'basarisiz',mesaj:"Download complete, but the library match could not be verified. Manual review is needed."})
      }
    }catch(e){const j=store.getJob(initial.id);log('archive_failed',{code:e.code||'ARCHIVE_ERROR',trackId:j.trackKey});if(e.retryable===false||e.status===400)save(j,{durum:'basarisiz',mesaj:e.message});else save(j,{mesaj:"Waiting for the source. This download will retry."})}finally{active.delete(initial.id)}
  }
  function run(){const tick=()=>{for(const j of store.jobs().filter(j=>!terminal.has(j.durum)&&j.durum!=='eslesme_bekliyor').slice(0,3))void work(j)};interval=setInterval(()=>{if(store.forAccounts)void store.forAccounts(tick);else tick()},20000);interval.unref();tick()}
  return {start,select,run,stop:()=>clearInterval(interval)}
}
