import { useEffect, useState, type CSSProperties } from 'react';
import { ArrowUpRight, AudioLines, CalendarDays, Disc3, Loader2, Play, RefreshCw, Shuffle } from 'lucide-react';
import { api, uzunSure, type Collection, type Liste, type Parca } from '../api';
import { ParcaTablosu, SayfaHero } from '../bilesenler/Ortak';
import type { Gorunum } from '../navigation';
import { usePlayerActions } from '../PlayerActions';

export function CollectionCover({collection,weekly=false}: {collection?:Collection;weekly?:boolean}) {
 return <div className={`collection-cover ${weekly?'is-weekly':''} ${collection?.kapak&&!weekly?'has-cover-art':''}`} style={{'--collection-color':collection?.renk||'#58a990'} as CSSProperties} aria-hidden="true">{collection?.kapak&&!weekly&&<img className="collection-cover-art" src={collection.kapak} alt="" loading="lazy" onError={e=>{e.currentTarget.style.display='none';}}/>}<div className="collection-orbits"><i/><i/><i/></div><span className="collection-cover-brand">{weekly?'SIDEWAVE':'SIDEWAVE SESSIONS'}</span>{weekly?<AudioLines className="collection-cover-icon"/>:<Disc3 className="collection-cover-icon"/>}<span className="collection-cover-title">{weekly?<>Discover<br/>Weekly</>:collection?.ad}</span><span className="collection-cover-genre">{weekly?"A FRESH MIX EVERY MONDAY":collection?.tur}</span></div>;
}
export function CollectionsView({view,onOpen,calan,onCal,onSanatciId,onAlbumId,onFavori,listeler,onListeYenile}: {
 view:Gorunum;onOpen:(id:string)=>void;calan:Parca|null;onCal:(p:Parca,tracks:Parca[])=>void;onSanatciId:(id:string)=>void;onAlbumId:(id:string)=>void;onFavori:(p:Parca)=>void;listeler:Liste[];onListeYenile:()=>void;
}) {
 const [data,setData]=useState<Collection|null>(null),[collections,setCollections]=useState<Collection[]>([]),[busy,setBusy]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0),[genre,setGenre]=useState("All");
 const actions=usePlayerActions();
 const weekly=view.tip==='weekly',id=view.tip==='collection'?view.id:null;
 useEffect(()=>{let active=true;setBusy(true);setError('');
  const work=view.tip==='collections'?api.collections().then(d=>{if(active)setCollections(d.listeler)}):(weekly?api.weekly():api.collection(id!)).then(d=>{if(active)setData(d)});
  work.catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setBusy(false)});return()=>{active=false;};
 },[view.tip,id,retry,weekly]);
 if(view.tip==='collections')return <div className="sessions-page"><header className="sessions-heading mb-8"><p className="text-xs uppercase tracking-[.18em] text-primary mb-3">ANOTHER SIDE OF YOUR MUSIC</p><h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Sidewave Sessions</h1><p className="text-muted-foreground text-sm mt-4 max-w-xl leading-7">Find a sound. Follow a feeling. Fresh tracks every Monday.</p></header>
  <div className="flex gap-2 overflow-x-auto pb-3 mb-6" aria-label="Music genres">{["All",...new Set(collections.map(c=>c.tur||''))].map(g=><button className={`filter-chip shrink-0 ${genre===g?'is-selected':''}`} key={g} aria-pressed={genre===g} onClick={()=>setGenre(g)}>{g}</button>)}</div>
  {busy?<Loading gallery/>:error?<Failure error={error} retry={()=>setRetry(n=>n+1)}/>:<div className="collection-grid">{collections.filter(c=>genre==="All"||c.tur===genre).map(c=><button key={c.id} className="collection-card text-left group" style={{'--collection-color':c.renk} as CSSProperties} onClick={()=>onOpen(c.id)}><CollectionCover collection={c}/><div className="flex items-center justify-between gap-3 mt-4"><h2 className="font-semibold text-base">{c.ad}</h2><ArrowUpRight size={17} className="text-muted-foreground shrink-0"/></div><p className="mt-2 text-xs text-muted-foreground leading-6">{c.aciklama}</p><p className="mt-3 text-[10px] uppercase tracking-wider text-muted-foreground">{c.parcaSayisi ? `${c.parcaSayisi} tracks · ` : ""}Updated every Monday</p></button>)}</div>}
 </div>;
 if(busy)return <Loading/>;
 if(error||!data)return <Failure error={error||"Session not found."} retry={()=>setRetry(n=>n+1)}/>;
 const tracks=data.parcalar||[],total=tracks.reduce((sum,p)=>sum+(p.sure||0),0);
 function shuffle(){actions?.shuffleAll(tracks);}
 return <div className="session-detail" style={{'--collection-color':data.renk||'#58a990'} as CSSProperties}><SayfaHero ust={weekly?"Made for you · A weekly mix":'Sidewave Sessions'} baslik={data.ad} kapak={<CollectionCover collection={data} weekly={weekly}/>} alt={<span>{data.owner} · {tracks.length} tracks{total?` · ${uzunSure(total)}`:''}</span>} eylemler={<><button disabled={!tracks.length} className="button-primary inline-flex items-center gap-2" onClick={()=>onCal(tracks[0],tracks)}><Play size={18} className="fill-current"/>Play</button><button disabled={!tracks.length} className="button-secondary inline-flex items-center gap-2" onClick={shuffle}><Shuffle size={18}/>Shuffle</button></>}/>
  <div className="mb-7 text-sm text-muted-foreground leading-7">{weekly?<><p className="inline-flex items-center gap-2"><CalendarDays size={16}/>{data.refreshAt?`Next mix: ${new Date(data.refreshAt).toLocaleDateString('en-GB',{timeZone:'Europe/Istanbul',day:'numeric',month:'long'})}`:"Updated every Monday."}</p><p>{data.personalized?"Inspired by your likes and recent listening. Your mix stays with you until Monday.":"A starting point for your first discoveries. Keep listening and liking to make the next mix yours."}</p></>:<><p>{data.aciklama}</p><p className="collection-update-note"><RefreshCw size={13}/>{data.updatedAt?`Updated: ${new Date(data.updatedAt).toLocaleDateString('en-GB',{timeZone:'Europe/Istanbul',day:'numeric',month:'long'})} · `:''}Fresh tracks every Monday</p></>}{data.stale&&<p role="status">{data.message}</p>}{data.partial&&!weekly&&<p role="status">Showing the recordings currently available.</p>}</div>
  {!tracks.length?<p role="status">No tracks in this session yet.</p>:<ParcaTablosu parcalar={tracks} calan={calan} onCal={onCal} onSanatci={p=>p.sanatciId&&onSanatciId(`${p.kaynak==='youtube'?'yt:':''}${p.sanatciId}`)} onAlbum={p=>p.albumId&&onAlbumId(`${p.kaynak==='youtube'?'yt:':''}${p.albumId}`)} onFavori={onFavori} listeler={listeler} onListeYenile={onListeYenile}/>}
 </div>;
}
function Loading({gallery=false}:{gallery?:boolean}) {
 if(gallery)return <div role="status" aria-label="Getting your sessions ready" className="collection-grid">{Array.from({length:8},(_,i)=><div className="collection-card" key={i} aria-hidden="true"><div className="skeleton aspect-square rounded-xl"/><div className="skeleton h-4 w-3/5 rounded mt-5"/><div className="skeleton h-3 w-full rounded mt-4"/><div className="skeleton h-3 w-4/5 rounded mt-2"/></div>)}</div>;
 return <div role="status" className="py-16 flex gap-3 items-center text-muted-foreground"><Loader2 size={20} className="animate-spin"/>Getting your session ready…</div>;
}
function Failure({error,retry}: {error:string;retry:()=>void}){return <div role="alert" className="py-12"><p className="mb-5 text-muted-foreground">{error}</p><button className="button-secondary inline-flex gap-2 items-center" onClick={retry}><RefreshCw size={17}/>Try again</button></div>}
