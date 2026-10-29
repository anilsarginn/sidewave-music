import {ApiError} from './telemetry.js'

/** Only for two Navidrome catalogs that mount the SAME read-only music directory.
 * New scanner/PID versions can assign different IDs. Never match titles or basenames.
 */
export function mediaIdentity(song) {
 if(typeof song?.path!=='string'||!song.path||!Number.isFinite(Number(song.size))||Number(song.size)<=0||!Number.isFinite(Number(song.duration))||Number(song.duration)<=0)return null
 return JSON.stringify([song.path,Number(song.size),Number(song.duration)])
}
export function createSonicCatalogBridge({subsonic,sonicSubsonic,replica=false}) {
 let cache=null,inflight=null
 async function inventory(call,signal) {
  const albums=[]
  for(let offset=0;offset<10000;offset+=500){const r=await call('getAlbumList2.view',{type:'alphabeticalByName',size:500,offset},signal),page=r.albumList2?.album||[];albums.push(...page);if(page.length<500)break;if(offset===9500)throw new Error('pilot catalog limit')}
  const songs=[],remaining=[...albums]
  await Promise.all(Array.from({length:Math.min(4,albums.length)},async()=>{while(remaining.length){const a=remaining.shift();const r=await call('getAlbum.view',{id:a.id},signal);songs.push(...(r.album?.song||[]))}}))
  return songs
 }
 function uniqueByKey(songs) {
  const result=new Map()
  for(const s of songs){const key=mediaIdentity(s);if(!key)continue;if(result.has(key))result.set(key,null);else result.set(key,s)}
  return result
 }
 async function mappings(signal) {
  if(cache && cache.until>Date.now())return cache
  if(!inflight)inflight=(async()=>{
   const deadline=AbortSignal.timeout(9000)
   const [local,sonic]=await Promise.all([inventory(subsonic,deadline),inventory(sonicSubsonic,deadline)])
   const l=uniqueByKey(local),r=uniqueByKey(sonic),to=new Map(),from=new Map(),artistsTo=new Map(),artistsFrom=new Map()
   const add=(map,key,value)=>{if(key&&value){const values=map.get(key)||new Set();values.add(value);map.set(key,values)}}
   for(const [key,a] of l){const b=r.get(key);if(!a||!b)continue;to.set(a.id,b.id);from.set(b.id,a.id);add(artistsTo,a.artistId,b.artistId);add(artistsFrom,b.artistId,a.artistId)}
   const unique=map=>new Map([...map].filter(([,values])=>values.size===1).map(([id,values])=>[id,[...values][0]]))
   // The library changes only when music is imported; ten minutes keeps lookups cheap.
   cache={to,from,artistsTo:unique(artistsTo),artistsFrom:unique(artistsFrom),until:Date.now()+600000};return cache
  })().finally(()=>{inflight=null})
  if(!signal)return inflight
  signal.throwIfAborted()
  let listener
  try{return await Promise.race([inflight,new Promise((_,reject)=>{listener=()=>reject(signal.reason);signal.addEventListener('abort',listener,{once:true})})])}
  finally{if(listener)signal.removeEventListener('abort',listener)}
 }
 async function lookup(direction,id,signal,required=true){if(!replica)return id;const map=await mappings(signal),value=map[direction].get(id);if(!value&&required)throw new ApiError('SONIC_SOURCE_MISMATCH',"This recording has not been matched to the same file in the analysis catalog yet.",409,true);return value||null}
 return {toTrack:(id,signal)=>lookup('to',id,signal),fromTrack:(id,signal)=>lookup('from',id,signal,false),toArtist:(id,signal)=>lookup('artistsTo',id,signal),fromArtist:(id,signal)=>lookup('artistsFrom',id,signal,false)}
}
