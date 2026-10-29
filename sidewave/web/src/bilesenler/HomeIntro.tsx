import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, AudioLines } from 'lucide-react';
import { api, type HomeIntro } from '../api';
import { useMember } from './Membership';

export function HomeIntroduction() {
 const member=useMember(),[intro,setIntro]=useState<HomeIntro|null>(null),[loading,setLoading]=useState(true);
 const request=useRef<{member:string;promise:Promise<HomeIntro>}|null>(null);
 useEffect(()=>{
  if(!member)return;
  let active=true;
  // StrictMode effect replay shares one idempotent visit, not two greetings.
  if(request.current?.member!==member.user.id)request.current={member:member.user.id,promise:api.homeIntro(Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join(''))};
  request.current.promise.then(data=>{if(active&&['greeting','quote'].includes(data.kind))setIntro(data);}).catch(()=>{}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[member?.user.id]);
 return <header className={`home-intro mb-7 sm:mb-9 ${intro?.kind==='quote'?'has-quote':''}`} aria-busy={loading}>
  <div className="home-intro-copy" key={intro?.kind||'loading'}>
   {intro?.kind==='greeting'?<><p className="home-intro-eyebrow">{intro.greeting}</p><h1>Welcome back,<br className="home-greeting-break"/> <span>{member?.user.username}</span></h1></>
    :intro?.kind==='quote'&&intro.quote?<><span className="home-intro-eyebrow">BEYOND THE SOUND</span><figure className="home-quote"><blockquote><h1>“{intro.quote.text}”</h1></blockquote><figcaption><span>{intro.quote.author}</span><span aria-hidden="true">—</span><a href={intro.quote.source} target="_blank" rel="noopener noreferrer" title="Read the original passage">{intro.quote.work}<ArrowUpRight size={12}/></a></figcaption></figure></>
    :<><p className="home-intro-eyebrow">SIDEWAVE</p><h1>Make time for music.</h1></>}
  </div>
  <div className="home-intro-record" aria-hidden="true"><div className="home-record-rings"/><div className="home-record-label"><AudioLines size={24}/></div></div>
 </header>;
}
