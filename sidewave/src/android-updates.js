import { readFile, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { ApiError } from './telemetry.js'

export const ANDROID_PACKAGE='com.sarginlabs.sidewave'
export function createAndroidUpdates(directory,{certificateSha256=process.env.ANDROID_CERTIFICATE_SHA256||''}={}){
  let cached=null,pending=null
  async function load(){
    const path=join(directory,'android-update.json')
    let info
    try{info=await stat(path)}catch{throw new ApiError('UPDATE_NOT_PUBLISHED',"No Android update has been published yet.",404,true)}
    if(info.size>16384)throw new ApiError('INVALID_UPDATE',"Invalid update information.",503,true)
    const raw=await readFile(path,'utf8');let data
    try{data=JSON.parse(raw)}catch{throw new ApiError('INVALID_UPDATE',"Invalid update information.",503,true)}
    const valid=/^[a-f0-9]{64}$/.test(certificateSha256)&&data.packageName===ANDROID_PACKAGE&&data.certificateSha256===certificateSha256
      &&Number.isSafeInteger(data.versionCode)&&data.versionCode>0&&data.versionCode<2147483647
      &&typeof data.versionName==='string'&&data.versionName.length<=60
      &&Number.isSafeInteger(data.minSdk)&&data.minSdk>=29&&data.minSdk<=100
      &&Number.isSafeInteger(data.sizeBytes)&&data.sizeBytes>0&&data.sizeBytes<=250*1024*1024
      &&/^[a-f0-9]{64}$/.test(data.sha256||'')&&data.url===`/downloads/sidewave-${data.versionCode}.apk`
      &&typeof data.notes==='string'&&data.notes.length<=4000&&typeof data.publishedAt==='string'&&Number.isFinite(Date.parse(data.publishedAt))
    if(!valid)throw new ApiError('INVALID_UPDATE',"Update information could not be verified.",503,true)
    const apk=join(directory,`sidewave-${data.versionCode}.apk`);let file
    try{file=await stat(apk)}catch{throw new ApiError('UPDATE_NOT_READY',"The update file is not ready yet.",503,true)}
    const key=[raw,file.ino,file.size,file.mtimeMs,file.ctimeMs].join('|')
    if(cached?.key===key)return cached.data
    if(file.size!==data.sizeBytes)throw new ApiError('INVALID_UPDATE',"The update file is missing or has changed.",503,true)
    const hash=createHash('sha256');for await(const part of createReadStream(apk))hash.update(part)
    if(hash.digest('hex')!==data.sha256)throw new ApiError('INVALID_UPDATE',"The update file could not be verified.",503,true)
    cached={key,data};return data
  }
  return {latest:()=>{if(!pending)pending=load().finally(()=>{pending=null});return pending}}
}
