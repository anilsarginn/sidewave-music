import { normalize } from './store.js'

export function exactArtistMatches(query, artists, limit = 2) {
  const key = normalize(query)
  if (!key) return []
  const seen = new Set()
  return artists.filter(artist => {
    const id = artist.id || artist.browseId
    if (artist.kaynak !== 'youtube' || !id || seen.has(id) || normalize(artist.ad) !== key) return false
    seen.add(id)
    return true
  }).slice(0, limit)
}

export function rankSearchTracks(query, tracks, artists = []) {
  const key = normalize(query), tokens = key.split(' ').filter(Boolean)
  if (!key) return [...tracks]
  const artistQuery = artists.some(artist => normalize(artist.ad) === key)
  const score = track => {
    const title = normalize(track.baslik), artist = normalize(track.sanatci)
    const exactArtist = artist === key || String(track.sanatci || '').split(/[,;]/).some(name => normalize(name) === key)
    if (exactArtist && artistQuery) return 160
    const credits=[track.sanatci,...(track.sanatcilar||[]).map(a=>a.ad)].filter(Boolean).flatMap(name=>String(name).split(/[,;]/)).map(normalize)
    const requestedRecording=credits.some(name=>{
      if(name.length<3 || !(' '+key+' ').includes(' '+name+' '))return false
      const rest=(' '+key+' ').replace(' '+name+' ',' ').trim().split(' ').filter(Boolean)
      return rest.length>0 && rest.every(token=>title.split(' ').includes(token))
    })
    if(requestedRecording){const versionWords=['remix','live','cover','parody','karaoke','instrumental'];const penalty=versionWords.some(word=>title.split(' ').includes(word)&&!tokens.includes(word))?20:0;return 155-penalty}
    if (title === key) return 140
    if (exactArtist) return 130
    if (title.startsWith(key + ' ')) return 110
    if (title.includes(key)) return 100
    if (artist.startsWith(key + ' ')) return 90
    const combined = title + ' ' + artist
    return tokens.filter(token => combined.split(' ').includes(token)).length / tokens.length * 70
  }
  return tracks.map((track, index) => ({track, index, score: score(track)}))
    .sort((a, b) => b.score - a.score || (a.track.kaynak === 'kutuphane' ? 0 : 1) - (b.track.kaynak === 'kutuphane' ? 0 : 1) || a.index - b.index)
    .map(item => item.track)
}
