import { randomInt } from 'node:crypto'
import { ApiError } from './telemetry.js'

// Short passages from verified public-domain English editions. Keep primary sources
// and passage references with the text; never replace these with quote sites.
export const PHILOSOPHER_QUOTES = [
 {id:'nietzsche-music',text:"Without music life would be a mistake.",author:'Friedrich Nietzsche',work:"Twilight of the Idols · Maxims and Missiles, 33",source:'https://www.gutenberg.org/cache/epub/52263/pg52263-images.html',original:'Without music life would be a mistake.'},
 {id:'plato-rhythm',text:"Rhythm and harmony find their way into the inward places of the soul.",author:"Plato",work:"The Republic · III, 401d",source:'https://www.gutenberg.org/cache/epub/150/pg150.html',original:'rhythm and harmony find their way into the inward places of the soul'},
 {id:'montaigne-dance',text:"When I dance, I dance; when I sleep, I sleep.",author:'Michel de Montaigne',work:"Essays · III, 13: Of Experience",source:'https://www.gutenberg.org/cache/epub/3599/pg3599.html',original:'When I dance, I dance; when I sleep, I sleep.'},
 {id:'aristotle-rhythms',text:"The same principles apply to rhythms; some have a character of rest, others of motion.",author:"Aristotle",work:"Politics · VIII, 5",source:'https://classics.mit.edu/Aristotle/politics.8.eight.html',original:'The same principles apply to rhythms; some have a character of rest, others of motion'},
 {id:'schopenhauer-listen',text:"In order to comprehend it fully, we must hear it twice.",author:'Arthur Schopenhauer',work:"The World as Will and Idea · I, §52",source:'https://www.gutenberg.org/files/38427/38427-h/38427-h.html',original:'in order to comprehend it fully, we must hear it twice'},
 {id:'marcus-within',text:"Look within; within is the fountain of all good. Such a fountain, where springing waters can never fail, so thou dig still deeper and deeper.",author:'Marcus Aurelius',work:"Meditations · VII, 59",source:'https://www.gutenberg.org/files/2680/2680-h/2680-h.htm',original:'Look within; within is the fountain of all good. Such a fountain, where springing waters can never fail, so thou dig still deeper and deeper.'},
 {id:'montaigne-listen',text:"Speaking is half his who speaks, and half his who hears.",author:'Michel de Montaigne',work:"Essays · III, 13: Of Experience",source:'https://www.gutenberg.org/cache/epub/3599/pg3599.html',original:'Speaking is half his who speaks, and half his who hears'},
 {id:'nietzsche-dance',text:"And lost be the day to us in which a measure hath not been danced.",author:'Friedrich Nietzsche',work:"Thus Spake Zarathustra · Old and New Tables, 23",source:'https://www.gutenberg.org/files/1998/1998-h/1998-h.htm',original:'And lost be the day to us in which a measure hath not been danced.'},
 {id:'aristotle-sweetness',text:"Music has a natural sweetness.",author:"Aristotle",work:"Politics · VIII, 5",source:'https://classics.mit.edu/Aristotle/politics.8.eight.html',original:'music has a natural sweetness'},
 {id:'epictetus-flow',text:"Demand not that events should happen as you wish; but wish them to happen as they do happen, and you will go on well.",author:"Epictetus",work:"The Enchiridion · 8",source:'https://www.gutenberg.org/files/45109/45109-h/45109-h.htm',original:'Demand not that events should happen as you wish; but wish them to happen as they do happen, and you will go on well.'},
 {id:'schopenhauer-feeling',text:"It restores to us all the emotions of our inmost nature, but entirely without reality and far removed from their pain.",author:'Arthur Schopenhauer',work:"The World as Will and Idea · I, §52",source:'https://www.gutenberg.org/files/38427/38427-h/38427-h.html',original:'it restores to us all the emotions of our inmost nature, but entirely without reality and far removed from their pain'},
 {id:'montaigne-rest',text:"Have you known how to take repose, you have done more than he who has taken empires and cities.",author:'Michel de Montaigne',work:"Essays · III, 13: Of Experience",source:'https://www.gutenberg.org/cache/epub/3599/pg3599.html',original:'Have you known how to take repose, you have done more than he who has taken empires and cities.'},
 {id:'nietzsche-walk',text:"Only those thoughts that come by walking have any value.",author:'Friedrich Nietzsche',work:"Twilight of the Idols · Maxims and Missiles, 34",source:'https://www.gutenberg.org/cache/epub/52263/pg52263-images.html',original:'Only those thoughts that come by walking have any value.'},
 {id:'laozi-space',text:"Mix water with clay thus making a vessel; in its emptiness exists the usefulness of the vessel.",author:'Laozi',work:'Dao De Jing · 11',source:'https://www.gutenberg.org/files/49965/49965-h/49965-h.htm',original:'Mix water with clay thus making a vessel; In its emptiness exists the usefulness of the vessel.'},
]

export function greetingWindow(now=Date.now()) {
 const local=new Date(now+3*3600000),hour=local.getUTCHours()
 const period=hour<6||hour>=22?'night':hour<12?'morning':hour<18?'day':'evening'
 if(hour<6)local.setUTCDate(local.getUTCDate()-1)
 const key=local.toISOString().slice(0,10)+':'+period
 return {key,greeting:{night:"Good night",morning:"Good morning",day:"Good afternoon",evening:"Good evening"}[period]}
}

export function installHomeIntro(app,{store,now=Date.now,pick=randomInt}) {
 const visit=store.db.transaction(visitId=>{
  const window=greetingWindow(now()),state=store.setting('homeIntro')||{periods:[],remaining:[],visits:[]}
  const previous=state.visits.find(v=>v.id===visitId)
  if(previous)return previous.response
  let response
  if(!state.periods.includes(window.key)) {
   state.periods=[...state.periods,window.key].slice(-32)
   response={kind:'greeting',greeting:window.greeting,period:window.key}
  } else {
   let remaining=state.remaining.filter(id=>PHILOSOPHER_QUOTES.some(q=>q.id===id))
   if(!remaining.length) {
    remaining=PHILOSOPHER_QUOTES.map(q=>q.id)
    for(let i=remaining.length-1;i>0;i--){const j=pick(i+1);[remaining[i],remaining[j]]=[remaining[j],remaining[i]]}
    if(remaining[0]===state.lastQuote)[remaining[0],remaining[1]]=[remaining[1],remaining[0]]
   }
   const next=remaining.shift(),quote=PHILOSOPHER_QUOTES.find(q=>q.id===next),{original,...publicQuote}=quote
   state.remaining=remaining;state.lastQuote=quote.id
   response={kind:'quote',quote:publicQuote,period:window.key}
  }
  state.visits=[...state.visits,{id:visitId,response}].slice(-64)
  store.setting('homeIntro',state)
  return response
 })
 app.post('/api/v1/home/intro',async c=>{
  const body=await c.req.json().catch(()=>null)
  if(!/^[a-zA-Z0-9_-]{16,80}$/.test(body?.visitId||''))throw new ApiError('INVALID_VISIT',"A valid visit ID is required.",400)
  return c.json(visit(body.visitId))
 })
 return {visit}
}
