import test from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { createStore } from '../src/store.js'
import { createMembership } from '../src/membership.js'
import { installSharing } from '../src/sharing.js'

function setup(){
 const base=createStore(':memory:'),membership=createMembership(base,':memory:',{publicOrigin:'https://music.example.com'}),store=membership.store,app=new Hono()
 app.onError((e,c)=>c.json({code:e.code},e.status||500))
 membership.install(app);installSharing(app,{db:base.db,store,membership,publicOrigin:'https://music.example.com'})
 app.post('/api/list',async c=>{const id=store.createList('Road');store.add(id,[{id:'v1aaaaaaaaa',kaynak:'youtube',baslik:'One',sanatci:'A'}]);return c.json({id})})
 app.get('/api/mine',c=>c.json({lists:store.lists()}))
 const call=(path,cookie,method='GET',body)=>app.request(path,{method,headers:{'Content-Type':'application/json',cookie},body:body?JSON.stringify(body):undefined})
 const signup=async name=>(await app.request('/api/auth/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:name,password:'testing123'})})).headers.get('set-cookie').split(';')[0]
 return {call,signup,close(){membership.stop();base.close()}}
}

test('view links let other members listen and save a copy; edit links let them add and remove; revoking ends access',async()=>{
 const s=setup();try{
  const owner=await s.signup('Anil'),guest=await s.signup('Guest')
  const {id}=await(await s.call('/api/list',owner,'POST')).json()
  assert.equal((await s.call(`/api/v1/playlists/${id}/share`,guest,'POST',{mode:'view'})).status,404,'only the owner can share')
  const view=await(await s.call(`/api/v1/playlists/${id}/share`,owner,'POST',{mode:'view'})).json()
  assert.match(view.url,/^https:\/\/music\.example\.com\/#\/shared\//)
  const shared=await(await s.call('/api/v1/shared/'+view.token,guest)).json()
  assert.equal(shared.ad,'Road');assert.equal(shared.owner,'Anil');assert.equal(shared.mine,false);assert.equal(shared.parcalar.length,1)
  assert.equal((await s.call(`/api/v1/shared/${view.token}/tracks`,guest,'POST',{parcalar:[{id:'v2aaaaaaaaa',kaynak:'youtube',baslik:'Two',sanatci:'B'}]})).status,403)
  const copy=await(await s.call(`/api/v1/shared/${view.token}/save`,guest,'POST')).json()
  assert.equal((await(await s.call('/api/mine',guest)).json()).lists.find(l=>l.id===copy.id).parcaSayisi,1)
  const edit=await(await s.call(`/api/v1/playlists/${id}/share`,owner,'POST',{mode:'edit'})).json()
  assert.equal((await s.call(`/api/v1/shared/${edit.token}/tracks`,guest,'POST',{parcalar:[{id:'v2aaaaaaaaa',kaynak:'youtube',baslik:'Two',sanatci:'B'}]})).status,200)
  assert.equal((await(await s.call('/api/mine',owner)).json()).lists[0].parcaSayisi,2,'the owner sees the collaborator’s song')
  await s.call(`/api/v1/shared/${edit.token}/follow`,guest,'PUT',{following:true})
  const followed=await(await s.call('/api/v1/shared',guest)).json();assert.equal(followed.listeler[0].id,'share:'+edit.token);assert.equal(followed.listeler[0].mode,'edit')
  const entry=(await(await s.call('/api/v1/shared/'+edit.token,guest)).json()).parcalar[1].entryId
  assert.equal((await s.call(`/api/v1/shared/${edit.token}/tracks`,guest,'DELETE',{entryId:entry})).status,200)
  await s.call(`/api/v1/playlists/${id}/share`,owner,'DELETE',{mode:'edit'})
  assert.equal((await s.call('/api/v1/shared/'+edit.token,guest)).status,404)
  assert.equal((await(await s.call('/api/v1/shared',guest)).json()).listeler.length,0)
  assert.equal((await s.call('/api/v1/shared/'+view.token,guest)).status,200,'the view link is independent')
 }finally{s.close()}
})
test('a song link resolves for another member, in their own account, and is stable per recording',async()=>{
 const s=setup();try{
  const owner=await s.signup('Anil'),guest=await s.signup('Guest')
  const song={id:'kJQP7kiw5Fk',kaynak:'youtube',baslik:'Despacito',sanatci:'Luis Fonsi',appId:'private-id',favori:true}
  const first=await(await s.call('/api/v1/tracks/share',owner,'POST',{parca:song})).json()
  const again=await(await s.call('/api/v1/tracks/share',guest,'POST',{parca:song})).json()
  assert.equal(first.token,again.token);assert.match(first.url,/\/#\/song\//)
  const opened=await(await s.call('/api/v1/tracks/shared/'+first.token,guest)).json()
  assert.equal(opened.parca.baslik,'Despacito');assert.equal(opened.sharedBy,'Anil');assert.notEqual(opened.parca.appId,'private-id');assert.equal(opened.parca.favori,false)
  assert.equal((await s.call('/api/v1/tracks/shared/nope-nope-nope',guest)).status,404)
 }finally{s.close()}
})
