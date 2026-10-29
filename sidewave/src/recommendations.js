import {normalize} from './store.js'

// Membership is checked on every response, including cached home snapshots.
// Matching title/artist also suppresses aliases that lack duration metadata.
export function outsidePlaylists(store) {
 const rows=store.db.prepare('SELECT DISTINCT e.track_id,k.key FROM entries e JOIN recording_keys k ON k.track_id=e.track_id').all()
 const ids=new Set(rows.map(r=>r.track_id)),recordings=new Set(rows.map(r=>r.key))
 return p=>!ids.has(p.appId)&&!recordings.has(JSON.stringify([normalize(p.baslik),normalize(p.sanatci)]))
}

// A skip is a "not now" only when the listener heard the track and moved on early. Skips before the
// first sound (rapid Next taps, failed sources, choosing another song) say nothing about taste.
// Older clients did not send a reason; their skips count only once the song had actually played.
const earlySkip=(t='')=>`${t}event='skip' AND ${t}created>? AND COALESCE(json_extract(${t}json,'$.position'),0)>=1 AND COALESCE(json_extract(${t}json,'$.position'),0)<30 AND COALESCE(json_extract(${t}json,'$.reason'),'next') IN ('next','user')`
export function skipSignals(store,{days=7,now=Date.now()}={}){
  const tracks=new Set(store.db.prepare(`SELECT track_id FROM events WHERE ${earlySkip()} GROUP BY track_id HAVING COUNT(*)>=2`).all(now-days*86400000).map(r=>r.track_id))
  // Artists the listener keeps skipping (three or more distinct early skips in two weeks) rank lower.
  const artists=new Map()
  for(const r of store.db.prepare(`SELECT json_extract(k.key,'$[1]') artist,COUNT(DISTINCT e.track_id) n FROM events e JOIN recording_keys k ON k.track_id=e.track_id WHERE ${earlySkip('e.')} GROUP BY artist`).all(now-14*86400000))if(r.artist&&r.n>=3)artists.set(r.artist,r.n)
  return {tracks,artists}
}
// Listening time per artist over the last month, from playback summaries.
export function artistListening(store,{now=Date.now()}={}){
  return new Map(store.db.prepare("SELECT json_extract(k.key,'$[1]') artist,SUM(COALESCE(json_extract(e.json,'$.playedMs'),0)) ms FROM events e JOIN recording_keys k ON k.track_id=e.track_id WHERE e.event='summary' AND e.created>? GROUP BY artist").all(now-30*86400000).filter(r=>r.artist).map(r=>[r.artist,Number(r.ms)||0]))
}

export function rankRecommendations({candidates,favorites,recent,skipped,skippedArtists=new Map(),dismissed,seed,limit=24,listened=new Map(),artistListening=new Map()}){
  const recentIds=new Set(recent.slice(0,20).map(p=>p.appId)),favoriteIds=new Set(favorites.map(p=>p.appId)),affinity=new Map()
  for(const p of favorites){const a=normalize(p.sanatci);affinity.set(a,(affinity.get(a)||0)+3)}
  for(const p of recent.slice(0,20)){const a=normalize(p.sanatci);affinity.set(a,(affinity.get(a)||0)+1)}
  // Minutes actually listened to an artist count, up to the weight of one liked song.
  for(const [a,ms] of artistListening)affinity.set(a,(affinity.get(a)||0)+Math.min(3,ms/600000))
  const favoriteArtists=new Set(favorites.map(p=>normalize(p.sanatci)))
  const penalty=p=>{const a=normalize(p.sanatci),n=skippedArtists.get(a)||0;return favoriteArtists.has(a)?0:Math.min(8,n*2)}
  const seen=new Set(),artists=new Map()
  return candidates.filter(p=>!recentIds.has(p.appId)&&!skipped.has(p.appId)&&!dismissed(p.appId)&&p.appId!==seed?.appId)
    .map((p,index)=>({p:{...p,reason:p.sonicVerified===true?"Similar in sound to your library":p.related?"Inspired by what you’re listening to":favoriteIds.has(p.appId)?"From your liked songs":affinity.has(normalize(p.sanatci))?"From artists you return to":"A fresh find from your library",reasonType:p.sonicVerified===true?'sonic':p.related?'catalog':'personal'},score:(p.sonicVerified?6:0)+Math.min(5,(listened.get(p.appId)||0)/60000)+Math.min(10,affinity.get(normalize(p.sanatci))||0)+(favoriteIds.has(p.appId)?2:0)+(normalize(p.sanatci)===normalize(seed?.sanatci)?3:0)+(p.related?5:0)-penalty(p),index}))
    .sort((a,b)=>b.score-a.score||a.index-b.index).map(x=>x.p)
    .filter(p=>{const key=p.appId||p.kaynak+':'+p.id,a=normalize(p.sanatci),n=artists.get(a)||0;if(seen.has(key)||n>=2)return false;seen.add(key);artists.set(a,n+1);return true}).slice(0,limit)
}
