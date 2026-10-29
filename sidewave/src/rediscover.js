import { randomInt } from 'node:crypto'
import { normalize } from './store.js'

export function rediscoverHistory(store,{pick=randomInt,limit=12}={}) {
 const recent=new Set(store.history(20).map(p=>p.appId)),last=store.setting('rediscoverLast')||[]
 const previous=new Set(last),pool=store.history(500).filter(p=>!recent.has(p.appId)&&!store.isDismissed(p.appId))
 for(let i=pool.length-1;i>0;i--){const j=pick(i+1);[pool[i],pool[j]]=[pool[j],pool[i]]}
 pool.sort((a,b)=>Number(previous.has(a.appId))-Number(previous.has(b.appId)))
 const artists=new Map(),tracks=[]
 for(const p of pool){const artist=normalize(p.sanatci),count=artists.get(artist)||0;if(count>=2)continue;artists.set(artist,count+1);tracks.push(p);if(tracks.length>=limit)break}
 // Small histories may exhaust the pool; still avoid an identical display order.
 if(tracks.length>1&&tracks.every((p,i)=>p.appId===last[i]))tracks.push(tracks.shift())
 store.setting('rediscoverLast',tracks.map(p=>p.appId))
 return tracks.map(p=>({...p,reason:'A familiar sound, worth another listen',reasonType:'history'}))
}
