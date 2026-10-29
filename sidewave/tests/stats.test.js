import test from 'node:test'
import assert from 'node:assert/strict'
import { createStore } from '../src/store.js'
import { createSpotifyHistory } from '../src/spotify-history.js'
import { computeStats } from '../src/stats.js'

test('stats combine Sidewave summaries and Spotify plays by range, artist, track and Istanbul hour',()=>{
 const store=createStore(':memory:'),now=Date.parse('2026-10-26T12:00:00Z')
 const a=store.upsert({id:'aaaaaaaaaaa',kaynak:'youtube',baslik:'Kuzu Kuzu',sanatci:'Tarkan'})
 const summary=(ago,ms)=>store.db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),'d','summary',a.appId,'r',now-ago,JSON.stringify({playedMs:ms}))
 summary(3600000,180000);summary(7200000,200000);summary(7300000,5000)
 summary(100*86400000,240000)
 createSpotifyHistory(store).apply({plays:[{at:new Date(now-86400000).toISOString(),ms:500000,uri:'',title:'Brown Bag',artist:'Boogaloo Joe Jones',end:'trackdone',skipped:false}],onRepeat:[],terms:{},kinds:['account']})
 const recent=computeStats(store,{range:'4w',now})
 assert.equal(recent.plays,3,'plays under 30 s count as minutes only');assert.equal(recent.artists,2)
 assert.equal(recent.topTracks[0].track.baslik,'Kuzu Kuzu');assert.equal(recent.topTracks[0].plays,2);assert.equal(recent.topTracks[0].playable,true)
 assert.equal(recent.topArtists[0].artist,'Boogaloo Joe Jones','artists rank by minutes');assert.equal(recent.sources.spotify,8)
 assert.equal(recent.hours[(new Date(now-3600000).getUTCHours()+3)%24],3)
 assert.equal(computeStats(store,{range:'all',now}).plays,4)
 store.close()
})
