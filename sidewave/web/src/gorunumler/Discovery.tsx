import {useEffect,useState} from 'react';
import {AudioLines,Loader2,Play,Plus,X} from 'lucide-react';
import {api,type Parca,type Liste,type SonicResult} from '../api';
import {Kapak} from '../bilesenler/Ortak';
import type {DiscoveryTarget} from '../DiscoveryContext';

export function DiscoveryPanel({target,onClose,onPlay,onQueue,onArtist,listeler,onSaved}: {
 target:DiscoveryTarget;onClose:()=>void;onPlay:(p:Parca,list:Parca[])=>void;onQueue:(list:Parca[])=>void;onArtist:(id:string)=>void;listeler:Liste[];onSaved:()=>void;
}) {
 const [mode,setMode]=useState(target.mode),[result,setResult]=useState<SonicResult|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0);
 const [cap,setCap]=useState<Awaited<ReturnType<typeof api.sonicCapabilities>>|null>(null);
 const [query,setQuery]=useState(''),[candidates,setCandidates]=useState<Parca[]>([]),[searching,setSearching]=useState(false),[end,setEnd]=useState<Parca|null>(null);
 const [saved,setSaved]=useState(''),[saving,setSaving]=useState(false);
 useEffect(()=>{const c=new AbortController();api.sonicCapabilities(c.signal).then(setCap).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[retry]);
 useEffect(()=>{
  const c=new AbortController();setCandidates([]);if(query.trim().length<2){setSearching(false);return;}
  setSearching(true);const timer=setTimeout(()=>{api.ara(query,c.signal).then(d=>{if(!c.signal.aborted)setCandidates(d.parcalar.filter(p=>p.id!==target.parca?.id).slice(0,8));}).catch(e=>{if(!c.signal.aborted)setError(e.message);}).finally(()=>{if(!c.signal.aborted)setSearching(false);});},350);
  return()=>{clearTimeout(timer);c.abort();};
 },[query,target.parca?.id]);
 useEffect(()=>{
  const c=new AbortController();setResult(null);setError('');setSaved('');setBusy(false);
  if((mode==='path'||mode==='artists')&&!cap?.available || mode==='path'&&!end)return;
  setBusy(true);
  const promise=mode==='artists'&&target.artistId?api.sonicArtists(target.artistId,c.signal):mode==='path'&&target.parca&&end?api.sonicPath(target.parca,end,c.signal):target.parca?api.sonicTracks(target.parca,mode==='instant-mix',c.signal):Promise.reject(new Error("Choose a track."));
  promise.then(r=>{if(!c.signal.aborted)setResult(r);}).catch(e=>{if(!c.signal.aborted)setError(e.message);}).finally(()=>{if(!c.signal.aborted)setBusy(false);});
  return()=>c.abort();
 },[mode,end,cap,retry,target]);
 useEffect(()=>{
  const a=result?.analysis;if(!a||!['analyzing','waiting'].includes(a.state))return;
  const c=new AbortController();const timer=setTimeout(()=>{
   api.sonicSession(a.id,mode==='instant-mix',c.signal).then(r=>{if(!c.signal.aborted)setResult(r);}).catch(()=>{if(!c.signal.aborted)setError("Analysis status could not be updated. Your recommendations are still available.");});
  },4000);
  return()=>{clearTimeout(timer);c.abort();};
 },[result,mode]);
 const tracks=result?.parcalar||[];
 const save=async(id:string)=>{if(saving || !tracks.length)return;setSaving(true);setSaved('');try{await api.listeyeEkle(id,tracks);setSaved("Tracks added to your playlist.");onSaved();}catch(e){setError((e as Error).message);}finally{setSaving(false);}};
 return <div className="p-5 sm:p-7">
  <div className="flex justify-between gap-4 items-center"><div className="flex items-center gap-3"><AudioLines className="text-primary"/><h2 className="text-xl font-semibold">Sound discovery</h2></div><button aria-label="Close sound discovery" onClick={onClose} className="utility-button"><X size={20}/></button></div>
  {target.parca && <div className="flex items-center gap-3 my-5"><Kapak kaynak={target.parca} className="h-14 w-14"/><div className="min-w-0"><p className="font-medium truncate">{target.parca.baslik}</p><p className="text-sm text-muted-foreground truncate">{target.parca.sanatci}</p></div></div>}
  {!target.artistId && <div className="flex flex-wrap gap-2 my-5" aria-label="Discovery type">{([['instant-mix',"Instant mix"],['similar-tracks',"Similar tracks"],['path',"Sound journey"]] as const).map(([value,label])=><button key={value} onClick={()=>setMode(value)} aria-pressed={mode===value} className={`filter-chip ${mode===value?'is-selected':''}`}>{label}</button>)}</div>}
  <p className="text-sm text-muted-foreground leading-relaxed mb-5">{mode==='path'?"A changing soundscape between two tracks. Your start and end stay in place.":mode==='artists'?"Artists with a similar sound to your library.":"Find something new. Where available, audio samples are compared in the background."}</p>
  {cap?.analysis && <p className="text-xs text-muted-foreground mb-4">{cap.analysis.model} · {cap.analysis.count ?? '—'} / {cap.analysis.total ?? '—'} tracks analyzed</p>}
  {!cap && !error && <p role="status" className="flex gap-2 items-center"><Loader2 size={18} className="animate-spin"/>Checking availability…</p>}
  {cap && !cap.available && <p role="status" className="notice">{cap.message}</p>}
  {mode==='path' && cap?.available && <div className="mb-6"><label htmlFor="sonic-end" className="block text-sm font-medium mb-2">Choose where your journey ends</label><input id="sonic-end" value={query} onChange={e=>{setQuery(e.target.value);setEnd(null);}} placeholder="Search songs or artists" className="form-input w-full min-h-12"/>{searching&&<p role="status" className="text-xs mt-2">Searching…</p>}{!end && candidates.map(p=><button key={`${p.kaynak}:${p.id}`} onClick={()=>{setEnd(p);setQuery(p.baslik);}} className="block w-full min-h-12 text-left rounded-lg p-3 hover:bg-white/5"><span className="font-medium">{p.baslik}</span><span className="block text-xs text-muted-foreground">{p.sanatci} · {p.kaynak==='kutuphane'?"In your library":"Online · library copy required"}</span></button>)}{end&&<p className="text-sm text-primary mt-2">Destination: {end.baslik} · {end.sanatci}</p>}</div>}
  {busy && <p role="status" className="flex gap-2 items-center py-6"><Loader2 size={20} className="animate-spin"/>Finding new tracks…</p>}
  {error && <div role="alert" className="notice notice-error mb-4"><span>{error}<button onClick={()=>setRetry(n=>n+1)} className="underline min-h-11 ml-2">Try again</button></span></div>}
  {result?.message && <p role="status" className="notice mb-4">{result.message}</p>}
  {result?.analysis && <p role="status" className="text-sm text-muted-foreground mb-4">{result.analysis.message} · {result.analysis.completed}/{result.analysis.total}{result.analysis.failed>0?` · ${result.analysis.failed} samples unavailable`:''}</p>}
  {result?.analysis?.state==='partial' && <button className="button-secondary mb-4" disabled={saving} onClick={async()=>{setSaving(true);try{await api.sonicRetry(result.analysis!.id);setResult(await api.sonicSession(result.analysis!.id,mode==='instant-mix',new AbortController().signal));}catch(e){setError((e as Error).message);}finally{setSaving(false);}}}>Retry unavailable audio samples</button>}
  {!!tracks.length && <>
    <div className="flex flex-wrap gap-2 mb-4"><button className="button-primary flex gap-2 items-center" onClick={()=>{onPlay(tracks[0],tracks);onClose();}}><Play size={16}/>Play ({tracks.length})</button><button className="button-secondary flex gap-2 items-center" onClick={()=>{onQueue(tracks);setSaved("Tracks added to the end of your queue.");}}><Plus size={16}/>Add to queue</button>
    <select aria-label="Add discoveries to a playlist" value="" disabled={saving||!listeler.length} onChange={e=>{if(e.target.value)void save(e.target.value);}} className="form-select min-h-11 text-xs"><option value="">Add to your playlist…</option>{listeler.map(l=><option key={l.id} value={l.id}>{l.ad}</option>)}</select>
    <button disabled={saving} className="button-secondary" onClick={async()=>{const name=mode==='path'?`${target.parca?.baslik} → ${end?.baslik}`:`${target.parca?.baslik} · Mix`;setSaving(true);try{const l=await api.listeOlustur(name.slice(0,200));await api.listeyeEkle(l.id,tracks);onSaved();setSaved("Your new playlist is saved.");}catch(e){setError((e as Error).message);}finally{setSaving(false);}}}>Save as a new playlist</button></div>
    {mode==='similar-tracks' && result?.matches?.some(m=>m.similarity!=null) && <p className="text-xs text-muted-foreground mb-3">{result?.analysis?"Scores compare audio samples of up to 45 seconds, rather than the full recording.":"Scores indicate audio similarity, not how much you will like a track."}</p>}
    <ol>{tracks.map((p,i)=>{const match=result?.matches?.find(m=>m.parca.appId===p.appId);return <li key={`${p.id}:${i}`} className="flex items-center gap-3 py-2 border-b border-white/5"><span className="text-xs text-muted-foreground w-5">{i+1}</span><Kapak kaynak={p} className="h-10 w-10"/><div className="flex-1 min-w-0"><p className="text-sm truncate">{p.baslik}</p><p className="text-xs text-muted-foreground truncate">{p.sanatci}</p>{match?.method && <p className="text-xs text-muted-foreground">{match.method==='audio_excerpt'?"Audio similarity":"Catalog recommendation"}</p>}</div>{mode==='similar-tracks' && match?.similarity!=null && <span className="text-xs tabular-nums">{match.similarity.toFixed(2)}</span>}</li>})}</ol>
  </>}
  {result?.sanatcilar?.map(a=><button key={a.appId||a.id} className="button-secondary m-1" onClick={()=>{onArtist(a.id);onClose();}}>{a.ad}</button>)}
  {cap?.available && <button disabled={saving} className="button-secondary mt-5 text-xs" onClick={async()=>{setSaving(true);try{const r=await api.sonicRefresh();setSaved(r.message || (r.state==='submitted'?"Library analysis queued.":"Audio analysis could not be started right now."));}catch(e){setError((e as Error).message);}finally{setSaving(false);}}}>Refresh library audio analysis</button>}
  {saved && <p role="status" className="text-sm text-primary mt-4">{saved}</p>}
 </div>;
}
