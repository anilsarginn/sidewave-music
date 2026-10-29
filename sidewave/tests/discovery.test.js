import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createStore} from '../src/store.js'
import {createDiscovery} from '../src/discovery.js'
const song=id=>({id,baslik:'Song '+id,sanatci:'Artist '+id,sanatciId:'artist-'+id,sure:200,kaynak:'kutuphane'})
function fixture({supported=true,path=['a','b','c'],missing=new Set()}={}){
 const store=createStore(':memory:'),calls=[]
 const subsonic=async(endpoint,{id}={})=>{calls.push([endpoint,id]);if(endpoint==='getSong.view'){if(missing.has(id))throw Error('deleted');return{song:song(id)}}throw Error('Unexpected catalog call')}
 const sonic=async(endpoint)=>{
  if(endpoint==='getOpenSubsonicExtensions.view')return{openSubsonicExtensions:supported?[{name:'sonicSimilarity',versions:[1]}]:[]}
  if(endpoint==='getSonicSimilarTracks.view')return{sonicMatch:[{entry:song('a'),similarity:1},{entry:song('b'),similarity:.82},{entry:song('b'),similarity:.5},{entry:song('c'),similarity:-1}]}
  if(endpoint==='findSonicPath.view')return{sonicMatch:path.map(id=>({entry:song(id),similarity:-1}))}
  throw Error('Unexpected sonic call')
 }
 return{store,calls,d:createDiscovery({store,subsonic,sonicSubsonic:sonic,mapSong:p=>p})}
}
test('only verified local references enter sonic requests; unsupported score stays absent',async()=>{
 const {store,d}=fixture()
 try{
  await assert.rejects(d.similar({id:'cloud-only',kaynak:'youtube'}),{code:'ARCHIVE_REQUIRED'})
  const result=await d.similar(song('a'))
  assert.deepEqual(result.parcalar.map(p=>p.id),['b','c']);assert.equal(result.matches[0].similarity,.82);assert.equal(result.matches[1].similarity,null)
  store.upsert({...song('a'),id:'youtube-a',kaynak:'youtube'})
  assert.equal((await d.similar({id:'youtube-a',kaynak:'youtube'})).seed.id,'a')
 }finally{store.close()}
})
test('mix preview excludes recent and dismissed tracks and never changes an active queue',async()=>{
 const {store,d}=fixture()
 try{store.event({event:'playing',parca:song('b')});store.dismiss(song('c'));store.device('playing',{queue:[song('c')],state:'playing'})
  const result=await d.similar(song('a'),{mix:true})
  assert.deepEqual(result.parcalar.map(p=>p.id),['a']);assert.equal(result.state,'no_results');assert.equal(store.devices()[0].queue[0].id,'c')
 }finally{store.close()}
})
test('paths preserve provider ordering and anchors, reject missing endpoints and hide -1 scores',async()=>{
 for(const config of [{},{path:['b','c']},{missing:new Set(['c'])}]){
  const {store,d}=fixture(config)
  try{
   if(config.path||config.missing)await assert.rejects(d.path(song('a'),song('c')))
   else {const r=await d.path(song('a'),song('c'));assert.deepEqual(r.parcalar.map(p=>p.id),['a','b','c']);assert.ok(r.matches.every(m=>m.similarity===null))}
  }finally{store.close()}
 }
})
test('extension availability is separate from library health and cloud artists cannot be inferred by name',async()=>{
 const {store,d}=fixture({supported:false})
 try{
  assert.equal((await d.capabilities()).available,false)
  await assert.rejects(d.similar(song('a')),{code:'SONIC_UNAVAILABLE'})
  const a=store.catalog.put('artist','youtube','same-name',{ad:'Artist a'})
  await assert.rejects(d.artists(a.appId),{code:'ARCHIVE_REQUIRED'})
 }finally{store.close()}
})
test('artist results without provider IDs use representative recording credits; ambiguous credits are omitted',async()=>{
 const store=createStore(':memory:')
 try{
  const seed=store.catalog.put('artist','kutuphane','seed',{ad:'Namesake'})
  const d=createDiscovery({store,mapSong:p=>p,subsonic:async(_,{id})=>({song:{...song(id),artistId:id==='candidate'?'correct-artist':id,sanatci:'Namesake',artist:'Correct Artist'}}),
   sonicSubsonic:async endpoint=>endpoint==='getOpenSubsonicExtensions.view'?{openSubsonicExtensions:[{name:'sonicSimilarity',versions:[1]}]}:{artistInfo2:{similarArtist:[]}},
   audioArtists:async()=>[{artist:'Namesake',artist_id:null,component_matches:[{artist2_representative_songs:[{item_id:'candidate'}]}]},{artist:'Ambiguous',component_matches:[{artist2_representative_songs:[{item_id:'one'},{item_id:'two'}]}]}]})
  const result=await d.artists(seed.appId)
  assert.deepEqual(result.sanatcilar.map(a=>a.id),['correct-artist']);assert.equal(result.sanatcilar[0].ad,'Correct Artist')
 }finally{store.close()}
})
