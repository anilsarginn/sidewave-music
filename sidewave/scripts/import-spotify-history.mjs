// Import a Spotify listening-history ZIP into the library owner's account (the original database).
// Usage inside the container: node scripts/import-spotify-history.mjs /app/data/file.zip
import { readFileSync } from 'node:fs'
import { createStore } from '../src/store.js'
import { readSpotifyHistory, createSpotifyHistory } from '../src/spotify-history.js'

const store=createStore(process.env.DATABASE_PATH||'./data/sidewave.sqlite')
try{
  const result=createSpotifyHistory(store).apply(await readSpotifyHistory(readFileSync(process.argv[2])))
  console.log(JSON.stringify(result))
  console.log(JSON.stringify(createSpotifyHistory(store).summary()))
}finally{store.close()}
