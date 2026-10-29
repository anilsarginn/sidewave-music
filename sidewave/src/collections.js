import { createHash } from 'node:crypto'
import { normalize } from './store.js'
import { ApiError } from './telemetry.js'
import { createEditorialService } from './editorial.js'
import { skipSignals } from './recommendations.js'

// Editorial selections are application content, never rows in a user's playlists.
export const EDITORIAL = [
 {id:'jazz-after-hours',ad:"Blue Hour",tur:'Jazz',renk:'#bc7549',aciklama:"Acoustic textures and modern rhythms, from Portico Quartet to GoGo Penguin.",seeds:[['Portico Quartet','Ruins'],['GoGo Penguin','Hopopono'],['Mammal Hands','Chaser'],['Yussef Dayes','Black Classical Music'],['Alfa Mist','Keep On'],['Matthew Halsall','The Sun in September'],['Nubya Garcia','Pace'],['BADBADNOTGOOD','Time Moves Slow'],['Ezra Collective','Victory Dance'],['Hidden Orchestra','Spoken'],['The Cinematic Orchestra','Channel 1 Suite'],['Jun Miyake','Lilies of the Valley']]},
 {id:'funk-roots',ad:"Pocket Grooves",tur:'Funk',renk:'#bda43b',aciklama:"Deep bass, bright horns and the irresistible groove of Ikebe Shakedown and friends.",seeds:[['Ikebe Shakedown','Road Song'],['The Budos Band','T.I.B.W.F.'],['Menahan Street Band','Make the Road by Walking'],['Lettuce','Phyllis'],['Vulfpeck','Dean Town'],['Cory Wong','Cosmic Sans'],['The Meters','Cissy Strut'],['Cymande','Bra'],['Fela Kuti','Water No Get Enemy'],['Orgone','I Get Lifted'],['Khruangbin','Evan Finds the Third Room'],['The New Mastersounds','Nervous']]},
 {id:'electronic-horizons',ad:"Night Circuit",tur:"Electronic",renk:'#626bcc',aciklama:"From Thylacine to Bonobo. Melodic, layered and made for getting lost.",seeds:[['Thylacine','Home'],['Bonobo','Kerala'],['Floating Points','LesAlpx'],['Four Tet','Two Thousand and Seventeen'],['Jon Hopkins','Open Eye Signal'],['Kiasmos','Looped'],['Nicolas Jaar','Space Is Only Noise If You Can See'],['Christian Löffler','Ry'],['Max Cooper','Order From Chaos'],['Moderat','A New Error'],['Rival Consoles','Recovery'],['Bicep','Glue']]},
 {id:'slow-motion',ad:"Slow Motion",tur:'Downtempo',renk:'#458d8d',aciklama:"Cinematic textures and unhurried rhythms. Let the world slow down.",seeds:[['Hidden Orchestra','Flight'],['Bonobo','Black Sands'],['Emancipator','First Snow'],['Nightmares On Wax','Les Nuits'],['Nujabes','Feather'],['Tycho','A Walk'],['Zero 7','In the Waiting Line'],['Air','La femme d’argent'],['Massive Attack','Teardrop'],['The Cinematic Orchestra','All That You Give'],['Kruder & Dorfmeister','High Noon'],['Boards of Canada','Dayvan Cowboy']]},
 {id:'guitar-universe',ad:"Beyond the Strings",tur:"Progressive",renk:'#a15d88',aciklama:"Plini, Nick Johnston and the expansive sound of progressive guitar.",seeds:[['Plini','Selenium Forest'],['Nick Johnston','Atomic Mind'],['Intervals','Libra'],['Polyphia','G.O.A.T.'],['Chon','Bubble Dream'],['David Maxim Micic','Who Bit the Moon'],['Animals As Leaders','The Woven Web'],['Sithu Aye','Set Course for Andromeda'],['Owane','Born in Space'],['Jakub Zytecki','Satya’s Diary'],['Caligula’s Horse','Marigold'],['The Aristocrats','Bad Asteroid']]},
 {id:'soul-colors',ad:"From the Soul",tur:'Soul',renk:'#b06464',aciklama:"Warm voices and organic rhythms. Classic soul meets its next chapter.",seeds:[['Michael Kiwanuka','Cold Little Heart'],['Charles Bradley','The World Is Going Up in Flames'],['Curtis Mayfield','Move On Up'],['Bill Withers','Use Me'],['Marvin Gaye','Inner City Blues'],['Leon Bridges','Bad Bad News'],['SAULT','Wildfires'],['Durand Jones & The Indications','Is It Any Wonder?'],['Black Pumas','Colors'],['Jordan Rakei','Sorceress'],['Hiatus Kaiyote','Nakamarra'],['D’Angelo','Spanish Joint']]},
 {id:'disco-orbit',ad:"Disco Orbit",tur:'Nu Disco',renk:'#9665ba',aciklama:"Parcels, L’Impératrice and a little after-dark electricity.",seeds:[['Parcels','Tieduprightnow'],['L’Impératrice','Vanille fraise'],['Jungle','Casio'],['Breakbot','Baby I’m Yours'],['Daft Punk','Voyager'],['Todd Terje','Inspector Norse'],['Purple Disco Machine','Body Funk'],['Folamour','These Are Just Places to Me Now'],['Poolside','Harvest Moon'],['Franc Moody','Dopamine'],['Roosevelt','Moving On'],['Justice','D.A.N.C.E.']]},
 {id:'psychedelic-roots',ad:"Roots & Cosmos",tur:"Psychedelic",renk:'#7e9652',aciklama:"Anatolian psychedelia, desert guitars and rhythms without borders.",seeds:[['Altın Gün','Goca Dünya'],['Gaye Su Akyol','İstikrarlı Hayal Hakikattir'],['Erkin Koray','Cemalim'],['Barış Manço','Dönence'],['Moğollar','Dinleyiverin Gari'],['Derya Yıldırım & Grup Şimşek','Nem Kaldı'],['Baba Zula','Bir Sana Bir De Bana'],['Khruangbin','Maria También'],['Glass Beams','Mahal'],['Tinariwen','Sastanàqqàm'],['Yin Yin','One Inch Punch'],['Kikagaku Moyo','Dripping Sun']]},
].map(entry=>({...entry,kapak:'/artwork/sessions/'+entry.id+'-v1.webp'}))

export function weekWindow(now=Date.now()) {
 const local=new Date(now+3*3600000), day=local.getUTCDay()||7
 local.setUTCDate(local.getUTCDate()-day+1);local.setUTCHours(0,0,0,0)
 const starts=local.getTime()-3*3600000
 return {week:new Date(starts+3*3600000).toISOString().slice(0,10),startsAt:starts,refreshAt:starts+7*86400000}
}
const hash=value=>createHash('sha256').update(value).digest('hex')
const unique=tracks=>[...new Map(tracks.map(p=>[p.kaynak+':'+p.id,p])).values()]
export function installCollections(app,{store,baseStore,ytres,subsonic,mapSong,now=Date.now}) {
 const editorials=createEditorialService({baseStore,entries:EDITORIAL,ytres,now})
 const {editorial,meta}=editorials,weeklyInflight=new Map()
 async function weekly() {
  const window=weekWindow(now()),old=store.setting('weeklyDiscovery')
  if(old)old.ad='Discover Weekly'
  if(old?.week===window.week && old.parcalar?.length)return {...old,parcalar:old.parcalar.filter(p=>!store.isDismissed(p.appId)).map(p=>store.getTrack(p.appId)||p)}
  // Per-account deduplication: stores have separate native DB connection identities.
  const key=(store.accountId||store.db.name)+':'+window.week
  if(weeklyInflight.has(key))return weeklyInflight.get(key)
  const work=(async()=>{
   const favorites=store.favorites(),recent=store.history(100),known=new Set([...favorites,...recent].map(p=>p.appId))
   const seeds=unique([...recent.slice(0,5),...favorites.slice(0,10)]),artists=new Set(),chosen=[]
   for(const p of seeds)if(!artists.has(normalize(p.sanatci))){artists.add(normalize(p.sanatci));chosen.push(p);if(chosen.length>=4)break}
   const candidates=[],failures=[]
   await Promise.all(chosen.map(async seed=>{try{
    let id=seed.kaynak==='youtube'?seed.id:null
    if(!id){const response=await ytres('/ara?q='+encodeURIComponent(seed.sanatci+' '+seed.baslik)+'&limit=5');id=(response.sonuclar||[]).find(p=>normalize(p.sanatci)===normalize(seed.sanatci)&&normalize(p.baslik)===normalize(seed.baslik))?.id}
    if(id){const response=await ytres('/ilgili?id='+encodeURIComponent(id)+'&limit=40');for(const p of response.parcalar||[])candidates.push({...p,kaynak:'youtube'})}
   }catch{failures.push(true)}}))
   if(!chosen.length){
    // A new listener receives a clearly labelled starter selection.
    const starter=await editorial('jazz-after-hours').catch(()=>null)
    candidates.push(...starter?.parcalar||[])
   }
   if(candidates.length<30){try{const response=await subsonic('getRandomSongs.view',{size:100});candidates.push(...(response.randomSongs?.song||[]).map(mapSong))}catch{failures.push(true)}}
   const skipped=skipSignals(store,{now:now()}).tracks
   const pool=unique(candidates).map(p=>store.upsert(p)).filter(p=>!known.has(p.appId)&&!store.isDismissed(p.appId)&&!skipped.has(p.appId))
   const prior=new Set(old?.parcalar?.map(p=>p.appId)||[])
   pool.sort((a,b)=>Number(prior.has(a.appId))-Number(prior.has(b.appId)) || hash(window.week+a.id).localeCompare(hash(window.week+b.id)))
   const counts=new Map(),parcalar=pool.filter(p=>{const artist=normalize(p.sanatci),count=counts.get(artist)||0;if(count>=2)return false;counts.set(artist,count+1);return true}).slice(0,30)
   if(!parcalar.length){if(old?.parcalar?.length)return {...old,stale:true,message:"This week’s mix is not ready yet. Your previous mix is still here."};throw new ApiError('WEEKLY_UNAVAILABLE',"Discover Weekly is unavailable right now. Please try again.",503,true)}
   const result={id:'weekly',ad:"Discover Weekly",owner:'Sidewave',editable:false,...window,createdAt:now(),personalized:chosen.length>0,partial:failures.length>0,parcalar}
   store.setting('weeklyDiscovery',result);return result
  })().finally(()=>weeklyInflight.delete(key))
  weeklyInflight.set(key,work);return work
 }
 // Sessions closest to your imported Spotify taste (daylist terms) come first.
 app.get('/api/v1/collections',c=>{
  const taste=Object.entries(store.setting('spotifyTaste')||{}),score=m=>{const text=[m.ad,m.tur,m.aciklama].join(' ').toLocaleLowerCase('en');return taste.reduce((n,[term,count])=>n+(term.split(/\s+/).some(w=>w.length>3&&text.includes(w))?count:0),0)}
  const list=EDITORIAL.map(meta).map((m,i)=>({m,i,s:score(m)})).sort((a,b)=>b.s-a.s||a.i-b.i).map(x=>x.s?{...x.m,tasteMatch:true}:x.m)
  return c.json({listeler:list})
 })
 app.get('/api/v1/collections/:id',async c=>{const data=await editorial(c.req.param('id'));return c.json({...data,parcalar:data.parcalar.map(p=>store.upsert(p))})})
 app.get('/api/v1/discovery/weekly',async c=>c.json(await weekly()))
 return {...editorials,weekly}
}
