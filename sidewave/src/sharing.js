import { randomBytes } from 'node:crypto'
import { ApiError } from './telemetry.js'
import { validTrack } from './store.js'

/**
 * Playlist links between accounts. Every account keeps its playlists in its own database, so a
 * link records the owner and playlist; reads and edits run inside the owner's account context.
 * 'view' links let members listen and save a copy; 'edit' links also let them add and remove songs.
 */
export function installSharing(app,{db,store,membership,allowAnonymous=false,publicOrigin=process.env.MUSIC_PUBLIC_ORIGIN}){
  db.exec(`CREATE TABLE IF NOT EXISTS share_links(token TEXT PRIMARY KEY,owner_id TEXT NOT NULL,playlist_id TEXT NOT NULL,mode TEXT NOT NULL,created INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS share_links_owner ON share_links(owner_id,playlist_id,mode);
    CREATE TABLE IF NOT EXISTS shared_tracks(token TEXT PRIMARY KEY,key TEXT UNIQUE NOT NULL,json TEXT NOT NULL,sharer_id TEXT,created INTEGER NOT NULL);`)
  const me=c=>{const m=c.get('member');if(!m&&!allowAnonymous)throw new ApiError('SIGN_IN_REQUIRED',"Sign in to continue.",401);return m?.id||'test'}
  const asOwner=(link,task)=>membership.context.run(link.owner_id==='test'?undefined:link.owner_id,task)
  const link=token=>{
    const row=typeof token==='string'&&/^[A-Za-z0-9_-]{20,64}$/.test(token)?db.prepare('SELECT * FROM share_links WHERE token=? AND revoked=0').get(token):null
    if(!row)throw new ApiError('NOT_FOUND',"This link is no longer shared.",404)
    return row
  }
  const ownerName=id=>db.prepare('SELECT username FROM members WHERE id=?').get(id)?.username||'Sidewave'
  const url=(c,token)=>(publicOrigin||new URL(c.req.url).origin).replace(/\/$/,'')+'/#/shared/'+token
  const followed=()=>store.setting('followedShares')||[]

  app.post('/api/v1/playlists/:id/share',async c=>{
    const owner=me(c),id=c.req.param('id'),mode=(await c.req.json().catch(()=>({}))).mode==='edit'?'edit':'view'
    if(!store.list(id))throw new ApiError('NOT_FOUND',"Playlist not found.",404)
    const existing=db.prepare('SELECT token FROM share_links WHERE owner_id=? AND playlist_id=? AND mode=? AND revoked=0').get(owner,id,mode)
    const token=existing?.token||randomBytes(18).toString('base64url')
    if(!existing)db.prepare('INSERT INTO share_links VALUES(?,?,?,?,?,0)').run(token,owner,id,mode,Date.now())
    return c.json({token,mode,url:url(c,token)})
  })
  app.get('/api/v1/playlists/:id/share',c=>{
    const owner=me(c),rows=db.prepare('SELECT token,mode FROM share_links WHERE owner_id=? AND playlist_id=? AND revoked=0').all(owner,c.req.param('id'))
    return c.json({links:rows.map(r=>({...r,url:url(c,r.token)}))})
  })
  app.delete('/api/v1/playlists/:id/share',async c=>{
    const owner=me(c),mode=(await c.req.json().catch(()=>({}))).mode==='edit'?'edit':'view'
    db.prepare('UPDATE share_links SET revoked=1 WHERE owner_id=? AND playlist_id=? AND mode=?').run(owner,c.req.param('id'),mode)
    return c.json({ok:true})
  })
  app.get('/api/v1/shared/:token',c=>{
    const viewer=me(c),l=link(c.req.param('token')),list=asOwner(l,()=>store.list(l.playlist_id))
    if(!list)throw new ApiError('NOT_FOUND',"This playlist no longer exists.",404)
    return c.json({...list,token:l.token,mode:l.mode,owner:ownerName(l.owner_id),mine:l.owner_id===viewer,following:followed().includes(l.token)})
  })
  app.post('/api/v1/shared/:token/tracks',async c=>{
    me(c);const l=link(c.req.param('token'));if(l.mode!=='edit')throw new ApiError('READ_ONLY',"Only collaborators can add songs to this playlist.",403)
    const tracks=(await c.req.json()).parcalar
    if(!Array.isArray(tracks)||!tracks.length||tracks.length>500)throw new ApiError('INVALID_TRACKS',"Add up to 500 tracks at a time.",400)
    return c.json(asOwner(l,()=>store.add(l.playlist_id,tracks.map(validTrack))))
  })
  app.delete('/api/v1/shared/:token/tracks',async c=>{
    me(c);const l=link(c.req.param('token'));if(l.mode!=='edit')throw new ApiError('READ_ONLY',"Only collaborators can remove songs from this playlist.",403)
    const entryId=(await c.req.json()).entryId
    asOwner(l,()=>{if(!store.list(l.playlist_id)?.parcalar.some(p=>p.entryId===entryId))throw new ApiError('NOT_FOUND',"Playlist entry not found.",404);store.remove(l.playlist_id,entryId)})
    return c.json({ok:true})
  })
  app.post('/api/v1/shared/:token/save',c=>{
    me(c);const l=link(c.req.param('token')),list=asOwner(l,()=>store.list(l.playlist_id))
    if(!list)throw new ApiError('NOT_FOUND',"This playlist no longer exists.",404)
    const id=store.createList(list.ad);if(list.parcalar.length)store.add(id,list.parcalar.map(({entryId,appId,favori,...p})=>p))
    return c.json({id},201)
  })
  app.put('/api/v1/shared/:token/follow',async c=>{
    const viewer=me(c),l=link(c.req.param('token')),on=(await c.req.json().catch(()=>({}))).following!==false
    if(l.owner_id===viewer)return c.json({following:false})
    const next=followed().filter(t=>t!==l.token);if(on)next.unshift(l.token);store.setting('followedShares',next.slice(0,200))
    return c.json({following:on})
  })
  // Song links carry the recording itself (source and ID), so any member can play it in their own account.
  // The same recording always gets the same link.
  app.post('/api/v1/tracks/share',async c=>{
    const viewer=me(c),raw=(await c.req.json().catch(()=>({}))).parca,p=validTrack(raw),key=p.kaynak+':'+p.id
    const {appId,favori,entryId,queueId,...track}=p
    let row=db.prepare('SELECT token FROM shared_tracks WHERE key=?').get(key)
    if(!row){row={token:randomBytes(12).toString('base64url')};db.prepare('INSERT INTO shared_tracks VALUES(?,?,?,?,?)').run(row.token,key,JSON.stringify(track),viewer,Date.now())}
    return c.json({token:row.token,url:(publicOrigin||new URL(c.req.url).origin).replace(/\/$/,'')+'/#/song/'+row.token})
  })
  app.get('/api/v1/tracks/shared/:token',c=>{
    me(c);const token=c.req.param('token'),row=/^[A-Za-z0-9_-]{10,40}$/.test(token)?db.prepare('SELECT json,sharer_id FROM shared_tracks WHERE token=?').get(token):null
    if(!row)throw new ApiError('NOT_FOUND',"This song link isn’t available.",404)
    // Upsert into the viewer's account so likes, playlists and history work as for any other song.
    return c.json({parca:store.upsert(JSON.parse(row.json)),sharedBy:row.sharer_id?ownerName(row.sharer_id):null})
  })
  // Followed shared playlists, summarised like your own lists; revoked links quietly drop out.
  app.get('/api/v1/shared',c=>{
    me(c);const out=[]
    for(const token of followed()){
      const l=db.prepare('SELECT * FROM share_links WHERE token=? AND revoked=0').get(token);if(!l)continue
      const summary=asOwner(l,()=>store.lists().find(x=>x.id===l.playlist_id));if(!summary)continue
      out.push({...summary,id:'share:'+l.token,token:l.token,mode:l.mode,owner:ownerName(l.owner_id)})
    }
    return c.json({listeler:out})
  })
}
