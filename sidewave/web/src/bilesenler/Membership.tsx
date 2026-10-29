import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AudioLines, ArrowRight, BarChart3, Download, Eye, EyeOff, Headphones, ImagePlus, Keyboard, Loader2, LogOut } from 'lucide-react';
import { api, setAuthenticatedMember, type Member } from '../api';
import { resetAccountEvents } from '../telemetry';

const MemberContext = createContext<{user: Member; logout: () => Promise<void>} | null>(null);
export const useMember = () => useContext(MemberContext);

export function MembershipGate({children}: {children: ReactNode}) {
 const [showPassword,setShowPassword]=useState(false);
 const [firstAccount,setFirstAccount]=useState(false);
 const [user,setUser]=useState<Member|null>(null),[loading,setLoading]=useState(true),[mode,setMode]=useState<'login'|'signup'>('login');
 const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const check=()=>{setLoading(true);setError('');api.me().then(d=>{setAuthenticatedMember(d.user?.id||null);setUser(d.user);setFirstAccount(!!d.firstAccount);}).catch(e=>setError(e.message)).finally(()=>setLoading(false));};
 useEffect(()=>{check();const expired=()=>{setAuthenticatedMember(null);setUser(null);setError("Your session expired. Please sign in again.");};const changed=()=>{resetAccountEvents();window.location.reload();};const storage=(event:StorageEvent)=>{if(event.key==='sidewave-member-id'||event.key==='sidewave-member-logout')changed();};window.addEventListener('sidewave-session-expired',expired);window.addEventListener('sidewave-account-changed',changed);window.addEventListener('storage',storage);return()=>{window.removeEventListener('sidewave-session-expired',expired);window.removeEventListener('sidewave-account-changed',changed);window.removeEventListener('storage',storage);};},[]);
 async function logout(){await api.logout();setAuthenticatedMember(null);try{localStorage.setItem('sidewave-member-logout',String(Date.now()));}catch{}resetAccountEvents();setUser(null);setMode('login');setPassword('');setConfirm('');setError('');window.location.hash='#/';}
 async function submit(event: React.FormEvent){
  event.preventDefault();if(busy)return;
  if(mode==='signup'&&password!==confirm){setError("Your passwords do not match.");return;}
  setBusy(true);setError('');try{
   const data=await api.authenticate(mode,username,password);
   // Browser playback snapshots and searches must not cross account boundaries.
   try {
   const previous=localStorage.getItem('sidewave-member-id');
   if(previous && previous!==data.user.id){resetAccountEvents();for(const key of Object.keys(localStorage))if(key.startsWith('sidewave-')&&!key.includes('appearance')&&!key.includes('wallpaper'))localStorage.removeItem(key);}
   localStorage.setItem('sidewave-member-id',data.user.id);
   } catch { /* Signing in also works when browser storage is unavailable. */ }
   setAuthenticatedMember(data.user.id);setUser(data.user);setPassword('');setConfirm('');
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 if(loading)return <main className="auth-screen"><div role="status" className="flex items-center gap-3"><Loader2 className="animate-spin text-primary"/>Opening Sidewave…</div></main>;
 if(user)return <MemberContext.Provider value={{user,logout}}>{children}</MemberContext.Provider>;
 return <main className="auth-screen auth-experience" data-mode={mode}>
  <div className="auth-atmosphere" aria-hidden="true"><i/><i/><div className="auth-grain"/></div>
  <header className="auth-header"><div className="auth-brand"><span className="brand-mark"><AudioLines size={25}/></span><span>Sidewave</span></div><span className="auth-header-note"><span/>At your own tempo.</span></header>
  <div className="auth-layout">
   <section className="auth-intro" aria-label="Sidewave">
    <p className="auth-eyebrow">TURN IT UP. TUNE IN.</p>
    <h1>Your music.<br/><span>Your rhythm.</span></h1>
    <div className="auth-art" aria-hidden="true">
     <div className="auth-art-halo"/>
     <div className="auth-record-disc"><div className="auth-disc-grooves"/><div className="auth-disc-label"><AudioLines/><span>33⅓ RPM</span></div></div>
     <div className="auth-sleeve"><div className="auth-sleeve-top"><span>SIDEWAVE<br/>SESSIONS</span><span>VOL.<br/>01</span></div><div className="auth-sleeve-art"><i/><i/><i/><i/><i/></div><div className="auth-sleeve-bottom"><span>FEEL<br/>THE SOUND.</span><AudioLines size={28}/></div></div>
     <span className="auth-art-stamp">MUSIC IS<br/>A FEELING.</span>
    </div>
    <div className="auth-soundline" aria-hidden="true"><div className="auth-equalizer">{[12,25,18,34,22,40,16,29,38,20,32,14,26,36,18,24].map((height,i)=><i key={i} style={{'--bar-height':`${height}px`,'--bar-delay':`${i*-.13}s`} as CSSProperties}/>)}</div><span>IT ALL STARTS WITH A SONG.</span></div>
   </section>
   <section className="auth-panel" aria-labelledby="auth-title">
    <div className="auth-panel-icon" aria-hidden="true"><Headphones size={23}/></div>
    <h2 id="auth-title" key={mode} className="auth-title">{mode==='login'?"Welcome back.":"Find your rhythm."}</h2>
    <p className="auth-subtitle">{mode==='login'?"Right where you left off. Right where you belong.":"Make room for music. Create your account."}</p>
    <div className="auth-tabs">{(['login','signup'] as const).map(value=><button key={value} type="button" aria-pressed={mode===value} disabled={busy} onClick={()=>{setMode(value);setError('');setShowPassword(false);}}>{value==='login'?"Sign in":"Sign up"}</button>)}</div>
    <form onSubmit={submit} className="auth-form">
     <div className="auth-field"><label htmlFor="member-username">Username</label><div className="auth-input-wrap"><input id="member-username" required disabled={busy} autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={24} value={username} onChange={e=>setUsername(e.target.value)} placeholder="Your username"/></div></div>
     <div className="auth-field"><label htmlFor="member-password">Password</label><div className="auth-input-wrap"><input id="member-password" required disabled={busy} type={showPassword?'text':'password'} autoComplete={mode==='signup'?'new-password':'current-password'} minLength={mode==='signup'?8:undefined} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} placeholder={mode==='signup'?"At least 8 characters, letters and numbers":"Your password"}/><button type="button" className="auth-password-toggle" aria-label={showPassword?"Hide password":"Show password"} aria-pressed={showPassword} onClick={()=>setShowPassword(v=>!v)}>{showPassword?<EyeOff size={19}/>:<Eye size={19}/>}</button></div></div>
     {mode==='signup'&&<div className="auth-field auth-confirm"><label htmlFor="member-confirm">Confirm password</label><div className="auth-input-wrap"><input id="member-confirm" required disabled={busy} type={showPassword?'text':'password'} autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder="Enter your password again"/></div></div>}
     {error&&<p role="alert" className="auth-error">{error}</p>}
     <button disabled={busy} className="auth-submit">{busy?<><Loader2 size={20} className="animate-spin"/><span>One moment…</span></>:<><span>{mode==='login'?"Sign in":"Create account"}</span><ArrowRight size={20}/></>}</button>
    </form>
    <p className="auth-switch">{mode==='login'?"New around here?":"Already have an account?"} <button type="button" disabled={busy} onClick={()=>{setMode(mode==='login'?'signup':'login');setError('');setShowPassword(false);}}>{mode==='login'?"Join us":"Sign in"}</button></p>
    {mode==='signup'&&<p className="auth-privacy">{firstAccount?"The first account inherits the existing liked songs, playlists and listening history.":"Your liked songs, playlists and listening history stay with your account."}</p>}
   </section>
  </div>
  <footer className="auth-footer"><span>SIDEWAVE · SARGIN LABS</span><span>Life sounds better with music.</span><AudioLines size={17} aria-hidden="true"/></footer>
 </main>;
}
export function AccountButton({onAppearance,onDownloads,onShortcuts,onStats,downloadCount=0}: {onAppearance:()=>void;onDownloads?:()=>void;onShortcuts?:()=>void;onStats?:()=>void;downloadCount?:number}) {
 const member=useMember(),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
 const [open,setOpen]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{
  if(!open)return;
  const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};
  const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus();}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
  root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
 },[open]);
 if(!member)return null;
 const initial=Array.from(member.user.username)[0]?.toLocaleUpperCase('tr-TR')||'S';
 function choose(action:()=>void){setOpen(false);action();}
 return <div className="account-menu" ref={root} onBlur={e=>{if(e.relatedTarget&&!e.currentTarget.contains(e.relatedTarget as Node))setOpen(false);}}>
  <button ref={trigger} className="profile-trigger" aria-label="Profile" title="Profile" aria-haspopup="menu" aria-controls="profile-menu" aria-expanded={open} onClick={()=>setOpen(v=>!v)} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setOpen(true);}}}><span className="profile-avatar">{initial}</span></button>
  {open&&<div className="profile-menu" id="profile-menu" role="menu" aria-label="Profile options" onKeyDown={e=>{
   if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;e.preventDefault();
   const items=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')),index=items.indexOf(document.activeElement as HTMLButtonElement);
   items[e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();
  }}>
   <div className="profile-menu-heading" role="presentation"><span className="profile-avatar" aria-hidden="true">{initial}</span><div><span className="profile-menu-label">YOUR ACCOUNT</span><strong>{member.user.username}</strong></div></div>
   {onStats&&<button role="menuitem" onClick={()=>choose(onStats)}><BarChart3 size={18}/><span>Your stats</span></button>}
   <button role="menuitem" onClick={()=>choose(onAppearance)}><ImagePlus size={18}/><span>Background &amp; appearance</span></button>
   {onDownloads&&<button role="menuitem" onClick={()=>choose(onDownloads)}><Download size={18}/><span>Downloads</span>{downloadCount>0&&<span className="profile-menu-count">{downloadCount}</span>}</button>}
   {onShortcuts&&<button role="menuitem" onClick={()=>choose(onShortcuts)}><Keyboard size={18}/><span>Keyboard shortcuts</span></button>}
   <div className="profile-menu-divider" role="separator"/>
   <button role="menuitem" disabled={busy} className="profile-signout" onClick={async()=>{setBusy(true);setError('');try{await member.logout();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>{busy?<Loader2 size={18} className="animate-spin"/>:<LogOut size={18}/>}<span>Sign out</span></button>
   {error&&<p role="alert" className="profile-menu-error">{error}</p>}
  </div>}
 </div>;
}
