import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exactArtistMatches, rankSearchTracks } from '../src/search.js'

test('artist-name searches surface the artist recordings above unrelated same-title songs', () => {
  const own = {id:'own', baslik:'Hiraeth', sanatci:'People Around', kaynak:'youtube'}
  const named = {id:'named', baslik:'People Around', sanatci:'Another Artist', kaynak:'youtube'}
  const partial = {id:'partial', baslik:'People Around Me', sanatci:'Another Artist', kaynak:'youtube'}
  const artists = [{id:'artist-a', ad:'People Around', kaynak:'youtube'}]
  assert.deepEqual(rankSearchTracks(' PEOPLE AROUND ', [partial, named, own], artists).map(p=>p.id), ['own','named','partial'])
})

test('ranking preserves versions and prefers local media only within equal relevance', () => {
  const remix = {id:'remix', baslik:'Nightcall (Remix)', sanatci:'Artist', kaynak:'kutuphane'}
  const remote = {id:'remote', baslik:'Nightcall', sanatci:'Artist', kaynak:'youtube'}
  const local = {id:'local', baslik:'Nightcall', sanatci:'Artist', kaynak:'kutuphane'}
  const input = [remix, remote, local]
  assert.deepEqual(rankSearchTracks('Nightcall', input).map(p=>p.id), ['local','remote','remix'])
  assert.equal(input[0], remix)
  assert.equal(remix.baslik, 'Nightcall (Remix)')
})

test('exact artist lookup is bounded and keeps different same-name channel identities', () => {
  const artists = [{id:'one',ad:'Björk',kaynak:'youtube'},{id:'one',ad:'Björk',kaynak:'youtube'},{id:'two',ad:'BJÖRK',kaynak:'youtube'},{id:'three',ad:'Björk',kaynak:'youtube'},{id:'local',ad:'Björk',kaynak:'kutuphane'},{id:'other',ad:'Björk Covers',kaynak:'youtube'}]
  assert.deepEqual(exactArtistMatches('bjork', artists).map(a=>a.id), ['one','two'])
  assert.deepEqual(exactArtistMatches('', artists), [])
})

test('artist plus title queries rank actual credited recordings above title-stuffed parodies and preserve requested versions',()=>{
 const parody={id:'parody',baslik:'Daft Punk Get Lucky Happy Wheels Parody',sanatci:'Other Artist',kaynak:'youtube'}
 const cover={id:'cover',baslik:'Get Lucky (Made Popular By Daft Punk) [Instrumental Version]',sanatci:'Cover Band',kaynak:'youtube'}
 const genuine={id:'genuine',baslik:'Get Lucky (Official Audio)',sanatci:'Daft Punk, Pharrell Williams',sanatcilar:[{ad:'Daft Punk',id:'daft'}],kaynak:'youtube'}
 const live={...genuine,id:'live',baslik:'Get Lucky (Live)'}
 assert.deepEqual(rankSearchTracks('Daft Punk Get Lucky',[parody,cover,live,genuine]).map(p=>p.id),['genuine','live','parody','cover'])
 assert.equal(rankSearchTracks('Daft Punk Get Lucky Live',[genuine,live])[0].id,'live')
 assert.equal(parody.baslik,'Daft Punk Get Lucky Happy Wheels Parody')
})
