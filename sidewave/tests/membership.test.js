import test from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { createStore } from '../src/store.js'
import { createMembership } from '../src/membership.js'

function setup(options={}) {
 const base=createStore(':memory:'),membership=createMembership(base,':memory:',options),store=membership.store,app=new Hono()
 membership.install(app)
 app.get('/api/private',c=>c.json({listeler:store.lists(),parcalar:store.favorites(),history:store.history()}))
 app.post('/api/list',async c=>c.json({id:store.createList((await c.req.json()).ad)}))
 app.get('/api/list/:id',c=>{const l=store.list(c.req.param('id'));return c.json(l||{},l?200:404)})
 app.post('/api/favorite',async c=>c.json(store.favorite(await c.req.json(),true)))
 const post=(path,body,cookie)=>app.request(path,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)})
 return {app,base,membership,store,post,close(){membership.stop();base.close()}}
}
const credentials={username:'Anil',password:'testing123'}
test('signup, persistent hashed sessions, login, logout and unauthorized guard',async()=>{
 const s=setup();try{
  assert.equal((await s.app.request('/api/private')).status,401)
  const response=await s.post('/api/auth/signup',credentials);assert.equal(response.status,201)
  const cookie=response.headers.get('set-cookie').split(';')[0];assert.match(response.headers.get('set-cookie'),/HttpOnly/)
  assert.equal((await s.app.request('/api/private',{headers:{cookie}})).status,200)
  const saved=s.base.db.prepare('SELECT * FROM members').get();assert.notEqual(saved.password_hash,credentials.password)
  const token=s.base.db.prepare('SELECT token_hash FROM member_sessions').get().token_hash;assert.ok(!cookie.includes(token))
  assert.equal((await s.post('/api/auth/login',{...credentials,password:'wrong'})).status,401)
  assert.equal((await s.post('/api/auth/signup',credentials)).status,409)
  const login=await s.post('/api/auth/login',credentials);assert.equal(login.status,200)
  await s.post('/api/auth/logout',{},cookie)
  assert.equal((await s.app.request('/api/private',{headers:{cookie}})).status,401)
  assert.equal((await s.app.request('/api/private',{headers:{cookie:'sidewave_music_session=garbage'}})).status,401)
 }finally{s.close()}
})
test('separate accounts preserve original library and prevent guessed list IDs, including asynchronous work',async()=>{
 const s=setup();try{
  s.base.createList('Eski liste')
  const first=await s.post('/api/auth/signup',credentials),cookieA=first.headers.get('set-cookie').split(';')[0]
  const second=await s.post('/api/auth/signup',{username:'Other',password:'testing456'}),cookieB=second.headers.get('set-cookie').split(';')[0]
  assert.equal((await(await s.app.request('/api/private',{headers:{cookie:cookieA}})).json()).listeler.length,1)
  assert.equal((await(await s.app.request('/api/private',{headers:{cookie:cookieB}})).json()).listeler.length,0)
  const list=await(await s.post('/api/list',{ad:'A private'},cookieA)).json()
  assert.equal((await s.app.request('/api/list/'+list.id,{headers:{cookie:cookieB}})).status,404)
  await s.post('/api/favorite',{id:'test',kaynak:'youtube',baslik:'Secret song'},cookieB)
  assert.equal((await(await s.app.request('/api/private',{headers:{cookie:cookieA}})).json()).parcalar.length,0)
  const a=(await first.json()).user.id,b=(await second.json()).user.id
  const staleTab=await s.app.request('/api/private',{headers:{cookie:cookieB,'X-Sidewave-Member':a}})
  assert.equal(staleTab.status,409);assert.equal((await staleTab.json()).code,'SESSION_CHANGED')
  const results=await Promise.all([a,b].map((id,i)=>s.membership.context.run(id,async()=>{await new Promise(r=>setTimeout(r,i?5:15));s.store.createList('async-'+i);return s.store.lists().map(l=>l.ad)})))
  assert.ok(results[0].includes('async-0'));assert.ok(!results[0].includes('async-1'))
  assert.ok(results[1].includes('async-1'));assert.ok(!results[1].includes('async-0'))
  // A captured database handle and a transaction created at startup still select the request's DB.
  const db=s.store.db,insert=db.transaction(name=>s.store.createList(name))
  s.membership.context.run(b,()=>insert('captured transaction'))
  assert.equal(s.base.lists().some(l=>l.ad==='captured transaction'),false)
 }finally{s.close()}
})
test('rejects cross-origin writes, weak passwords and rate-limits authentication',async()=>{
 const s=setup();try{
  const response=await s.app.request('/api/auth/signup',{method:'POST',headers:{origin:'https://attacker.invalid','Content-Type':'application/json'},body:JSON.stringify(credentials)});assert.equal(response.status,403)
  assert.equal((await s.post('/api/auth/signup',{...credentials,password:'weak'})).status,400)
  for(let i=0;i<20;i++)await s.post('/api/auth/login',{username:'bad!',password:'wrong'})
  assert.equal((await s.post('/api/auth/login',credentials)).status,429)
 }finally{s.close()}
})
test('Telegram outbox retries failed sends and marks successful notifications delivered',async()=>{
 let success=false,calls=0
 const s=setup({telegramToken:'fake-token',telegramChatId:'123',fetch:async()=>{calls++;return {ok:success,json:async()=>({ok:success})}}})
 try{
  assert.equal((await s.post('/api/auth/signup',credentials)).status,201)
  await new Promise(r=>setImmediate(r))
  assert.equal(s.base.db.prepare('SELECT delivered FROM member_notifications').get().delivered,0)
  success=true;await s.membership.flushNotifications()
  assert.equal(s.base.db.prepare('SELECT delivered FROM member_notifications').get().delivered,1)
  const before=calls;await s.membership.flushNotifications();assert.equal(calls,before)
 }finally{s.close()}
})
test('configured public HTTPS origin supports proxied login with secure cookies while LAN and cross-origin guards remain isolated',async()=>{
 const s=setup({publicOrigin:'https://music.example.com'});try{
  const send=(url,origin,extra={})=>s.app.request(url,{method:'POST',headers:{'Content-Type':'application/json',origin,...extra},body:JSON.stringify(credentials)})
  const signup=await send('http://music.example.com/api/auth/signup','https://music.example.com')
  assert.equal(signup.status,201);assert.match(signup.headers.get('set-cookie'),/; Secure/)
  const login=await send('http://music.example.com/api/auth/login','https://music.example.com')
  assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/; Secure/)
  const cookie=login.headers.get('set-cookie').split(';')[0]
  const logout=await s.app.request('http://music.example.com/api/auth/logout',{method:'POST',headers:{origin:'https://music.example.com',cookie}})
  assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/; Secure/)
  assert.equal((await send('http://music.example.com/api/auth/login','http://music.example.com')).status,403)
  assert.equal((await send('http://music.example.com/api/auth/login','https://attacker.invalid',{'x-forwarded-proto':'https','x-forwarded-host':'attacker.invalid'})).status,403)
  assert.equal((await send('http://music.example.com/api/auth/login','https://music.example.com',{'sec-fetch-site':'cross-site'})).status,403)
  assert.equal((await send('http://192.168.1.10:4444/api/auth/login','https://music.example.com')).status,403)
  const lan=await send('http://192.168.1.10:4444/api/auth/login','http://192.168.1.10:4444')
  assert.equal(lan.status,200);assert.doesNotMatch(lan.headers.get('set-cookie'),/; Secure/)
 }finally{s.close()}
})
test('Telegram notice carries a signed block link; blocking ends sessions, survives login and can be undone',async()=>{
 let sent
 const s=setup({publicOrigin:'https://music.example.com',telegramToken:'fake-token',telegramChatId:'123',fetch:async(_,init)=>{sent=JSON.parse(init.body);return {ok:true,json:async()=>({ok:true})}}})
 try{
  const owner=await s.post('/api/auth/signup',credentials);assert.equal((await owner.json()).user.owner,true)
  const guest=await s.post('/api/auth/signup',{username:'Guest',password:'testing456'}),cookie=guest.headers.get('set-cookie').split(';')[0],guestId=(await guest.json()).user.id
  await s.membership.flushNotifications()
  const url=new URL(sent.reply_markup.inline_keyboard[0][0].url);assert.equal(url.origin,'https://music.example.com');assert.ok(url.pathname.endsWith(guestId))
  // GET only confirms; a link preview cannot block anyone.
  const page=await s.app.request(url.pathname+url.search);assert.equal(page.status,200);assert.match(await page.text(),/Guest/)
  assert.equal((await s.app.request('/api/private',{headers:{cookie}})).status,200)
  const form=action=>({method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({action,token:url.searchParams.get('token')})})
  assert.equal((await s.app.request(url.pathname,{...form('unblock')})).status,404,'a block token cannot unblock')
  assert.equal((await s.app.request(url.pathname,{...form('block'),body:new URLSearchParams({action:'block',token:'0'.repeat(64)})})).status,404)
  const done=await s.app.request(url.pathname,form('block'));assert.equal(done.status,200)
  assert.equal((await s.app.request('/api/private',{headers:{cookie}})).status,401)
  assert.equal((await s.post('/api/auth/login',{username:'Guest',password:'testing456'})).status,403)
  const undo=(await done.text()).match(/name="token" value="([a-f0-9]{64})"/)[1]
  assert.equal((await s.app.request(url.pathname,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({action:'unblock',token:undo})})).status,200)
  assert.equal((await s.post('/api/auth/login',{username:'Guest',password:'testing456'})).status,200)
  const ownerId=s.base.db.prepare('SELECT id FROM members WHERE legacy_owner=1').get().id
  assert.equal((await s.app.request('/api/auth/moderate/'+ownerId+'?action=block&token='+'0'.repeat(64))).status,404)
 }finally{s.close()}
})
test('owner guard, tunnel-only metrics block and per-visitor limits behind Cloudflare',async()=>{
 const s=setup({publicOrigin:'https://music.example.com'});try{
  s.app.post('/api/owner-only',s.membership.requireOwner,c=>c.json({ok:true}))
  s.app.get('/metrics',c=>c.text('metric 1'))
  const owner=(await s.post('/api/auth/signup',credentials)).headers.get('set-cookie').split(';')[0]
  const guest=(await s.post('/api/auth/signup',{username:'Guest',password:'testing456'})).headers.get('set-cookie').split(';')[0]
  assert.equal((await s.post('/api/owner-only',{},owner)).status,200)
  const denied=await s.post('/api/owner-only',{},guest);assert.equal(denied.status,403);assert.equal((await denied.json()).code,'OWNER_ONLY')
  assert.equal((await s.app.request('http://127.0.0.1:4444/metrics')).status,200)
  assert.equal((await s.app.request('http://music.example.com/metrics')).status,404)
  assert.equal((await s.app.request('http://192.168.1.10:4444/metrics',{headers:{'cf-connecting-ip':'203.0.113.9'}})).status,404)
  const login=(ip,password)=>s.app.request('http://music.example.com/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json','cf-connecting-ip':ip},body:JSON.stringify({...credentials,password})})
  for(let i=0;i<25;i++)assert.equal((await login('198.51.100.1','testing123')).status,200,'successful sign-ins never lock the owner out')
  for(let i=0;i<20;i++)await login('203.0.113.7','wrong-pass1')
  assert.equal((await login('203.0.113.7','testing123')).status,429)
  assert.equal((await login('198.51.100.1','testing123')).status,200,'another visitor is unaffected')
  const signup=(n)=>s.app.request('http://music.example.com/api/auth/signup',{method:'POST',headers:{'Content-Type':'application/json','cf-connecting-ip':'203.0.113.50'},body:JSON.stringify({username:'spam'+n,password:'testing123'})})
  for(let i=0;i<5;i++)assert.equal((await signup(i)).status,201)
  assert.equal((await signup(9)).status,429)
 }finally{s.close()}
})
