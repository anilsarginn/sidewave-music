import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash, createHmac } from 'node:crypto'
import { promisify } from 'node:util'
import { dirname, join } from 'node:path'
import { getCookie, setCookie } from 'hono/cookie'
import { getConnInfo } from '@hono/node-server/conninfo'
import { createStore } from './store.js'

const scrypt = promisify(scryptCallback), COOKIE = 'sidewave_music_session', TTL = 30 * 86400000
const digest = value => createHash('sha256').update(value).digest('hex')
const escape = value => String(value).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))

// A request and its asynchronous continuations always use the same account store.
// The original library belongs to the first account; later accounts start empty.
export function createMembership(base, databasePath, options = {}) {
  const context = new AsyncLocalStorage(), stores = new Map(), db = base.db
  const configuredOrigin = options.publicOrigin ?? process.env.MUSIC_PUBLIC_ORIGIN
  const publicUrl = configuredOrigin ? new URL(configuredOrigin) : null
  if (publicUrl && (publicUrl.protocol !== 'https:' || publicUrl.username || publicUrl.password || publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash)) throw new Error('MUSIC_PUBLIC_ORIGIN must be an HTTPS origin')
  // Cloudflare terminates HTTPS; the local HTTP request retains the public Host.
  // Trust only the explicitly configured origin, never forwarded header values.
  function requestOrigin(c) {
    const url = new URL(c.req.url)
    return publicUrl && url.host === publicUrl.host ? publicUrl.origin : url.origin
  }
  db.exec(`CREATE TABLE IF NOT EXISTS members(id TEXT PRIMARY KEY, username TEXT NOT NULL, username_key TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created INTEGER NOT NULL, legacy_owner INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS member_sessions(token_hash TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS member_notifications(member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE, json TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0);`)
  if (!db.prepare('PRAGMA table_info(members)').all().some(c => c.name === 'blocked')) db.exec('ALTER TABLE members ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0')
  // Telegram moderation links are signed per member and action; the key never leaves this database.
  const moderationKey = base.setting('memberModerationKey') || base.setting('memberModerationKey', randomBytes(32).toString('hex'))
  const sign = (action, id) => createHmac('sha256', moderationKey).update(action + ':' + id).digest('hex')
  const signed = (action, id, token) => typeof token === 'string' && token.length === 64 && timingSafeEqual(Buffer.from(token), Buffer.from(sign(action, id)))
  // Through the tunnel every request arrives from the same local address; Cloudflare sets
  // cf-connecting-ip and a client cannot override it there. Direct LAN requests use the socket.
  const viaTunnel = c => !!c.req.header('cf-connecting-ip') || (!!publicUrl && new URL(c.req.url).host === publicUrl.host)
  function clientKey(c) {
    const forwarded = c.req.header('cf-connecting-ip')
    if (viaTunnel(c) && forwarded && /^[0-9a-f:.]{2,45}$/i.test(forwarded)) return forwarded
    try { return getConnInfo(c).remote.address || 'local' } catch { return 'local' }
  }
  function accountStore(id) {
    if (!id) return base
    if (db.prepare('SELECT legacy_owner FROM members WHERE id=?').get(id)?.legacy_owner) return base
    if (!stores.has(id)) {
      const own = createStore(databasePath === ':memory:' ? ':memory:' : join(dirname(databasePath), 'members', id + '.sqlite'))
      // Include feature schemas registered at startup, with no other account's rows.
      for (const row of db.prepare("SELECT type,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END").all()) {
        if (!['table','index'].includes(row.type)) continue
        own.db.exec(row.sql.replace(/^CREATE (TABLE|UNIQUE INDEX|INDEX) /i, 'CREATE $1 IF NOT EXISTS '))
      }
      stores.set(id, own)
    }
    return stores.get(id)
  }
  const selected = () => accountStore(context.getStore())
  const catalog = new Proxy({}, {get: (_, key) => (...args) => selected().catalog[key](...args)})
  const database = new Proxy({}, {get: (_, key) => {
    if (key === 'transaction') return callback => (...args) => selected().db.transaction(callback)(...args)
    if (key === 'prepare') return sql => new Proxy({}, {get: (_, method) => (...args) => selected().db.prepare(sql)[method](...args)})
    const value = selected().db[key]
    return typeof value === 'function' ? (...args) => selected().db[key](...args) : value
  }})
  async function forAccounts(task) {
    await context.run(undefined, task)
    for (const row of db.prepare('SELECT id FROM members WHERE legacy_owner=0').all()) await context.run(row.id, task)
  }
  const store = new Proxy({}, {get: (_, key) => key === 'accountId' ? (context.getStore() || 'legacy') : key === 'forAccounts' ? forAccounts : key === 'db' ? database : key === 'catalog' ? catalog : (...args) => selected()[key](...args)})
  function session(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null
    const row = db.prepare('SELECT m.id,m.username,m.legacy_owner FROM member_sessions s JOIN members m ON m.id=s.member_id WHERE s.token_hash=? AND s.expires>? AND m.blocked=0').get(digest(token), Date.now())
    return row ? {id:row.id,username:row.username,owner:!!row.legacy_owner} : null
  }
  function issue(c, user) {
    const token = randomBytes(32).toString('hex')
    db.prepare('DELETE FROM member_sessions WHERE expires<=?').run(Date.now())
    db.prepare('INSERT INTO member_sessions VALUES(?,?,?)').run(digest(token), user.id, Date.now()+TTL)
    setCookie(c, COOKIE, token, {httpOnly:true,sameSite:'Lax',secure:requestOrigin(c).startsWith('https:'),path:'/',maxAge:TTL/1000})
  }
  async function hash(password, salt=randomBytes(16).toString('hex')) {
    return salt + ':' + (await scrypt(password, salt, 64)).toString('hex')
  }
  // Failed sign-ins and every sign-up count per client; a successful sign-in does not.
  const attempts = new Map(), LIMITS = {login:{max:20,window:15*60000},signup:{max:5,window:60*60000}}
  function attempt(c, mode, record) {
    const key = mode+':'+clientKey(c), now = Date.now(), old = attempts.get(key), limit = LIMITS[mode]
    if (attempts.size>10000) for (const [k,value] of attempts) if(value.until<now)attempts.delete(k)
    const item = old && old.until>now ? old : {count:0,until:now+limit.window}
    attempts.set(key,item)
    if (record) item.count++
    if (item.count>=limit.max+(record?1:0)) return c.json({code:'AUTH_RATE_LIMIT',message:mode==='signup'?"Too many new accounts from this network. Please try again later.":"Too many attempts. Please try again in 15 minutes."},429)
  }
  const isOwner = c => !!c.get('member')?.owner || (!!options.testBypass && !c.get('member'))
  // Archive, Soulseek and server-wide settings act on the owner's accounts and disk.
  const requireOwner = async (c,next) => isOwner(c) ? next() : c.json({code:'OWNER_ONLY',message:"Only the library owner can do this.",retryable:false},403)
  const publicPaths = new Set(['/api/health','/api/v1/android/update'])
  function install(app) {
    app.use('*', async (c,next) => {
      const path = c.req.path
      if (!['GET','HEAD','OPTIONS'].includes(c.req.method)) {
        const origin = c.req.header('origin')
        if (c.req.header('sec-fetch-site') === 'cross-site' || (origin && origin !== requestOrigin(c))) return c.json({code:'ORIGIN_REJECTED',message:"This request origin is not allowed."},403)
      }
      const user = session(getCookie(c,COOKIE))
      c.set('member', user)
      const expectedMember=c.req.header('x-sidewave-member')
      if(user && expectedMember && expectedMember!==user.id && !path.startsWith('/api/auth/')) return c.json({code:'SESSION_CHANGED',message:"The account open in this browser has changed."},409)
      if (path.startsWith('/api/') && !path.startsWith('/api/auth/') && !publicPaths.has(path) && !user && !options.testBypass) return c.json({code:'SIGN_IN_REQUIRED',message:"Sign in to continue."},401)
      // Prometheus scrapes locally; the public hostname does not expose metrics.
      if (path.startsWith('/metrics') && viaTunnel(c) && !user?.owner) return c.body(null,404)
      if (path.startsWith('/api/') && path !== '/api/health') c.header('Cache-Control','private, no-store')
      return context.run(user?.id, next)
    })
    app.get('/api/auth/me',c=>c.json({user:c.get('member'),firstAccount:!db.prepare('SELECT 1 FROM members LIMIT 1').get()}))
    for (const mode of ['signup','login']) app.post('/api/auth/'+mode, async c => {
      const limited=attempt(c,mode,mode==='signup'); if(limited)return limited
      let body; try {body=await c.req.json()}catch{return c.json({message:"Please submit a valid form."},400)}
      const username=typeof body.username==='string'?body.username.trim().normalize('NFC'):'', password=body.password
      if(!/^[\p{L}\p{N}_-]{3,24}$/u.test(username) || typeof password!=='string' || Buffer.byteLength(password)>256) return (mode==='login'&&attempt(c,'login',true))||c.json({message:"Use 3–24 letters, numbers, underscores or hyphens for your username."},400)
      const key=username.toLocaleLowerCase('tr-TR')
      if(mode==='signup') {
        if(password.length<8 || !/\p{L}/u.test(password) || !/\p{N}/u.test(password))return c.json({message:"Your password needs at least 8 characters, including a letter and a number."},400)
        if(db.prepare('SELECT id FROM members WHERE username_key=?').get(key))return c.json({message:"That username is already taken."},409)
        const passwordHash=await hash(password)
        const user={id:randomUUID(),username}
        try {db.transaction(()=>{
          const first=!db.prepare('SELECT 1 FROM members LIMIT 1').get()
          db.prepare('INSERT INTO members(id,username,username_key,password_hash,created,legacy_owner) VALUES(?,?,?,?,?,?)').run(user.id,username,key,passwordHash,Date.now(),first?1:0)
          db.prepare('INSERT INTO member_notifications VALUES(?,?,0)').run(user.id,JSON.stringify({username,created:Date.now(),agent:String(c.req.header('user-agent')||'').slice(0,300)}))
        })()}catch(e){if(e.code==='SQLITE_CONSTRAINT_UNIQUE')return c.json({message:"That username is already taken."},409);throw e}
        issue(c,user);void flushNotifications();return c.json({user:{...user,owner:!!db.prepare('SELECT legacy_owner FROM members WHERE id=?').get(user.id).legacy_owner}},201)
      }
      const user=db.prepare('SELECT * FROM members WHERE username_key=?').get(key)
      const expected=user?.password_hash || '00000000000000000000000000000000:'+ '0'.repeat(128)
      const actual=await hash(password,expected.split(':')[0])
      if(!user || !timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))return attempt(c,'login',true)||c.json({message:"Incorrect username or password."},401)
      if(user.blocked)return c.json({code:'ACCOUNT_BLOCKED',message:"This account has been disabled."},403)
      issue(c,user);return c.json({user:{id:user.id,username:user.username,owner:!!user.legacy_owner}})
    })
    // Opened from the Telegram signup notice. GET only shows a confirmation so that link
    // previews cannot change anything; the signed form POST applies the action.
    app.get('/api/auth/moderate/:id',c=>{
      const id=c.req.param('id'),action=c.req.query('action'),token=c.req.query('token'),member=db.prepare('SELECT * FROM members WHERE id=?').get(id)
      if(!['block','unblock'].includes(action) || !member || !signed(action,id,token))return moderationPage(c,'Bağlantı geçersiz','Bu bağlantı geçersiz ya da süresi dolmuş.',null,404)
      if(member.legacy_owner)return moderationPage(c,'İşlem yapılamaz','Kütüphane sahibinin hesabı engellenemez.',null,400)
      const verb=action==='block'?'Engelle':'Engeli kaldır'
      return moderationPage(c,verb+': '+member.username,action==='block'?'Hesap kapatılır ve açık oturumları sonlandırılır. Verileri silinmez, istediğin zaman geri alabilirsin.':'Hesap yeniden giriş yapabilir.',{action,id,token,label:verb})
    })
    app.post('/api/auth/moderate/:id',async c=>{
      const id=c.req.param('id'),form=await c.req.parseBody().catch(()=>({})),action=form.action,member=db.prepare('SELECT * FROM members WHERE id=?').get(id)
      if(!['block','unblock'].includes(action) || !member || member.legacy_owner || !signed(action,id,form.token))return moderationPage(c,'Bağlantı geçersiz','Bu bağlantı geçersiz ya da süresi dolmuş.',null,404)
      db.transaction(()=>{db.prepare('UPDATE members SET blocked=? WHERE id=?').run(action==='block'?1:0,id);if(action==='block')db.prepare('DELETE FROM member_sessions WHERE member_id=?').run(id)})()
      return action==='block'
        ?moderationPage(c,member.username+' engellendi','Hesap kapatıldı ve tüm oturumları sonlandırıldı.',{action:'unblock',id,token:sign('unblock',id),label:'Geri al',secondary:true})
        :moderationPage(c,member.username+' yeniden aktif','Hesap tekrar giriş yapabilir.',{action:'block',id,token:sign('block',id),label:'Tekrar engelle',secondary:true})
    })
    app.post('/api/auth/logout',c=>{
      const token=getCookie(c,COOKIE)
      if(token)db.prepare('DELETE FROM member_sessions WHERE token_hash=?').run(digest(token))
      setCookie(c,COOKIE,'',{httpOnly:true,sameSite:'Lax',secure:requestOrigin(c).startsWith('https:'),path:'/',maxAge:0});return c.json({ok:true})
    })
  }
  function moderationPage(c,title,text,form,status=200) {
    c.header('Cache-Control','no-store');c.header('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'");c.header('Referrer-Policy','no-referrer')
    const button=form?`<form method="post" action="/api/auth/moderate/${encodeURIComponent(form.id)}"><input type="hidden" name="action" value="${escape(form.action)}"><input type="hidden" name="token" value="${escape(form.token)}"><button class="${form.secondary?'secondary':''}">${escape(form.label)}</button></form>`:''
    return c.html(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Sidewave</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1020;color:#e8ecf5;font:16px/1.5 system-ui,sans-serif}main{max-width:420px;margin:16px;padding:28px;border-radius:18px;background:#141b31;box-shadow:0 10px 40px #0006}small{color:#8b95ad;letter-spacing:.12em;text-transform:uppercase}h1{font-size:22px;margin:.3em 0}p{color:#b8c0d4}button{width:100%;margin-top:12px;padding:14px;border:0;border-radius:999px;background:#e5484d;color:#fff;font-weight:600;font-size:16px;cursor:pointer}button.secondary{background:#26304d}</style></head><body><main><small>Sidewave · Üyelik</small><h1>${escape(title)}</h1><p>${escape(text)}</p>${button}</main></body></html>`,status)
  }
  let busy=false,timer
  async function flushNotifications() {
    const token=options.telegramToken ?? process.env.MUSIC_TELEGRAM_BOT_TOKEN,chatId=options.telegramChatId ?? process.env.MUSIC_TELEGRAM_CHAT_ID
    if(busy || !token || !chatId)return
    busy=true
    try {
      for(const row of db.prepare('SELECT * FROM member_notifications WHERE delivered=0 LIMIT 10').all()) {
        const info=JSON.parse(row.json)
        const text=`<b>🎵 Sidewave · Yeni üyelik</b>\n\n<b>Kullanıcı:</b> ${escape(info.username)}\n<b>Kayıt:</b> ${escape(new Date(info.created).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul'}))}\n<b>Cihaz:</b> ${escape(info.agent)}`
        const markup=publicUrl?{reply_markup:{inline_keyboard:[[{text:'🚫 Engelle',url:`${publicUrl.origin}/api/auth/moderate/${row.member_id}?action=block&token=${sign('block',row.member_id)}`}]]}}:{}
        const response=await (options.fetch||fetch)(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,text,parse_mode:'HTML',...markup}),signal:AbortSignal.timeout(10000)})
        if(!response.ok || !(await response.json()).ok)break
        db.prepare('UPDATE member_notifications SET delivered=1 WHERE member_id=?').run(row.member_id)
      }
    }catch{ /* Durable outbox retries without failing registration. */ }finally{busy=false}
  }
  return {store,install,session,context,accountStore,flushNotifications,requireOwner,viaTunnel,clientKey,start(){timer=setInterval(()=>void flushNotifications(),30000);timer.unref();void flushNotifications()},stop(){clearInterval(timer);for(const own of stores.values())own.close()}}
}
