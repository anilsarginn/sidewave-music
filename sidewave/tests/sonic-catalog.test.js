import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createSonicCatalogBridge,mediaIdentity} from '../src/sonic-catalog.js'
test('replica IDs match only the same complete relative path, byte size and duration',async()=>{
 const local=[{id:'old',path:'Artist/Album/song.flac',size:10000,duration:200,artistId:'old-artist'},{id:'other',path:'Other/Album/song.flac',size:10000,duration:200},{id:'changed',path:'A/changed.flac',size:20000,duration:200}]
 const remote=[{id:'new',path:'Artist/Album/song.flac',size:10000,duration:200,artistId:'new-artist'},{id:'wrong',path:'A/changed.flac',size:20001,duration:200}]
 let calls=0
 const api=songs=>async endpoint=>{calls++;return endpoint==='getAlbumList2.view'?{albumList2:{album:[{id:'album'}]}}:{album:{song:songs}}}
 const b=createSonicCatalogBridge({subsonic:api(local),sonicSubsonic:api(remote),replica:true})
 assert.equal(await b.toTrack('old'),'new');assert.equal(await b.fromTrack('new'),'old')
 assert.equal(await b.toArtist('old-artist'),'new-artist');assert.equal(await b.fromArtist('new-artist'),'old-artist')
 assert.equal(await b.fromTrack('wrong'),null);await assert.rejects(b.toTrack('other'),{code:'SONIC_SOURCE_MISMATCH'});await assert.rejects(b.toTrack('changed'),{code:'SONIC_SOURCE_MISMATCH'})
 assert.equal(calls,4);assert.equal(mediaIdentity({path:'x',duration:2}),null)
})
test('ambiguous duplicate files are rejected and ordinary same-server IDs need no catalog scan',async()=>{
 const song={path:'A/a.flac',size:10000,duration:100}
 const api=async endpoint=>endpoint==='getAlbumList2.view'?{albumList2:{album:[{id:'album'}]}}:{album:{song:[{...song,id:'one'},{...song,id:'two'}]}}
 const bridge=createSonicCatalogBridge({subsonic:api,sonicSubsonic:api,replica:true})
 await assert.rejects(bridge.toTrack('one'),{code:'SONIC_SOURCE_MISMATCH'})
 const direct=createSonicCatalogBridge({replica:false});assert.equal(await direct.toTrack('one'),'one');assert.equal(await direct.fromArtist('artist'),'artist')
})
