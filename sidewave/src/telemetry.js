import { randomUUID } from 'node:crypto'

export class ApiError extends Error {
  constructor(code,message,status=502,retryable=false){super(message);Object.assign(this,{code,status,retryable})}
}
const counters=new Map(),durations=new Map()
const attempts=new Map()
export function startAttempt(id){if(attempts.has(id))return;if(attempts.size>2000)attempts.delete(attempts.keys().next().value);attempts.set(id,{started:Date.now(),streamed:false})}
export function consumeBudget(id){startAttempt(id);const attempt=attempts.get(id);return attempt.streamed?15000:Math.max(0,15000-(Date.now()-attempt.started))}
const label=s=>String(s||'unknown').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,64)
export function count(name,source='unknown',result='ok'){const k=`${name}{source="${label(source)}",result="${label(result)}"}`;counters.set(k,(counters.get(k)||0)+1)}
export function observe(name,source,ms){if(!Number.isFinite(ms)||ms<0||ms>86400000)return;const k=`${name}{source="${label(source)}"}`;const d=durations.get(k)||{sum:0,n:0,buckets:[0,0,0,0,0,0]};d.sum+=ms/1000;d.n++;[.5,1,2,5,10,15].forEach((b,i)=>{if(ms/1000<=b)d.buckets[i]++});durations.set(k,d)}
export function metrics(){const lines=[...counters].map(([k,v])=>`${k} ${v}`);for(const[k,v]of durations){const i=k.indexOf('{'),name=k.slice(0,i),labels=k.slice(i+1,-1);[.5,1,2,5,10,15].forEach((b,j)=>lines.push(`${name}_bucket{${labels},le="${b}"} ${v.buckets[j]}`));lines.push(`${name}_bucket{${labels},le="+Inf"} ${v.n}`,`${name}_sum{${labels}} ${v.sum}`,`${name}_count{${labels}} ${v.n}`)}return lines.join('\n')+'\n'}
export function publicError(e,requestId=randomUUID()){return {code:e.code||'UPSTREAM_ERROR',message:e.status===400?e.message:(e.code?e.message:"Something went wrong. Please try again."),retryable:e.retryable??(!e.status||e.status>=500),requestId}}
export function log(event,fields={}){const safe={};for(const k of ['requestId','source','elapsedMs','status','code','trackId','state'])if(fields[k]!==undefined)safe[k]=fields[k];console.log(JSON.stringify({time:new Date().toISOString(),event,...safe}))}

export function streamStarted(id){const a=attempts.get(id);if(a)a.streamed=true}
