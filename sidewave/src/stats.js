import { normalize } from './store.js'

const RANGES = {'4w': 28, '6m': 182, all: null}
const MIN_PLAY = 30000

/**
 * Listening stats from Sidewave playback summaries and imported Spotify plays.
 * A play counts from 30 seconds; minutes count everything that was heard.
 */
export function computeStats(store, {range = '4w', now = Date.now()} = {}) {
  const days = RANGES[range] === undefined ? RANGES['4w'] : RANGES[range], since = days ? now - days * 86400000 : 0
  const plays = []
  for (const r of store.db.prepare("SELECT track_id,created,json_extract(json,'$.playedMs') ms FROM events WHERE event='summary' AND track_id IS NOT NULL AND created>?").all(since)) {
    const ms = Number(r.ms) || 0; if (ms <= 0) continue
    plays.push({trackId: r.track_id, at: r.created, ms, source: 'sidewave'})
  }
  const external = store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='external_plays'").get()
  if (external) for (const r of store.db.prepare('SELECT track_id,artist,title,ms,played_at FROM external_plays WHERE played_at>? AND (artist IS NOT NULL OR track_id IS NOT NULL)').all(since))
    plays.push({trackId: r.track_id, artist: r.artist, title: r.title, at: r.played_at, ms: r.ms, source: 'spotify'})

  const tracks = new Map(), artists = new Map(), hours = Array(24).fill(0), sources = {sidewave: 0, spotify: 0}
  let ms = 0, count = 0, first = null
  const cache = new Map(), track = id => { if (!cache.has(id)) cache.set(id, store.getTrack(id)); return cache.get(id) }
  for (const p of plays) {
    const t = p.trackId ? track(p.trackId) : null
    const artist = t?.sanatci || p.artist, title = t?.baslik || p.title
    if (!artist || !title) continue
    const heard = p.ms >= MIN_PLAY ? 1 : 0, minutes = p.ms / 60000
    ms += p.ms; count += heard; sources[p.source] += minutes; first = first === null ? p.at : Math.min(first, p.at)
    // Istanbul has no daylight saving time: UTC+3 all year.
    hours[(new Date(p.at).getUTCHours() + 3) % 24] += minutes
    const tk = p.trackId || normalize(artist) + '|' + normalize(title)
    const tEntry = tracks.get(tk) || {track: t || {id: tk, baslik: title, sanatci: artist}, plays: 0, minutes: 0, playable: !!t}
    tEntry.plays += heard; tEntry.minutes += minutes; tracks.set(tk, tEntry)
    const ak = normalize(artist)
    const aEntry = artists.get(ak) || {artist, plays: 0, minutes: 0, kapak: null, tracks: new Set()}
    aEntry.plays += heard; aEntry.minutes += minutes; aEntry.tracks.add(tk); if (!aEntry.kapak && t && (t.kapakId || t.kapakUrl || t.kapak || t.kaynak === 'youtube')) aEntry.kapak = t
    artists.set(ak, aEntry)
  }
  const round = n => Math.round(n)
  return {
    range: days ? range : 'all', minutes: round(ms / 60000), plays: count, artists: artists.size, first,
    sources: {sidewave: round(sources.sidewave), spotify: round(sources.spotify)},
    hours: hours.map(round),
    topArtists: [...artists.values()].sort((a, b) => b.minutes - a.minutes).slice(0, 12).map(a => ({artist: a.artist, minutes: round(a.minutes), plays: a.plays, tracks: a.tracks.size, kapak: a.kapak})),
    topTracks: [...tracks.values()].filter(t => t.plays > 0).sort((a, b) => b.plays - a.plays || b.minutes - a.minutes).slice(0, 25).map(t => ({...t, minutes: round(t.minutes)})),
  }
}
