import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat, readdir, realpath } from 'node:fs/promises'
import { join, resolve, basename, extname } from 'node:path'
import { Readable } from 'node:stream'
import { bodyLimit } from 'hono/body-limit'
import { createStore, sameRecording } from './src/store.js'
import { installApi, migrateNavidrome } from './src/api-v1.js'
import { createArchive } from './src/archive.js'
import { ApiError, publicError, log, count, consumeBudget } from './src/telemetry.js'
import { proxyAudio, parseRange } from './src/stream.js'
import { createSonicCatalogBridge } from './src/sonic-catalog.js'
import {createOnlineDiscovery,createExcerptAnalyzer} from './src/online-discovery.js'
import { createAnalysisJobs } from './src/analysis-jobs.js'
import { installDiscoveryApi } from './src/discovery.js'
import { exactArtistMatches, rankSearchTracks } from './src/search.js'
import { createAudioCache } from './src/audio-cache.js'
import { verifyArchiveStream } from './src/archive-probe.js'
import { createAndroidUpdates } from './src/android-updates.js'
import { installAppearanceApi } from './src/appearance.js'
import { createMembership } from './src/membership.js'
import { installCollections } from './src/collections.js'
import { installHomeIntro } from './src/home-intro.js'
import { sourceMessage } from './src/source-messages.js'
import { createLoudness } from './src/loudness.js'
import { createLyrics } from './src/lyrics.js'
import { installDiagnostics, telegramNotifier } from './src/diagnostics.js'
import { installSharing } from './src/sharing.js'

const CFG = {
  port: Number(process.env.PORT || 4444),
  ndUrl: (process.env.NAVIDROME_URL || 'http://navidrome:4533').replace(/\/$/, ''),
  ndUser: process.env.NAVIDROME_USER || '',
  ndPass: process.env.NAVIDROME_PASS || '',
  slskdUrl: (process.env.SLSKD_URL || 'http://slskd:5030').replace(/\/$/, ''),
  slskdKey: process.env.SLSKD_API_KEY || '',
  ytresUrl: (process.env.YTRES_URL || 'http://ytres:4455').replace(/\/$/, ''),
  musicRoot: resolve(process.env.MUSIC_ROOT || '/music'),
}

const AUDIO_EXT = new Set(['.mp3', '.flac', '.m4a', '.ogg', '.opus', '.wav', '.aac', '.wma'])

const app = new Hono()
const databasePath = process.env.DATABASE_PATH || './data/sidewave.sqlite'
const baseStore = createStore(databasePath)
const membership = createMembership(baseStore, databasePath, {testBypass:process.env.SKIP_LISTEN==='1'})
const store = membership.store
app.use('*', async (c, next) => {
  const supplied = c.req.header('x-request-id') || c.req.query('requestId')
  const requestId = /^[a-zA-Z0-9_-]{1,100}$/.test(supplied || '') ? supplied : randomBytes(12).toString('hex')
  c.set('requestId', requestId); c.header('X-Request-Id', requestId)
  await next()
})
app.use('/api/*', (c,next)=>bodyLimit({ maxSize: (['/api/v1/import/spotify/upload','/api/v1/import/spotify/history'].includes(c.req.path)?64:c.req.path==='/api/v1/appearance/wallpaper'?8:2) * 1024 * 1024, onError: c => c.json({code:'REQUEST_TOO_LARGE',message:"The request exceeds the size limit.",retryable:false,requestId:c.get('requestId')},413) })(c,next))
async function stagingArchiveGuard(c, next) {
  if (process.env.ARCHIVE_DISABLED === '1' && c.req.method !== 'GET') {
    return c.json({code:'STAGING_READ_ONLY',message:"Archive actions are unavailable in staging.",retryable:false,requestId:c.get('requestId')},403)
  }
  await next()
}
app.use('/api/soulseek/*', stagingArchiveGuard)
app.use('/api/v1/archive/*', stagingArchiveGuard)
app.onError((e, c) => {
  const error = publicError(e, c.get('requestId'))
  log('request_failed', { requestId: error.requestId, code: error.code, status: e.status || 502 })
  count('sidewave_api_errors_total', 'server', error.code)
  return c.json(error, e.status || 502)
})
membership.install(app)
// Soulseek, archive, raw files and server-wide cache/analysis use the owner's accounts and disk.
for (const path of ['/api/soulseek/*','/api/indirmeler','/api/yerel/*','/api/arsive-ekle','/api/arsive-ekle/*','/api/v1/archive/*']) app.use(path,membership.requireOwner)
app.on(['PATCH','DELETE'],['/api/v1/cache','/api/v1/cache/*'],membership.requireOwner)
app.post('/api/v1/discovery/analysis',membership.requireOwner)
installDiagnostics(app, {db: baseStore.db, requireOwner: membership.requireOwner, notify: telegramNotifier()})
installSharing(app, {db: baseStore.db, store, membership, allowAnonymous: process.env.SKIP_LISTEN==='1'})
installAppearanceApi(app, {store, root: join(process.env.DATABASE_PATH ? resolve(process.env.DATABASE_PATH, '..') : './data', 'appearance')})
const archive = createArchive({ store, subsonic, slskd, mapSong, soulseekSonuclari, musicRoot: CFG.musicRoot, jobsRoot: process.env.JOBS_ROOT || './data/jobs' })
const loudness=createLoudness({db:baseStore.db,ytres,localUrl:p=>subsonicUrl('stream.view',{id:p.id,format:'raw'})})
const lyrics=createLyrics({db:baseStore.db,libraryLyrics:async(track,signal)=>{if(track.kaynak!=='kutuphane')return null;const r=await subsonic('getLyrics.view',{artist:track.sanatci,title:track.baslik},signal);return r.lyrics?.value||null}})
const audioCache=process.env.SKIP_LISTEN==='1'?undefined:createAudioCache({store,root:process.env.AUDIO_CACHE_ROOT||'./data/audio-cache',resolveSource:(p,force,signal)=>ytres('/coz?id='+encodeURIComponent(p.id)+(force?'&force=true':''),{signal})})
const services=installApi(app, { store, subsonic, mapSong, ytres, searchAll, archive, artistCatalog, audioCache, loudness, lyrics, sonic:()=>discovery, verifyLocal:async (song,signal)=>{
  if(process.env.SKIP_LISTEN==='1')return true
  const qs=subsonicAuth();qs.set('id',song.id)
  return verifyArchiveStream(CFG.ndUrl+'/rest/stream.view?'+qs,signal)
} })

const collections=installCollections(app,{store,baseStore,ytres,subsonic,mapSong})
installHomeIntro(app,{store})

// ---------------------------------------------------------------- Navidrome

// Subsonic auth: her istekte yeni salt + md5(parola+salt).
// Parola duz metin gonderilmez.
function subsonicAuth() {
  const salt = randomBytes(8).toString('hex')
  const token = createHash('md5').update(CFG.ndPass + salt).digest('hex')
  return new URLSearchParams({
    u: CFG.ndUser, t: token, s: salt,
    v: '1.16.1', c: 'Sidewave', f: 'json',
  })
}

async function subsonic(endpoint, params = {}, signal, baseUrl = CFG.ndUrl) {
  const qs = subsonicAuth()
  for (const [k, v] of Object.entries(params)) {
    // Bazi Subsonic uclari ayni anahtari tekrarlayarak liste alir
    // (ornegin updatePlaylist'te songIdToAdd) — dizi gelirse append et.
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, String(x)))
    else qs.set(k, String(v))
  }
  const res = await fetch(`${baseUrl}/rest/${endpoint}?${qs}`, {signal: signal?AbortSignal.any([signal,AbortSignal.timeout(7000)]):AbortSignal.timeout(7000)})
  if (!res.ok) throw new Error(`Navidrome HTTP ${res.status}`)
  const body = await res.json()
  const sr = body['subsonic-response']
  if (sr?.status === 'failed') throw new Error(sr.error?.message || 'Navidrome hatasi')
  return sr
}

const sonicSubsonic=(endpoint,params,signal)=>subsonic(endpoint,params,signal,process.env.SONIC_NAVIDROME_URL||CFG.ndUrl)
const sonicBridge=createSonicCatalogBridge({subsonic,sonicSubsonic,replica:!!process.env.SONIC_NAVIDROME_URL && process.env.SONIC_NAVIDROME_URL!==CFG.ndUrl})
const onlineDiscovery=createOnlineDiscovery({store,related:async(p,signal)=>{const r=await ytres('/ilgili?id='+encodeURIComponent(p.id)+'&limit=50',{signal});return {...r,parcalar:(r.parcalar||[]).map(p=>({...p,kaynak:'youtube'}))}},
 analyze:process.env.ONLINE_SONIC_URL?createExcerptAnalyzer({url:process.env.ONLINE_SONIC_URL,resolveSource:(p,signal,force)=>ytres('/coz?id='+encodeURIComponent(p.id)+(force?'&force=true':''),{signal})}):undefined,
 canAnalyze:()=>Date.now()-(store.setting('playbackLastFailure')||0)>60000 && (audioCache?.stats().activeFills||0)===0})
const discovery=installDiscoveryApi(app,{store,subsonic,mapSong,sonicSubsonic,bridge:sonicBridge,online:onlineDiscovery,
  audioArtists:async(id,signal)=>{
    if(!process.env.AUDIOMUSE_URL || !process.env.AUDIOMUSE_TOKEN)return []
    const r=await fetch(process.env.AUDIOMUSE_URL+'/api/similar_artists?artist='+encodeURIComponent(id)+'&include_component_matches=true&n=12',{headers:{Authorization:'Bearer '+process.env.AUDIOMUSE_TOKEN},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(5000)]):AbortSignal.timeout(5000)})
    if(!r.ok)return [];const body=await r.json();return Array.isArray(body)?body:[]
  },
  coverage:async signal=>{
    if(!process.env.AUDIOMUSE_URL || !process.env.AUDIOMUSE_TOKEN)return null
    const r=await fetch(process.env.AUDIOMUSE_URL+'/api/models',{headers:{Authorization:'Bearer '+process.env.AUDIOMUSE_TOKEN},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(3000)]):AbortSignal.timeout(3000)})
    if(!r.ok)return null
    const data=await r.json(),clap=data.models?.musicnn?.local||data.models?.musicnn?.global
    return clap?{count:clap.count,total:clap.total,model:'MusiCNN',version:'sha256:a48ad887950a557aefbb4dcddf58ad4802213ff5fc6fb51eda3507cd797bb9b0',serviceVersion:'3.6.4'}:null
  },
})

const analysisJobs=createAnalysisJobs({canAnalyze:()=>Date.now()-(store.setting('playbackLastFailure')||0)>60000 && (audioCache?.stats().activeFills||0)===0,store,enabled:!!process.env.AUDIOMUSE_URL && !!process.env.AUDIOMUSE_TOKEN && process.env.ARCHIVE_DISABLED!=='1',
  scan:async()=>{
    const base=process.env.SONIC_NAVIDROME_URL||CFG.ndUrl,signal=AbortSignal.timeout(12000)
    await subsonic('startScan.view',{},signal,base)
    for(let i=0;i<20;i++){const r=await subsonic('getScanStatus.view',{},signal,base);if(!r.scanStatus?.scanning)return;await new Promise(r=>setTimeout(r,300))}
    throw new Error('scan pending')
  },
  enqueue:async()=>{
    const r=await fetch(process.env.AUDIOMUSE_URL+'/api/analysis/start',{method:'POST',headers:{Authorization:'Bearer '+process.env.AUDIOMUSE_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({num_recent_albums:0}),signal:AbortSignal.timeout(5000)})
    if(!r.ok)throw new Error('analysis unavailable')
    return r.json()
  },
})
app.get('/api/v1/discovery/analysis',c=>{
  // Submissions are fire-and-forget; an old or empty one is history, not work in progress.
  const job=store.setting('sonicAnalysisJob')
  if(job?.state==='submitted'&&(!job.trackCount||Date.now()-job.submittedAt>6*3600000))return c.json({state:'idle',lastSubmittedAt:job.submittedAt,lastTrackCount:job.trackCount||0})
  return c.json(job||{state:process.env.AUDIOMUSE_URL?'idle':'unsupported'})
})
app.post('/api/v1/discovery/analysis',async c=>c.json(await analysisJobs.tick(true),202))

// Subsonic URL'ini dogrudan uret — akis/kapak proxy'si icin.
function subsonicUrl(endpoint, params = {}) {
  const qs = subsonicAuth()
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v))
  return `${CFG.ndUrl}/rest/${endpoint}?${qs}`
}

// ---------------------------------------------------------------- slskd

async function slskd(path, opts = {}) {
  const res = await fetch(`${CFG.slskdUrl}/api/v0${path}`, {
    signal: AbortSignal.timeout(8000), ...opts,
    headers: {
      'X-API-Key': CFG.slskdKey,
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...opts.headers,
    },
  })
  if (!res.ok) throw new Error(`slskd HTTP ${res.status}`)
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

// ---------------------------------------------------------------- ytres

async function ytres(path, opts = {}) {
  const res = await fetch(`${CFG.ytresUrl}${path}`, {signal: AbortSignal.timeout(path.startsWith('/coz') ? 13500 : 8000), ...opts})
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(body.code || 'SOURCE_UNAVAILABLE', sourceMessage(body.code), res.status, body.retryable ?? res.status >= 500)
  }
  return res.json()
}

// Baslik/sanatci karsilastirmasi icin sadelestirme: aksan, noktalama ve
// "(remastered)" / "official video" gibi gurultuyu at.
function sadelestir(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(official|video|audio|lyrics?|remastered|hd|hq|full album|clip)\b/g, '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim()
}

// ---------------------------------------------------------------- durum

app.get('/api/health', c => c.json({ok:true,version:'0.1.0',database:!!store.db.prepare('SELECT 1').get()}))
app.get('/metrics/ytres', async c => {
  const r=await fetch(CFG.ytresUrl+'/metrics',{signal:AbortSignal.timeout(3000)})
  if(!r.ok)throw new ApiError('SOURCE_UNAVAILABLE',"Source metrics are unavailable.",502,true)
  return c.text(await r.text(),200,{'Content-Type':'text/plain; version=0.0.4'})
})
app.get('/api/status', async (c) => {
  const out = { navidrome: false, slskd: false, soulseek: null, hata: {} }
  try {
    await subsonic('ping.view')
    out.navidrome = true
  } catch (e) { out.hata.navidrome = String(e.message) }
  try {
    const a = await slskd('/application')
    out.slskd = true
    out.soulseek = a?.server?.state ?? null
  } catch (e) { out.hata.slskd = String(e.message) }
  try {
    const health = await ytres('/saglik')
    out.ytres = true
    out.sourceHealth = health
  } catch (e) { out.ytres = false; out.hata.ytres = String(e.message) }
  return c.json(out)
})

// ---------------------------------------------------------------- birlesik arama

const artistCatalogCache = new Map()
async function artistCatalog(id, signal) {
  const cached = artistCatalogCache.get(id)
  if (cached?.expires > Date.now()) return cached.value
  const bounded = signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000)
  const value = await ytres('/sanatci?browseId=' + encodeURIComponent(id), {signal: bounded})
  if (artistCatalogCache.size >= 64) artistCatalogCache.delete(artistCatalogCache.keys().next().value)
  artistCatalogCache.set(id, {value, expires: Date.now() + 90000})
  return value
}

// Match relevance first; an exact local recording still replaces its remote copy.
// Complete results are reused for a minute per account: typing back and forth, Back to results
// and the Android client repeating a query no longer wait for the catalog again.
const searchCache = new Map()
async function searchAll(q, {tracksOnly=false,signal}={}) {
  q = String(q).trim().slice(0,200)
  if (!q) return {parcalar: [], albumler: [], sanatcilar: [], hata: {}}
  const cacheKey = store.accountId + '\n' + tracksOnly + '\n' + q.toLocaleLowerCase('tr')
  const cached = searchCache.get(cacheKey)
  if (cached && Date.now() - cached.at < 60000) return cached.result
  const result = await searchUncached(q, {tracksOnly, signal})
  if (!Object.values(result.hata || {}).some(Boolean)) {
    searchCache.set(cacheKey, {at: Date.now(), result})
    if (searchCache.size > 300) searchCache.delete(searchCache.keys().next().value)
  }
  return result
}
async function searchUncached(q, {tracksOnly=false,signal}={}) {
  const deadline = AbortSignal.timeout(8000)
  const catalogSignal = signal ? AbortSignal.any([signal, deadline]) : deadline
  const [kut, yt, albums, artists] = await Promise.allSettled([
    subsonic('search3.view', {query:q,songCount:40,albumCount:tracksOnly?0:12,artistCount:tracksOnly?0:12},catalogSignal),
    ytres('/ara?q='+encodeURIComponent(q)+'&limit=25'+(tracksOnly?'':'&broad=true'),{signal:catalogSignal}),
    tracksOnly?Promise.resolve({sonuclar:[]}):ytres('/ara?q='+encodeURIComponent(q)+'&limit=10&type=albums',{signal:catalogSignal}),
    tracksOnly?Promise.resolve({sonuclar:[]}):ytres('/ara?q='+encodeURIComponent(q)+'&limit=10&type=artists',{signal:catalogSignal}),
  ])
  signal?.throwIfAborted()
  const sanatcilar = [], artistIds = new Set()
  for (const a of [
    ...(kut.status==='fulfilled'?(kut.value.searchResult3?.artist||[]).map(a=>({id:a.id,ad:a.name,kapakId:a.coverArt||a.id,kaynak:'kutuphane'})):[]),
    ...(artists.status==='fulfilled'?(artists.value.sanatcilar||artists.value.sonuclar||[]):[]).map(a=>({...a,kaynak:'youtube'})),
    ...(yt.status==='fulfilled'?(yt.value.sanatcilar||[]):[]).map(a=>({...a,kaynak:'youtube'})),
  ]) {
    const key = a.kaynak + ':' + a.id
    if (a.id && !artistIds.has(key)) {artistIds.add(key); sanatcilar.push(a)}
  }
  const parcalar = kut.status === 'fulfilled' ? (kut.value.searchResult3?.song || []).map(mapSong) : []
  const remote = yt.status === 'fulfilled' ? [...yt.value.sonuclar || []] : []
  const exactArtists = tracksOnly ? [] : exactArtistMatches(q, sanatcilar)
  const artistReleases = []
  let artistSongsFailed = false
  if (exactArtists.length && !catalogSignal.aborted) {
    const catalogs = await Promise.allSettled(exactArtists.map(a=>artistCatalog(a.id, catalogSignal)))
    for (const [index, result] of catalogs.entries()) {
      if (result.status === 'fulfilled') {
        remote.push(...(result.value.parcalar || []).slice(0, 5))
        artistReleases.push(...(result.value.albumler || []).slice(0, 24).map(a=>({...a,sanatci:result.value.ad||exactArtists[index].ad,sanatciId:exactArtists[index].id,kaynak:'youtube'})))
      }
      else artistSongsFailed = true
    }
  }
  signal?.throwIfAborted()
  const remoteIds = new Set()
  for (const s of remote) {
    if (!s.id || !s.baslik || remoteIds.has(s.id)) continue
    remoteIds.add(s.id)
    const p = {...s,kapakUrl:s.kapak,sanatciId:s.sanatciId||s.sanatcilar?.[0]?.id,kaynak:'youtube'}
    if (!parcalar.some(local=>sameRecording(local,p))) parcalar.push(p)
  }
  const releaseIds = new Set()
  const albumler = [
    ...(kut.status==='fulfilled'?(kut.value.searchResult3?.album||[]).map(a=>({id:a.id,ad:a.name,sanatci:a.artist,kapakId:a.coverArt||a.id,kaynak:'kutuphane'})):[]),
    ...artistReleases,
    ...(albums.status==='fulfilled'?(albums.value.albumler||albums.value.sonuclar||[]).map(a=>({...a,kaynak:'youtube'})):[]),
  ].filter(a=>{const key=a.kaynak+':'+a.id;if(!a.id||releaseIds.has(key))return false;releaseIds.add(key);return true})
  return {parcalar:rankSearchTracks(q,parcalar.map(p=>store.upsert(p)),sanatcilar),
    albumler:rankSearchTracks(q,albumler.map(a=>({...a,baslik:a.ad})),sanatcilar),
    sanatcilar,
    hata:{...(kut.status==='rejected'?{kutuphane:"Your library is unavailable."}:{}),
      ...(yt.status==='rejected'?{youtube:"Song search is temporarily unavailable."}:{}),
      ...(albums.status==='rejected'?{albumler:"Album search is temporarily unavailable."}:{}),
      ...(artists.status==='rejected'?{sanatcilar:"Artist search is temporarily unavailable."}:{}),
      ...(artistSongsFailed?{sanatciParcalari:"Some songs could not be loaded. Available results are shown."}:{}),
      ...(yt.status==='fulfilled'&&Object.values(yt.value.hata||{}).some(Boolean)?{genisArama:"Some search sources are unavailable. Available results are shown."}:{})}}
}
app.get('/api/ara', async c => c.json(await searchAll(c.req.query('q') || '',{signal:c.req.raw.signal})))

// ---------------------------------------------------------------- kesfet

// Ana sayfanin tum verisi tek cagrida: kutuphane + gercek YouTube listeleri.
// Tasarimdaki sahte dizilerin (Aria Volt, Neon Nights...) yerini bu doldurur.
app.get('/api/kesfet', async (c) => {
  const [alb, ch] = await Promise.allSettled([
    subsonic('getAlbumList2.view', { type: 'newest', size: 24 }),
    ytres('/charts?ulke=' + encodeURIComponent(c.req.query('ulke') || 'TR')),
  ])

  const albumler = alb.status === 'fulfilled'
    ? (alb.value.albumList2?.album || []).map((a) => ({
        id: a.id, ad: a.name, sanatci: a.artist, yil: a.year, parcaSayisi: a.songCount,
      }))
    : []

  return c.json({
    albumler,
    trendSanatcilar: ch.status === 'fulfilled' ? ch.value.sanatcilar : [],
    trendParcalar: ch.status === 'fulfilled' ? (ch.value.parcalar || []).map(p=>store.upsert({...p,kaynak:'youtube'})) : [],
    hata: {
      kutuphane: alb.status === 'rejected' ? String(alb.reason?.message) : null,
      listeler: ch.status === 'rejected' ? String(ch.reason?.message) : null,
    },
  })
})

// YouTube ses akisi — cozumlenmis googlevideo URL'sini proxy'ler.
// Ham URL tarayiciya verilmez: URL istegi yapan IP'ye bagli olabiliyor.
app.get('/api/yt/akis/:id', async c => {
  const track={id:c.req.param('id'),kaynak:'youtube'}
  if(c.req.query('delivery')==='temporary_cache'){const cached=await audioCache?.serve(c,track).catch(()=>null);if(cached)return cached;throw new ApiError('CACHE_EXPIRED',"The temporary audio copy was cleared. You can play it again.",410,true)}
  return proxyAudio(c, (force,signal) => ytres('/coz?id='+encodeURIComponent(track.id)+(force?'&force=true':''),{signal,headers:{'x-request-id':c.get('requestId')}}), {source:'youtube',requestId:c.get('requestId'),budgetMs:consumeBudget(c.get('requestId'))})
})

// Izin verilen kapak kaynaklari. Bu uc acik proxy'ye donusmesin diye alan adi
// kisitli. Desen her etiketi ayri ayri dogrular: 'evilggpht.com' gibi bir alan
// adi gecemez (once kullanilan `[a-z0-9.-]*` bunu geciriyordu).
// googleusercontent: oneri ve sanatci gorselleri, ytimg: liste kucuk resimleri.
const KAPAK_ALAN = /^https:\/\/([a-z0-9-]+\.)*(ggpht|ytimg|googleusercontent)\.com\//i

// YouTube sanatci sayfasi — kutuphane sanatci sayfasiyla ayni sekle donusturulur
app.get('/api/yt/sanatci/:browseId', async c => c.json(await services.catalogArtist('youtube',c.req.param('browseId'),c.req.raw.signal)))

app.get('/api/yt/kapak', async (c) => {
  const u = c.req.query('u')
  if (!u || !KAPAK_ALAN.test(u)) return c.body(null, 400)
  const r = await fetch(u,{signal:AbortSignal.timeout(6000)}).catch(()=>null)
  if (!r?.ok) return c.body(null, 404)
  const h = new Headers()
  const ct = r.headers.get('content-type'); if (ct) h.set('content-type', ct)
  h.set('Cache-Control', 'public, max-age=86400')
  return new Response(r.body, { status: 200, headers: h })
})

// ---------------------------------------------------------------- kutuphane

app.get('/api/library/search', async (c) => {
  const q = (c.req.query('q') || '').trim()
  if (!q) return c.json({ songs: [], albums: [], artists: [] })
  try {
    const r = await subsonic('search3.view', {
      query: q, songCount: 60, albumCount: 24, artistCount: 12,
    })
    const s = r.searchResult3 || {}
    return c.json({
      songs: (s.song || []).map(mapSong),
      albums: (s.album || []).map((a) => ({
        id: a.id, ad: a.name, sanatci: a.artist, yil: a.year, parcaSayisi: a.songCount,
      })),
      artists: (s.artist || []).map((a) => ({ id: a.id, ad: a.name, albumSayisi: a.albumCount })),
    })
  } catch (e) {
    return c.json({ hata: String(e.message), songs: [], albums: [], artists: [] }, 502)
  }
})

app.get('/api/library/album/:id', async c => c.json(await services.catalogAlbum('kutuphane',c.req.param('id'),c.req.raw.signal)))

app.get('/api/library/artists', async (c) => {
  try {
    const r = await subsonic('getArtists.view')
    const idx = r.artists?.index || []
    return c.json({
      sanatcilar: idx.flatMap((i) => i.artist || []).map((a) => ({
        id: a.id, ad: a.name, albumSayisi: a.albumCount, kapakId: a.coverArt || a.id,
      })),
    })
  } catch (e) { return c.json({ hata: String(e.message), sanatcilar: [] }, 502) }
})

// Sanatci sayfasi: albumleri + biyografi + en cok dinlenenler tek cagrida.
// getTopSongs / getArtistInfo2 Last.fm entegrasyonuna bagli olabilir —
// bos donerlerse bolum gizlenir, hata gosterilmez.
app.get('/api/library/artist/:id', async c => c.json(await services.catalogArtist('kutuphane',c.req.param('id'),c.req.raw.signal)))

// Kutuphanenin tamami — acilista gosterilecek
app.get('/api/library/recent', async (c) => {
  try {
    const r = await subsonic('getAlbumList2.view', { type: 'newest', size: 24 })
    const list = r.albumList2?.album || []
    return c.json({
      albums: list.map((a) => ({
        id: a.id, ad: a.name, sanatci: a.artist, yil: a.year, parcaSayisi: a.songCount,
      })),
    })
  } catch (e) { return c.json({ hata: String(e.message), albums: [] }, 502) }
})

function mapSong(s) {
  return {
    id: s.id,
    baslik: s.title,
    sanatci: s.artist,
    album: s.album,
    sure: s.duration,
    parcaNo: s.track,
    disk: s.discNumber,
    yil: s.year,
    bicim: (s.suffix || '').toUpperCase(),
    bitrate: s.bitRate,
    kapakId: s.coverArt || s.albumId,
    // Tiklanabilirlik icin: satirdaki sanatci/album adlari bu id'lerle sayfaya gider
    sanatciId: s.artistId,
    albumId: s.albumId,
    // Subsonic'te 'starred' alani YALNIZCA yildizliyken gelir — varligi = favori
    favori: !!s.starred,
    // OpenSubsonic ReplayGain, when the file is tagged; used for volume levelling.
    ...(Number.isFinite(s.replayGain?.trackGain) ? {replayGain: {trackGain: s.replayGain.trackGain, albumGain: s.replayGain.albumGain, trackPeak: s.replayGain.trackPeak}} : {}),
    kaynak: 'kutuphane',
  }
}

// ---------------------------------------------------------------- akis

// Navidrome'dan akis — Range basliklarini oldugu gibi aktar ki
// tarayici ileri/geri sarabilsin.
app.get('/api/stream/:id', async c => {
  const format = c.req.query('format')
  const params = {id:c.req.param('id')}
  if (['mp3','opus'].includes(format)) {params.format=format;params.maxBitRate=320}
  return proxyAudio(c, async () => ({url:subsonicUrl('stream.view',params)}), {source:'kutuphane',requestId:c.get('requestId'),budgetMs:consumeBudget(c.get('requestId'))})
})

app.get('/api/cover/:id', async (c) => {
  const url = subsonicUrl('getCoverArt.view', { id: c.req.param('id'), size: c.req.query('size') || 300 })
  const upstream = await fetch(url,{signal:AbortSignal.timeout(6000)}).catch(()=>null)
  if (!upstream?.ok) return c.body(null, 404)
  const h = new Headers()
  const ct = upstream.headers.get('content-type')
  if (ct) h.set('content-type', ct)
  h.set('Cache-Control', 'public, max-age=86400')
  return new Response(upstream.body, { status: 200, headers: h })
})

// ---------------------------------------------------------------- Soulseek

app.post('/api/soulseek/search', async (c) => {
  const { q } = await c.req.json()
  if (!q?.trim()) return c.json({ hata: 'bos arama' }, 400)
  try {
    const r = await slskd('/searches', {
      method: 'POST',
      body: JSON.stringify({ searchText: q.trim() }),
    })
    return c.json({ id: r.id })
  } catch (e) { return c.json({ hata: String(e.message) }, 502) }
})

app.get('/api/soulseek/search/:id', async (c) => {
  try {
    const r = await slskd(`/searches/${c.req.param('id')}?includeResponses=true`)
    const bitti = typeof r.state === 'string' && r.state.includes('Completed')
    return c.json({ bitti, yanitSayisi: r.responseCount || 0, sonuclar: soulseekSonuclari(r) })
  } catch (e) { return c.json({ hata: String(e.message), bitti: true, sonuclar: [] }, 502) }
})

// Ham slskd yanitlarini calinabilir parca listesine cevir.
// Kalite sirasi: bos slot > bitrate > kisa kuyruk. Ayni dosya adi tekrar etmesin.
function soulseekSonuclari(r) {
  const out = []
  for (const resp of r.responses || []) {
    for (const f of resp.files || []) {
      const ext = extname(f.filename || '').toLowerCase()
      if (!AUDIO_EXT.has(ext)) continue
      const parcalar = (f.filename || '').split('\\')
      out.push({
        dosyaAdi: parcalar[parcalar.length - 1] || f.filename,
        klasor: parcalar.length > 1 ? parcalar[parcalar.length - 2] : '',
        tamYol: f.filename,
        boyut: f.size,
        sure: f.length || null,
        bitrate: f.bitRate || null,
        bicim: ext.replace('.', '').toUpperCase(),
        kullanici: resp.username,
        bosSlot: !!resp.hasFreeUploadSlot,
        kuyruk: resp.queueLength ?? 0,
        hiz: resp.uploadSpeed ?? 0,
      })
    }
  }
  out.sort((a, b) => {
    if (a.bosSlot !== b.bosSlot) return a.bosSlot ? -1 : 1
    if ((b.bitrate || 0) !== (a.bitrate || 0)) return (b.bitrate || 0) - (a.bitrate || 0)
    return (a.kuyruk || 0) - (b.kuyruk || 0)
  })
  const gorulen = new Set()
  const benzersiz = []
  for (const x of out) {
    const anahtar = x.dosyaAdi.toLowerCase()
    if (gorulen.has(anahtar)) continue
    gorulen.add(anahtar)
    benzersiz.push(x)
    if (benzersiz.length >= 60) break
  }
  return benzersiz
}

app.post('/api/soulseek/getir', async (c) => {
  const { kullanici, dosyalar } = await c.req.json()
  if (!kullanici || !Array.isArray(dosyalar) || !dosyalar.length) {
    return c.json({ hata: 'kullanici ve dosyalar gerekli' }, 400)
  }
  try {
    await slskd(`/transfers/downloads/${encodeURIComponent(kullanici)}`, {
      method: 'POST',
      body: JSON.stringify(dosyalar.map((d) => ({ filename: d.tamYol, size: d.boyut }))),
    })
    return c.json({ ok: true })
  } catch (e) { return c.json({ hata: String(e.message) }, 502) }
})

// Klasordeki tum parcalari getir — "albumu indir"
app.post('/api/soulseek/klasor-getir', async (c) => {
  const { kullanici, aramaId, klasor } = await c.req.json()
  try {
    const r = await slskd(`/searches/${aramaId}?includeResponses=true`)
    const hedef = []
    for (const resp of r.responses || []) {
      if (resp.username !== kullanici) continue
      for (const f of resp.files || []) {
        const p = (f.filename || '').split('\\')
        const kl = p.length > 1 ? p[p.length - 2] : ''
        if (kl !== klasor) continue
        if (!AUDIO_EXT.has(extname(f.filename || '').toLowerCase())) continue
        hedef.push({ filename: f.filename, size: f.size })
      }
    }
    if (!hedef.length) return c.json({ hata: 'klasorde parca bulunamadi' }, 404)
    await slskd(`/transfers/downloads/${encodeURIComponent(kullanici)}`, {
      method: 'POST', body: JSON.stringify(hedef),
    })
    return c.json({ ok: true, adet: hedef.length })
  } catch (e) { return c.json({ hata: String(e.message) }, 502) }
})

// Aktif/biten indirmeler — arayuzdeki ilerleme cubugu bunu okur
app.get('/api/indirmeler', async (c) => {
  try {
    const d = await slskd('/transfers/downloads')
    const out = []
    for (const u of d || []) {
      for (const dir of u.directories || []) {
        for (const f of dir.files || []) {
          const durum = f.state || ''
          if (durum.includes('Cancelled')) continue
          const p = (f.filename || '').split('\\')
          out.push({
            id: f.id,
            dosyaAdi: p[p.length - 1] || f.filename,
            kullanici: u.username,
            durum,
            bitti: durum.includes('Succeeded'),
            hatali: durum.includes('Errored') || durum.includes('Failed') || durum.includes('Rejected'),
            yuzde: Math.round(f.percentComplete || 0),
            boyut: f.size,
          })
        }
      }
    }
    return c.json({ indirmeler: out })
  } catch (e) { return c.json({ hata: String(e.message), indirmeler: [] }, 502) }
})

// ---------------------------------------------------------------- yerel dosya

// Yeni inen parca henuz beets tarafindan kutuphaneye tasinmamis olabilir.
// O aradaki bosluk icin dosyayi diskten dogrudan calariz.
async function dosyaAra(ad, kok = CFG.musicRoot, derinlik = 0) {
  if (derinlik > 6) return null
  let girisler
  try { girisler = await readdir(kok, { withFileTypes: true }) } catch { return null }
  for (const g of girisler) {
    const tam = join(kok, g.name)
    if (g.isDirectory()) {
      const bulunan = await dosyaAra(ad, tam, derinlik + 1)
      if (bulunan) return bulunan
    } else if (g.name === ad) {
      return tam
    }
  }
  return null
}

app.get('/api/yerel/bul', async (c) => {
  const ad = c.req.query('ad')
  if (!ad) return c.json({ hata: 'ad gerekli' }, 400)
  const yol = await dosyaAra(basename(ad))
  if (!yol) return c.json({ bulundu: false })
  return c.json({ bulundu: true, yol: yol.slice(CFG.musicRoot.length) })
})

app.get('/api/yerel/akis', async (c) => {
  const rel = c.req.query('yol') || ''
  // Dizin disina cikma denemesini engelle
  const tam = resolve(join(CFG.musicRoot, rel))
  if (!tam.startsWith(CFG.musicRoot + '/') || !AUDIO_EXT.has(extname(tam).toLowerCase())) return c.body(null, 403)
  const actual=await realpath(tam).catch(()=>null)
  const root=await realpath(CFG.musicRoot)
  if(!actual)return c.body(null,404)
  if(!actual.startsWith(root+'/'))return c.body(null,403)

  let st
  try { st = await stat(tam) } catch { return c.body(null, 404) }
  if (!st.isFile()) return c.body(null, 404)

  const tur = {
    '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg', '.opus': 'audio/opus', '.wav': 'audio/wav',
  }[extname(tam).toLowerCase()] || 'application/octet-stream'

  let range
  try { range=parseRange(c.req.header('range'),st.size) } catch(e) { return c.body(null,416,{'Content-Range':`bytes */${st.size}`}) }
  const headers={'Content-Type':tur,'Content-Length':String(range?range.end-range.start+1:st.size),'Accept-Ranges':'bytes'}
  if(range)headers['Content-Range']=`bytes ${range.start}-${range.end}/${st.size}`
  return new Response(Readable.toWeb(createReadStream(tam,range?{start:range.start,end:range.end}:{})),{status:range?206:200,headers})
})

// ---------------------------------------------------------------- statik

app.get('/downloads/sidewave.apk', serveStatic({path:'./data/downloads/sidewave.apk',onFound:(_,c)=>{c.header('Content-Type','application/vnd.android.package-archive');c.header('Content-Disposition','attachment; filename="sidewave.apk"')}}))
const androidUpdates=createAndroidUpdates('./data/downloads')
app.get('/api/v1/android/update',async c=>{c.header('Cache-Control','no-store');return c.json(await androidUpdates.latest())})
app.get('/downloads/:file',async(c,next)=>{
  const file=c.req.param('file');if(!/^sidewave-[1-9][0-9]{0,9}\.apk$/.test(file))throw new ApiError('NOT_FOUND',"File not found.",404)
  return serveStatic({path:'./data/downloads/'+file,onFound:(_,c)=>{c.header('Content-Type','application/vnd.android.package-archive');c.header('Content-Disposition','attachment; filename="'+file+'"');c.header('Cache-Control','public, max-age=31536000, immutable');c.header('X-Content-Type-Options','nosniff')}})(c,next)
})
app.use('/*', serveStatic({ root: './public' }))

export { app, store, searchAll, mapSong }
if (process.env.SKIP_LISTEN !== '1') {
  migrateNavidrome(store,subsonic,mapSong).then(()=>log('migration_complete')).catch(e=>log('migration_pending',{code:e.code||'NAVIDROME_UNAVAILABLE'}))
  const migrationRetry=setInterval(()=>migrateNavidrome(store,subsonic,mapSong).catch(()=>{}),60000);migrationRetry.unref()
  if(process.env.ARCHIVE_DISABLED!=='1')archive.run()
  membership.start();collections.start();void store.forAccounts(()=>services.resume());analysisJobs.start();onlineDiscovery.startWorker()
  const server=serve({ fetch: app.fetch, port: CFG.port, hostname: '0.0.0.0' }, info => console.log(`[sidewave] :${info.port}`))
  process.on('SIGTERM',()=>{collections.stop();membership.stop();onlineDiscovery.stop();analysisJobs.stop();archive.stop();services.stop();audioCache.stop().finally(()=>server.close(()=>{store.close();process.exit(0)}))})
}
