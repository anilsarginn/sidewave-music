import {test} from 'node:test'
import assert from 'node:assert/strict'
import {rankRecommendations} from '../src/recommendations.js'
test('taste ranking favors liked artists while enforcing diversity and excluding recent/skipped/dismissed',()=>{
 const p=(id,artist)=>({id,appId:id,sanatci:artist,kaynak:'kutuphane'}),candidates=[p('new','New'),p('fav1','Liked'),p('fav2','Liked'),p('fav3','Liked'),p('recent','Other'),p('skip','Skip'),p('hide','Hide')]
 const ranked=rankRecommendations({candidates,favorites:[p('old','Liked')],recent:[p('recent','Other')],skipped:new Set(['skip']),dismissed:id=>id==='hide'})
 assert.deepEqual(ranked.map(p=>p.id),['fav1','fav2','new'])
})
import {createStore} from '../src/store.js'
import {skipSignals,artistListening} from '../src/recommendations.js'
test('only heard-then-skipped tracks are negative signals; pre-sound, error and pick-another transitions are ignored',()=>{
 const store=createStore(':memory:'),now=Date.now()
 const track=(id,artist)=>store.upsert({id,kaynak:'youtube',baslik:'Song '+id,sanatci:artist})
 const skip=(t,json,ago=1000)=>store.db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),'d','skip',t.appId,'r',now-ago,JSON.stringify(json))
 const heard=track('heard','Loud'),early=track('early','Quiet'),errored=track('err','Quiet'),picked=track('pick','Quiet')
 for(let i=0;i<2;i++){skip(heard,{position:8,reason:'next'});skip(early,{position:0});skip(errored,{position:4,reason:'error'});skip(picked,{position:6,reason:'select'})}
 const {tracks}=skipSignals(store,{now})
 assert.deepEqual([...tracks],[heard.appId])
 // Legacy events without a reason still count once the song actually played.
 const legacy=track('legacy','Old');skip(legacy,{position:3});skip(legacy,{position:12})
 assert.ok(skipSignals(store,{now}).tracks.has(legacy.appId))
 store.close()
})
test('repeated early skips lower an artist unless it is a favourite; listening time raises affinity',()=>{
 const store=createStore(':memory:'),now=Date.now()
 const add=(id,artist)=>store.upsert({id,kaynak:'youtube',baslik:'Song '+id,sanatci:artist})
 for(const id of ['a','b','c']){const t=add(id,'Skipped Band');store.db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),'d','skip',t.appId,'r',now-5000,JSON.stringify({position:5,reason:'next'}))}
 const loved=add('l','Long Listen');store.db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),'d','summary',loved.appId,'r',now-5000,JSON.stringify({playedMs:30*60000}))
 const {artists}=skipSignals(store,{now});assert.equal(artists.get('skipped band'),3)
 const listening=artistListening(store,{now});assert.equal(listening.get('long listen'),30*60000)
 const p=(id,artist)=>({id,appId:id,sanatci:artist,kaynak:'youtube'})
 const ranked=rankRecommendations({candidates:[p('x','Skipped Band'),p('y','Neutral'),p('z','Long Listen')],favorites:[],recent:[],skipped:new Set(),skippedArtists:artists,artistListening:listening,dismissed:()=>false})
 assert.deepEqual(ranked.map(t=>t.id),['z','y','x'])
 const forgiven=rankRecommendations({candidates:[p('x','Skipped Band'),p('y','Neutral')],favorites:[p('f','Skipped Band')],recent:[],skipped:new Set(),skippedArtists:artists,dismissed:()=>false})
 assert.equal(forgiven[0].id,'x')
 store.close()
})
test('artist-level dismiss hides every recording by the artist and can be undone',()=>{
 const store=createStore(':memory:')
 const a=store.upsert({id:'1',kaynak:'youtube',baslik:'One',sanatci:'Hidden Artist'}),b=store.upsert({id:'2',kaynak:'youtube',baslik:'Two',sanatci:'hidden artist'}),c=store.upsert({id:'3',kaynak:'youtube',baslik:'Three',sanatci:'Kept'})
 store.dismiss(a,'artist')
 assert.equal(store.isDismissed(a.appId),true);assert.equal(store.isDismissed(b.appId),true);assert.equal(store.isDismissed(c.appId),false)
 assert.equal(store.dismissedArtists()[0].label,'Hidden Artist')
 store.undismiss(b,'artist');assert.equal(store.isDismissed(a.appId),false)
 store.dismiss(c);assert.equal(store.isDismissed(c.appId),true);store.undismiss(c);assert.equal(store.isDismissed(c.appId),false)
 store.close()
})
