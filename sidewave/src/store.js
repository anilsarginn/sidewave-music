import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createCatalog } from './catalog.js'

export function normalize(value) {
  return String(value || '').toLocaleLowerCase('tr').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, ' ').trim()
}
export function sameRecording(a, b) {
  if(a.kaynak && a.kaynak===b.kaynak && a.sanatciId && b.sanatciId && a.sanatciId!==b.sanatciId)return false
  // Preserve live/remix/cover/version words; never equate different performances.
  return !!a.sanatci && !!b.sanatci && normalize(a.baslik) === normalize(b.baslik)
    && normalize(a.sanatci) === normalize(b.sanatci)
    && Number(a.sure) > 0 && Number(b.sure) > 0 && Math.abs(a.sure - b.sure) <= 2
}
const recordingKey=p=>JSON.stringify([normalize(p.baslik),normalize(p.sanatci)])
export function validTrack(p) {
  if (!p || typeof p.id !== 'string' || !p.id || p.id.length > 256 || typeof p.baslik !== 'string' || !p.baslik.trim()
    || !['youtube', 'kutuphane'].includes(p.kaynak)) throw Object.assign(new Error("A valid track is required."), {status:400,code:'INVALID_TRACK'})
  if(!p.sanatciId&&Array.isArray(p.sanatcilar))p={...p,sanatciId:p.sanatcilar.find(a=>a.id)?.id}
  const allowed=['id','baslik','sanatci','album','sure','kaynak','kapakId','kapak','kapakUrl','sanatciId','albumId','bicim','bitrate','parcaNo','disk','yil','sanatcilar']
  return Object.fromEntries(allowed.filter(k=>p[k] != null).map(k=>[k,typeof p[k]==='string'?p[k].slice(0,2000):p[k]]))
}
export function createStore(path) {
  if(path !== ':memory:') mkdirSync(dirname(path),{recursive:true})
  const db=new Database(path)
  db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON'); db.pragma('busy_timeout = 5000')
  db.exec(`CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tracks(id TEXT PRIMARY KEY,json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sources(source TEXT NOT NULL,source_id TEXT NOT NULL,track_id TEXT NOT NULL REFERENCES tracks(id),json TEXT NOT NULL,PRIMARY KEY(source,source_id));
    CREATE TABLE IF NOT EXISTS favorites(track_id TEXT PRIMARY KEY REFERENCES tracks(id),created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS playlists(id TEXT PRIMARY KEY,name TEXT NOT NULL,created INTEGER NOT NULL,origin TEXT UNIQUE);
    CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY,playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,track_id TEXT NOT NULL REFERENCES tracks(id),position INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,device_id TEXT,event TEXT NOT NULL,track_id TEXT,request_id TEXT,created INTEGER NOT NULL,json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS events_created ON events(created);
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,track_key TEXT NOT NULL,state TEXT NOT NULL,json TEXT NOT NULL,updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,json TEXT NOT NULL,updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS dismissed(track_id TEXT PRIMARY KEY REFERENCES tracks(id));
    INSERT OR IGNORE INTO migrations VALUES(1,datetime('now'));`)
  // Keep the original tracks table shape compatible with older rollback images.
  // An indexed side table avoids scanning every recording for each bulk-import item.
  db.exec(`CREATE TABLE IF NOT EXISTS recording_keys(track_id TEXT PRIMARY KEY REFERENCES tracks(id),key TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS recording_keys_key ON recording_keys(key);
    CREATE INDEX IF NOT EXISTS entries_playlist_position ON entries(playlist_id,position);
    CREATE TABLE IF NOT EXISTS dismissed_artists(artist TEXT PRIMARY KEY,label TEXT NOT NULL,created INTEGER NOT NULL);`)
  db.transaction(()=>{
    for(const r of db.prepare('SELECT id,json FROM tracks').all())db.prepare('INSERT INTO recording_keys VALUES(?,?) ON CONFLICT(track_id) DO UPDATE SET key=excluded.key').run(r.id,recordingKey(JSON.parse(r.json)))
    db.prepare("INSERT OR IGNORE INTO migrations VALUES(5,datetime('now'))").run()
  })()
  const catalog=createCatalog(db)
  function getTrack(id) {
    const r=db.prepare('SELECT json FROM tracks WHERE id=?').get(id);if(!r)return null
    return {...JSON.parse(r.json),appId:id,favori:!!db.prepare('SELECT 1 FROM favorites WHERE track_id=?').get(id)}
  }
  const upsert=db.transaction(raw=>{
    const p=validTrack(raw)
    const source=db.prepare('SELECT track_id FROM sources WHERE source=? AND source_id=?').get(p.kaynak,p.id)
    let id=source?.track_id
    if(!id){
      const candidates=db.prepare('SELECT t.id,t.json FROM tracks t JOIN recording_keys k ON k.track_id=t.id WHERE k.key=?').all(recordingKey(p)).filter(r=>sameRecording(JSON.parse(r.json),p))
      id=candidates.length===1?candidates[0].id:randomUUID()
    }
    const prior=getTrack(id)
    const preferred=prior?.kaynak==='kutuphane'&&p.kaynak!=='kutuphane'?prior:p
    db.prepare('INSERT INTO tracks VALUES(?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(id,JSON.stringify(preferred))
    db.prepare('INSERT INTO recording_keys VALUES(?,?) ON CONFLICT(track_id) DO UPDATE SET key=excluded.key').run(id,recordingKey(preferred))
    db.prepare('INSERT INTO sources VALUES(?,?,?,?) ON CONFLICT(source,source_id) DO UPDATE SET json=excluded.json').run(p.kaynak,p.id,id,JSON.stringify(p))
    catalog.credit(id,p)
    return getTrack(id)
  })
  function resolveTrack(p){return upsert(p)}
  function favorite(p,yes){const t=upsert(p);if(yes)db.prepare('INSERT OR IGNORE INTO favorites VALUES(?,?)').run(t.appId,Date.now());else db.prepare('DELETE FROM favorites WHERE track_id=?').run(t.appId);return getTrack(t.appId)}
  function list(id){const p=db.prepare('SELECT * FROM playlists WHERE id=?').get(id);if(!p)return null
    const parcalar=db.prepare('SELECT * FROM entries WHERE playlist_id=? ORDER BY position,rowid').all(id).map(e=>({...getTrack(e.track_id),entryId:e.id}))
    return {id:p.id,ad:p.name,parcalar,parcaSayisi:parcalar.length,sure:parcalar.reduce((n,p)=>n+(Number(p.sure)||0),0)}
  }
  function createList(name,origin=null){if(typeof name!=='string'||!name.trim()||name.length>200)throw Object.assign(new Error("Playlist names must be 1–200 characters."),{status:400,code:'INVALID_NAME'})
    if(origin){const old=db.prepare('SELECT id FROM playlists WHERE origin=?').get(origin);if(old)return old.id}
    const id=randomUUID();db.prepare('INSERT INTO playlists VALUES(?,?,?,?)').run(id,name.trim(),Date.now(),origin);return id}
  const add=db.transaction((id,tracks)=>{if(!list(id))throw Object.assign(new Error("Playlist not found."),{status:404})
    let pos=db.prepare('SELECT COALESCE(MAX(position),-1) AS n FROM entries WHERE playlist_id=?').get(id).n+1
    for(const raw of tracks){const p=upsert(raw);db.prepare('INSERT INTO entries VALUES(?,?,?,?)').run(randomUUID(),id,p.appId,pos++)}return list(id)})
  const updateList=db.transaction((id,{ad,entryIds})=>{if(!list(id))throw Object.assign(new Error("Playlist not found."),{status:404})
    if(ad!==undefined){if(typeof ad!=='string'||!ad.trim()||ad.length>200)throw Object.assign(new Error("Invalid playlist name."),{status:400});db.prepare('UPDATE playlists SET name=? WHERE id=?').run(ad.trim(),id)}
    if(entryIds){const current=list(id).parcalar.map(p=>p.entryId);if(!Array.isArray(entryIds)||entryIds.length!==current.length||new Set(entryIds).size!==current.length||entryIds.some(x=>!current.includes(x)))throw Object.assign(new Error("This playlist has changed. Refresh and try again."),{status:409,code:'LIST_CONFLICT'})
      entryIds.forEach((e,i)=>db.prepare('UPDATE entries SET position=? WHERE id=? AND playlist_id=?').run(i,e,id))}return list(id)})
  function setting(key,value){if(value===undefined){const r=db.prepare('SELECT json FROM settings WHERE key=?').get(key);return r?JSON.parse(r.json):null}db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json').run(key,JSON.stringify(value));return value}
  function event(e){const p=e.parca?upsert(e.parca):null;const id=typeof e.id==='string'?e.id:randomUUID();const occurred=Number(e.occurredAt);const created=Number.isFinite(occurred)&&occurred>0?Math.min(occurred,Date.now()):Date.now();db.prepare('INSERT OR IGNORE INTO events VALUES(?,?,?,?,?,?,?)').run(id,e.deviceId||null,e.event,p?.appId||e.trackId||null,e.requestId||null,created,JSON.stringify({...e,parca:undefined,queue:undefined}));return id}
  function history(limit=50){return db.prepare("SELECT track_id,MAX(created) AS last FROM events WHERE event='playing' AND track_id IS NOT NULL GROUP BY track_id ORDER BY last DESC LIMIT ?").all(limit).map(x=>getTrack(x.track_id)).filter(Boolean)}
  function saveJob(j){const next={...j,updatedAt:Date.now()};db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,json=excluded.json,updated=excluded.updated').run(j.id,j.trackKey,j.durum,JSON.stringify(next),next.updatedAt);return next}
  function getJob(id){const j=db.prepare('SELECT json FROM jobs WHERE id=?').get(id);return j?JSON.parse(j.json):null}
  function jobs(){return db.prepare('SELECT json FROM jobs ORDER BY updated DESC LIMIT 200').all().map(r=>JSON.parse(r.json))}
  // selfReport: playback events from the device itself. They refresh its state without bumping the
  // revision, otherwise the device's own next heartbeat would conflict with its own event.
  function device(id,d,{selfReport=false}={}){
    const row=db.prepare('SELECT json FROM devices WHERE id=?').get(id),prior=row?JSON.parse(row.json):null
    const revision=prior?.queueRevision||0
    if(d.queueRevision!==undefined&&d.queueRevision!==revision)throw Object.assign(new Error("This device’s queue has changed. Please refresh."),{status:409,code:'DEVICE_CONFLICT'})
    // Legacy clients cannot overwrite a newly transferred queue until they acknowledge its revision.
    if(prior?.handoffCommandId&&d.queueRevision===undefined)return prior
    const queue=Array.isArray(d.queue)?d.queue.slice(0,1000):[]
    const next={id,name:String(d.name||'Cihaz').slice(0,80),queue,index:Math.max(-1,Number(d.index)||0),position:Number.isFinite(Number(d.position))?Math.max(0,Number(d.position)):0,state:String(d.state||'paused'),queueRevision:selfReport?revision:revision+1,handoffCommandId:prior?.handoffCommandId||null,updatedAt:Date.now()}
    db.prepare('INSERT INTO devices VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json,updated=excluded.updated').run(id,JSON.stringify(next),next.updatedAt);return next
  }
  function devices(){return db.prepare('SELECT json FROM devices ORDER BY updated DESC LIMIT 20').all().map(r=>({...JSON.parse(r.json),online:Date.now()-JSON.parse(r.json).updatedAt<20000}))}
  const takeover=db.transaction((id,commandId)=>{
    if(commandId!==undefined&&(typeof commandId!=='string'||!/^[-\w]{1,100}$/.test(commandId)))throw Object.assign(new Error("Invalid handoff command."),{status:400,code:'INVALID_COMMAND'})
    const key=commandId&&'handoff:'+id+':'+commandId,remembered=key&&setting(key);if(remembered)return remembered
    const all=devices(),previous=all.find(d=>d.id===setting('activeDeviceId')),target=all.find(d=>d.id===id);if(!target)throw Object.assign(new Error("Device not found."),{status:404})
    const next={...(previous&&previous.id!==id?previous:target),id,name:target.name,queueRevision:(target.queueRevision||0)+1,handoffCommandId:commandId||null,updatedAt:Date.now()}
    db.prepare('UPDATE devices SET json=?,updated=? WHERE id=?').run(JSON.stringify(next),next.updatedAt,id)
    setting('activeDeviceId',id);setting('takeoverAt',Math.max(Date.now(),(setting('takeoverAt')||0)+1))
    const result={...next,activeDeviceId:id};if(key)setting(key,result);return result
  })
  return {db,catalog,upsert,getTrack,resolveTrack,favorite,list,createList,add,updateList,setting,event,history,saveJob,getJob,jobs,device,devices,takeover,
    favorites:()=>db.prepare('SELECT track_id FROM favorites ORDER BY created DESC').all().map(x=>getTrack(x.track_id)),
    // Summaries without loading every entry: count, duration and up to four distinct covers for a mosaic.
    lists:()=>db.prepare(`SELECT p.id,p.name,p.created,COUNT(e.id) n,COALESCE(SUM(json_extract(t.json,'$.sure')),0) d FROM playlists p LEFT JOIN entries e ON e.playlist_id=p.id LEFT JOIN tracks t ON t.id=e.track_id GROUP BY p.id ORDER BY p.created DESC`).all().map(r=>{
      const kapaklar=[],seen=new Set()
      for(const e of db.prepare('SELECT t.json FROM entries e JOIN tracks t ON t.id=e.track_id WHERE e.playlist_id=? ORDER BY e.position,e.rowid LIMIT 40').all(r.id)){
        const t=JSON.parse(e.json),key=t.albumId||t.kapakId||t.kapakUrl||t.kapak||t.id;if(seen.has(key))continue;seen.add(key)
        kapaklar.push({id:t.id,kaynak:t.kaynak,kapakId:t.kapakId,kapakUrl:t.kapakUrl,kapak:t.kapak});if(kapaklar.length===4)break
      }
      return {id:r.id,ad:r.name,parcaSayisi:r.n,sure:Number(r.d)||0,olusturuldu:r.created,kapaklar}
    }),
    favoritesCount:()=>db.prepare('SELECT COUNT(*) n FROM favorites').get().n,
    remove:(id,entryId)=>db.prepare('DELETE FROM entries WHERE playlist_id=? AND id=?').run(id,entryId),
    deleteList:id=>db.prepare('DELETE FROM playlists WHERE id=?').run(id),
    // "Not for me" hides one recording; the artist scope hides every recording by that artist.
    dismiss:(p,scope='track')=>{const t=upsert(p);if(scope==='artist'){if(normalize(t.sanatci))db.prepare('INSERT OR IGNORE INTO dismissed_artists VALUES(?,?,?)').run(normalize(t.sanatci),String(t.sanatci).slice(0,200),Date.now())}else db.prepare('INSERT OR IGNORE INTO dismissed VALUES(?)').run(t.appId);return t},
    undismiss:(p,scope='track')=>{const t=upsert(p);if(scope==='artist')db.prepare('DELETE FROM dismissed_artists WHERE artist=?').run(normalize(t.sanatci));else db.prepare('DELETE FROM dismissed WHERE track_id=?').run(t.appId);return t},
    dismissedArtists:()=>db.prepare('SELECT artist,label,created FROM dismissed_artists ORDER BY created DESC').all(),
    isDismissed:id=>!!db.prepare("SELECT 1 FROM dismissed WHERE track_id=? UNION ALL SELECT 1 FROM recording_keys k JOIN dismissed_artists a ON a.artist=json_extract(k.key,'$[1]') WHERE k.track_id=? LIMIT 1").get(id,id),close:()=>db.close()}
}
