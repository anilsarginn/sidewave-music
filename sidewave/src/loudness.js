import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
const exec=promisify(execFile)

// Volume levelling reference. Clients only ever attenuate towards this target, never boost,
// so loud masters stop jumping out without risking clipping on quiet ones.
export const TARGET_LUFS=-14
export const gainFor=lufs=>Number.isFinite(lufs)?Math.min(1,Math.pow(10,(TARGET_LUFS-lufs)/20)):1

export function parseIntegratedLoudness(text){
  const summary=String(text).split('Summary:').pop()
  const match=summary.match(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/)
  const value=match?Number(match[1]):NaN
  return Number.isFinite(value)&&value>-70&&value<10?value:null
}

/** Integrated loudness per recording, shared by every account (keyed by source and source ID). */
export function createLoudness({db,ytres,localUrl,measure=measureWithFfmpeg,now=Date.now}){
  db.exec('CREATE TABLE IF NOT EXISTS loudness(key TEXT PRIMARY KEY,lufs REAL,method TEXT NOT NULL,measured INTEGER NOT NULL)')
  const keyOf=p=>p?.kaynak&&p?.id?p.kaynak+':'+p.id:null
  const pending=new Map(),queue=[];let running=0
  function known(p){
    const key=keyOf(p);if(!key)return undefined
    const row=db.prepare('SELECT lufs,measured FROM loudness WHERE key=?').get(key)
    // Unknown results are retried after a week; measured values never change.
    if(!row||(row.lufs===null&&now()-row.measured>7*86400000))return undefined
    return row.lufs
  }
  async function fetchOne(p){
    if(p.kaynak==='youtube'){const r=await ytres('/loudness?id='+encodeURIComponent(p.id));return {lufs:Number.isFinite(r?.lufs)?r.lufs:null,method:'provider'}}
    // ReplayGain tags (reference -18 LUFS) avoid decoding the file when present.
    if(Number.isFinite(p.replayGain?.trackGain))return {lufs:-18-p.replayGain.trackGain,method:'replaygain'}
    return {lufs:await measure(localUrl(p)),method:'ebur128'}
  }
  function drain(){
    // Decoding a whole file is CPU work: at most two lookups run at once.
    while(queue.length&&running<2){
      const {p,resolve}=queue.shift();running++
      // The pending entry is cleared before callers resume, so a later retry starts a fresh lookup.
      fetchOne(p).then(r=>{db.prepare('INSERT OR REPLACE INTO loudness VALUES(?,?,?,?)').run(keyOf(p),r.lufs,r.method,now());return r.lufs})
        .catch(()=>null).then(value=>{running--;pending.delete(keyOf(p));resolve(value);drain()})
    }
  }
  function ensure(p){
    const key=keyOf(p);if(!key||!['youtube','kutuphane'].includes(p.kaynak))return Promise.resolve(null)
    const value=known(p);if(value!==undefined)return Promise.resolve(value)
    if(!pending.has(key))pending.set(key,new Promise(resolve=>{queue.push({p,resolve});drain()}))
    return pending.get(key)
  }
  return {known,ensure,keyOf}
}

async function measureWithFfmpeg(url){
  const {stderr}=await exec('ffmpeg',['-nostats','-hide_banner','-i',url,'-map','0:a:0','-af','ebur128=framelog=quiet','-f','null','-'],{timeout:120000,maxBuffer:1<<20})
  return parseIntegratedLoudness(stderr)
}
