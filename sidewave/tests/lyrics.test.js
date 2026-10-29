import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {cleanTitle,primaryArtist,parseLrc,createLyrics} from '../src/lyrics.js'

test('cleans provider titles and picks the primary artist',()=>{
 assert.equal(cleanTitle('Kuzu Kuzu (Official Video)'),'Kuzu Kuzu')
 assert.equal(cleanTitle('Song [Remastered 2011] (Lyric Video)'),'Song')
 assert.equal(cleanTitle('Love (Live)'),'Love (Live)','meaningful qualifiers stay')
 assert.equal(primaryArtist('Sezen Aksu & Tarkan'),'Sezen Aksu')
 assert.equal(primaryArtist('Artist feat. Guest'),'Artist')
})
test('parses LRC including repeated timestamps',()=>{
 const lines=parseLrc('[00:12.50]First\n[00:05.00][01:00.00]Chorus\nno stamp\n[00:20]Last')
 assert.deepEqual(lines.map(l=>[l.t,l.text]),[[5,'Chorus'],[12.5,'First'],[20,'Last'],[60,'Chorus']])
})
test('uses exact match, falls back to search within duration, caches not-found, and never caches a network failure',async()=>{
 const db=new Database(':memory:');const urls=[];let down=false
 const fetch=async url=>{urls.push(url);if(down)throw new Error('offline')
  if(url.includes('/get?'))return {status:404,ok:false}
  return {status:200,ok:true,json:async()=>url.includes('Nothing')?[]:[{duration:400,syncedLyrics:'[00:01.00]Wrong'},{duration:181,syncedLyrics:'[00:01.00]Right'}]}}
 const lyrics=createLyrics({db,fetch,libraryLyrics:async t=>t.kaynak==='kutuphane'?'Own words':null})
 const r=await lyrics.get({kaynak:'youtube',id:'a',baslik:'Song (Official Audio)',sanatci:'Band',sure:180})
 assert.deepEqual(r.synced,[{t:1,text:'Right'}]);assert.equal(r.source,'lrclib')
 assert.match(urls[0],/track_name=Song&artist_name=Band&duration=180/)
 const calls=urls.length;await lyrics.get({kaynak:'youtube',id:'a',baslik:'Song',sanatci:'Band',sure:180});assert.equal(urls.length,calls,'cached')
 const own=await lyrics.get({kaynak:'kutuphane',id:'n',baslik:'Nothing',sanatci:'Band'});assert.equal(own.plain,'Own words');assert.equal(own.source,'library')
 down=true
 const failed=await lyrics.get({kaynak:'youtube',id:'b',baslik:'Other',sanatci:'Band'});assert.equal(failed.synced,null)
 assert.equal(db.prepare("SELECT COUNT(*) n FROM lyrics WHERE key='youtube:b'").get().n,0)
})
