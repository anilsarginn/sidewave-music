import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, ExternalLink, FileArchive, Heart, Loader2, Pause, Play, Upload, X } from 'lucide-react';
import { api, sureBicim, type SpotifyImportJob, type SpotifyImportPage } from '../api';

export function SpotifyImportDialog({onBack,onClose,onImported,reviewJobId}:{onBack:()=>void;onClose:()=>void;onImported:()=>void;reviewJobId?:string}) {
  const dialog=useRef<HTMLDialogElement>(null),fileInput=useRef<HTMLInputElement>(null);
  const [job,setJob]=useState<SpotifyImportJob|null>(null),[jobs,setJobs]=useState<SpotifyImportJob[]>([]);
  const [page,setPage]=useState<SpotifyImportPage|null>(null),[collection,setCollection]=useState(''),[filter,setFilter]=useState('all'),[offset,setOffset]=useState(0);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[label,setLabel]=useState("My Spotify account"),[revision,setRevision]=useState(0);
  const [research,setResearch]=useState<Record<string,string>>({});
  const generation=useRef(0);
  useEffect(()=>{const e=dialog.current!;e.showModal();return()=>{e.close();generation.current++}},[]);
  // Opened from the home reminder: go straight to the rows that still need a choice.
  useEffect(()=>{let stopped=false;api.spotifyJobs().then(r=>{if(stopped)return;setJobs(r.jobs);const pending=reviewJobId&&r.jobs.find(j=>j.id===reviewJobId);if(pending){openJob(pending);setFilter('review')}}).catch(e=>{if(!stopped)setError(e.message)});return()=>{stopped=true}},[]);
  useEffect(()=>{
    if(!job||job.state!=='matching')return;
    let stopped=false;const timer=setInterval(()=>{api.spotifyJob(job.id).then(r=>{if(!stopped){setJob(r);setRevision(n=>n+1)}}).catch(e=>{if(!stopped)setError(e.message)})},2000);
    return()=>{stopped=true;clearInterval(timer)};
  },[job?.id,job?.state]);
  useEffect(()=>{
    if(!job){setPage(null);return}let stopped=false;
    api.spotifyRows(job.id,collection,filter,offset).then(r=>{if(!stopped)setPage(r)}).catch(e=>{if(!stopped)setError(e.message)});
    return()=>{stopped=true};
  },[job?.id,collection,filter,offset,revision]);
  async function action(task:()=>Promise<SpotifyImportJob>){setBusy(true);setError('');const current=++generation.current;try{const r=await task();if(generation.current===current){setJob(r);setRevision(n=>n+1)}}catch(e){if(generation.current===current)setError((e as Error).message)}finally{if(generation.current===current)setBusy(false)}}
  async function upload(file:File){if(file.size>64*1024*1024){setError("Files must be smaller than 64 MB.");return}setCollection('');setOffset(0);setFilter('all');await action(()=>api.spotifyUpload(file,label))}
  const matching=job?.state==='matching',selected=job?.counts.selected||0;
  const openJob=(j:SpotifyImportJob)=>{setJob(j);setCollection('');setFilter('all');setOffset(0);setPage(null);setError('');setRevision(n=>n+1)};
  return <dialog ref={dialog} aria-modal="true" aria-label="Import your Spotify library" onCancel={e=>{e.preventDefault();if(!busy)onClose()}}
    className="m-auto w-[calc(100%-1.5rem)] max-w-4xl max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-2xl border border-border bg-popover p-0 text-foreground shadow-2xl backdrop:bg-black/75">
    <div className="flex max-h-[calc(100dvh-1.5rem)] flex-col">
      <header className="shrink-0 border-b border-border px-5 py-5 sm:px-7">
        <div className="flex items-start gap-3"><div className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><FileArchive size={23}/></div>
          <div className="min-w-0 flex-1"><h2 className="text-xl font-semibold">Bring your music</h2><p className="mt-1 text-sm text-muted-foreground">Your Spotify playlists and liked songs, at home in Sidewave.</p></div>
          <button aria-label="Close" disabled={busy} onClick={onClose} className="grid size-11 shrink-0 place-items-center rounded-full hover:bg-white/5"><X size={20}/></button></div>
      </header>
      <div className="min-h-0 overflow-y-auto px-5 py-5 sm:px-7 space-y-5">
        {!job ? <>
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm leading-7">
            <p className="font-semibold">Import right away with Exportify</p>
            <p className="mt-2 text-muted-foreground">Open Exportify in your browser. Connect through Spotify, and include your <strong className="text-foreground">Export All</strong> to download your playlists. <strong className="text-foreground">Liked Songs</strong> export too. Then choose your ZIP or CSV below.</p>
            <a href="https://exportify.app/" target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full border border-primary/25 px-4 font-medium text-primary">Open Exportify <ExternalLink size={15}/></a>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">Exportify is a separate service. Sign-in happens there; this screen does not link your Sidewave account to Spotify. English and Turkish CSV columns are supported. Check that your export includes all playlists and liked songs.</p>
          </div>
          <div className="rounded-xl border border-primary/15 bg-primary/5 p-4 text-sm leading-7">
            <p className="font-medium">Works with Spotify Free</p>
            <p className="mt-1 text-xs text-muted-foreground">Another option: your Spotify account data</p>
            <ol className="mt-2 list-decimal pl-5 space-y-1"><li><a className="text-primary underline underline-offset-4" href="https://www.spotify.com/account/privacy/" target="_blank" rel="noreferrer">Open Spotify’s privacy page <ExternalLink size={13} className="inline"/></a> and choose <strong>Account data</strong> to request your data package.</li>
              <li>Spotify will send a download link when your file is ready. This can take a while.</li><li>Choose the downloaded ZIP below. Only playlists and saved tracks are read.</li></ol>
          </div>
          <label className="block text-sm font-medium">Account label<input value={label} onChange={e=>setLabel(e.target.value)} maxLength={80} className="mt-2 block min-h-12 w-full rounded-xl border border-input bg-background px-4"/><span className="mt-2 block text-xs font-normal text-muted-foreground">Keep this label when importing the same account again. Use a different label for another account.</span></label>
          <div className="rounded-xl border border-dashed border-white/15 p-5"><button disabled={busy||!label.trim()} onClick={()=>fileInput.current?.click()} className="inline-flex min-h-12 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-40">{busy?<Loader2 className="animate-spin" size={17}/>:<Upload size={17}/>}Choose Spotify data file</button><p className="mt-3 text-xs leading-6 text-muted-foreground">Exportify ZIP / CSV or Spotify JSON · Up to 64 MB<br/>You can identify your liked songs CSV in the preview. Audio files are not downloaded.</p></div>
          <ListeningHistory/>
          {jobs.length>0&&<section><h3 className="mb-3 text-sm font-medium">Previous imports</h3><div className="space-y-2">{jobs.map(j=><button key={j.id} onClick={()=>openJob(j)} className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-border px-4 text-left hover:bg-white/5"><FileArchive size={18} className="shrink-0 text-primary"/><span className="min-w-0 flex-1 truncate text-sm">{j.label}<span className="block text-xs text-muted-foreground">{new Date(j.createdAt).toLocaleDateString('en-GB')} · {j.counts.total} tracks</span></span><span className="text-xs text-muted-foreground">{j.state==='matching'?"Matching":j.state==='paused'?"Paused":j.state==='committed'?'Kaydedildi':"Review"}</span></button>)}</div></section>}
        </> : <>
          <div><div className="flex flex-wrap items-center gap-3"><h3 className="min-w-0 flex-1 break-words font-semibold">{job.label}</h3><span className="text-xs text-muted-foreground">{job.collections.filter(c=>c.kind==='playlist').length} playlists · {job.counts.total} tracks</span></div>
            <div role="status" className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">{matching?<Loader2 size={16} className="animate-spin text-primary"/>:<Check size={16} className="text-primary"/>}{matching?"Finding matches":job.state==='paused'?"Matching paused":"Matches ready"} · {job.counts.total-(job.counts.pending||0)}/{job.counts.total}</div>
            <div role="progressbar" aria-label="Spotify matching progress" aria-valuenow={job.counts.total-(job.counts.pending||0)} aria-valuemin={0} aria-valuemax={job.counts.total||1} className="mt-3 h-1 overflow-hidden rounded-full bg-white/5"><div className="h-full bg-primary" style={{width:`${job.counts.total?(job.counts.total-(job.counts.pending||0))/job.counts.total*100:100}%`}}/></div>
            <p className="mt-3 text-xs leading-6 text-muted-foreground">{selected} selected · {job.counts.ambiguous||0} need review · {job.counts.unmatched||0} not found · {job.counts.errors||0} source errors · {job.counts.unsupported||0} unsupported tracks</p>
            <p className="mt-1 text-xs text-muted-foreground">Close this screen and pick up later. Your progress is saved.</p>
          </div>
          {job.warnings.map((w,i)=><p key={i} className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-sm leading-6 text-amber-200">{w}</p>)}
          {job.collections.some(c=>c.canBeFavorites)&&<label className="block rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm font-medium">Liked songs file
            <select aria-label="Liked songs CSV" value={job.collections.find(c=>c.canBeFavorites&&c.kind==='favorites')?.id||''} disabled={busy||matching||job.state==='committed'} onChange={e=>void action(()=>api.spotifyFavoritesFile(job.id,e.target.value||null))} className="mt-2 block min-h-12 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm disabled:opacity-50"><option value="">Not selected — CSVs will become playlists</option>{job.collections.filter(c=>c.canBeFavorites).map(c=><option key={c.id} value={c.id}>{c.name} · {c.total} tracks</option>)}</select>
            <span className="mt-2 block text-xs font-normal leading-6 text-muted-foreground">Choose your Liked Songs export. Only this file is added to liked songs; other files become playlists. {matching?"Pause matching or wait for it to finish to select this file.":''}</span>
          </label>}
          {job.lastCommit&&<div role="status" className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm leading-6"><p className="font-medium text-primary">Selected tracks saved</p><p className="mt-1">{job.lastCommit.added} playlist entries added · {job.lastCommit.favorites} new likes</p><p className="mt-1 text-xs text-muted-foreground">Unselected tracks stay here. Match and save them later.</p></div>}
          <div className="flex flex-wrap gap-2"><label className="min-w-0 flex-1 text-xs text-muted-foreground">Playlist<select aria-label="Spotify playlist" value={collection} onChange={e=>{setCollection(e.target.value);setOffset(0);setPage(null)}} className="mt-1 block min-h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm text-foreground"><option value="">All playlists and liked songs</option>{job.collections.map(c=><option key={c.id} value={c.id}>{c.kind==='favorites'?'♥ ':''}{c.name} · {c.total}</option>)}</select></label>
            <label className="text-xs text-muted-foreground">Show<select aria-label="Match filter" value={filter} onChange={e=>{setFilter(e.target.value);setOffset(0);setPage(null)}} className="mt-1 block min-h-11 rounded-lg border border-input bg-background px-3 text-sm text-foreground"><option value="all">All</option><option value="review">Unselected</option><option value="selected">Selected</option></select></label></div>
          {page?<div className="space-y-2">{!page.items.length&&<p className="rounded-xl border border-border p-5 text-center text-sm text-muted-foreground">No tracks in this view.</p>}{page.items.map(row=><div key={row.id} className="min-w-0 rounded-xl border border-border p-3.5"><div className="flex gap-3"><span className="pt-1 text-xs tabular-nums text-muted-foreground">{row.position+1}</span><div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{row.baslik}</p><p className="mt-1 break-words text-xs text-muted-foreground">{row.sanatci} {row.album&&`· ${row.album}`}</p><p className="mt-1 truncate text-[11px] text-muted-foreground">{job.collections.find(c=>c.id===row.collectionId)?.name}</p></div><span className="shrink-0 text-xs text-muted-foreground">{row.applied?'Kaydedildi':row.selected?"Selected":row.status==='pending'?"Searching":row.status==='unsupported'?'Atlanacak':row.status==='error'?"Source unavailable":row.candidates.length?"Needs review":"Not found"}</span></div>
            <select aria-label={`${row.baslik} Spotify match`} disabled={busy||matching||row.applied||!row.candidates.length} value={row.selected?`${row.selected.kaynak}:${row.selected.id}`:''} onChange={e=>void action(()=>api.spotifySelect(job.id,row.id,e.target.value||null))} className="mt-3 min-h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm disabled:opacity-50"><option value="">Skip this track</option>{row.candidates.map(p=><option key={`${p.kaynak}:${p.id}`} value={`${p.kaynak}:${p.id}`}>{p.sanatci} — {p.baslik} · {p.album||"Unknown album"} · {sureBicim(p.sure)} · {p.kaynak==='kutuphane'?"Library":"Online"}</option>)}</select>{!row.applied&&<div className="flex gap-2 mt-2"><input aria-label={`${row.baslik} search again`} className="min-h-12 min-w-0 flex-1 rounded-lg bg-background border border-border px-3" value={research[row.id]??`${row.sanatci} ${row.baslik}`} onChange={e=>setResearch(old=>({...old,[row.id]:e.target.value}))}/><button disabled={busy||matching} className="min-h-12 px-3" onClick={()=>void action(()=>api.spotifyResearch(job.id,row.id,research[row.id]??`${row.sanatci} ${row.baslik}`))}>Search again</button></div>}</div>)}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs text-muted-foreground"><button disabled={!offset} onClick={()=>{setOffset(n=>Math.max(0,n-50));setPage(null)}} className="min-h-11 px-3 disabled:opacity-40">Previous</button><span>{page.total?offset+1:0}–{offset+page.items.length} / {page.total}</span><button disabled={page.nextOffset===null} onClick={()=>{setOffset(page.nextOffset!);setPage(null)}} className="min-h-11 px-3 disabled:opacity-40">Next</button></div>
          </div>:<p role="status" className="text-sm text-muted-foreground">Loading tracks…</p>}
          <p className="text-xs leading-6 text-muted-foreground">Automatic matching requires a matching title, artist, and duration or album. Covers, live versions and remixes remain distinct. Playlist duplicates are preserved; saving the same import again does not add extra copies. Playlists missing from the export cannot appear here.</p>
        </>}
        {error&&<p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      </div>
      <footer className="shrink-0 border-t border-border px-5 py-4 sm:px-7"><div className="flex flex-wrap items-center gap-2">
        <button disabled={busy} onClick={job?()=>{setJob(null);setPage(null);void api.spotifyJobs().then(r=>setJobs(r.jobs)).catch(e=>setError(e.message))}:onBack} className="inline-flex min-h-11 items-center gap-1 px-2 text-sm text-muted-foreground"><ArrowLeft size={16}/>{job?"Back to files":"Import from file"}</button>
        <div className="ml-auto flex flex-wrap justify-end gap-2">{job&&<>
          <button disabled={busy} onClick={()=>void action(()=>matching?api.spotifyPause(job.id):api.spotifyResume(job.id,true))} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm disabled:opacity-40">{matching?<Pause size={15}/>:<Play size={15}/ >}{matching?"Pause":"Try again"}</button>
          <button disabled={busy||matching||(!selected&&!job.collections.some(c=>c.kind==='playlist'&&!c.total))} onClick={()=>void action(async()=>{const r=await api.spotifyCommit(job.id);onImported();return r})} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-40">{busy?<Loader2 size={16} className="animate-spin"/>:<Heart size={16}/>}Save selected</button>
        </>}{job?.lastCommit&&<button onClick={onClose} className="min-h-11 rounded-full border border-border px-4 text-sm">Done</button>}</div>
      </div></footer>
      <input ref={fileInput} type="file" aria-label="Spotify data file" accept=".zip,.json,.csv" className="sr-only" tabIndex={-1} onChange={e=>{const f=e.target.files?.[0];if(f)void upload(f);e.target.value=''}}/>
    </div>
  </dialog>;
}

/** Listening history is optional and separate from playlists: it tunes recommendations, never adds likes. */
function ListeningHistory() {
  const input=useRef<HTMLInputElement>(null);
  const [summary,setSummary]=useState<Awaited<ReturnType<typeof api.spotifyHistory>>|null>(null),[result,setResult]=useState<Awaited<ReturnType<typeof api.spotifyHistoryUpload>>|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{api.spotifyHistory().then(setSummary).catch(()=>{});},[result]);
  async function upload(file:File){setBusy(true);setError('');try{setResult(await api.spotifyHistoryUpload(file));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <section className="rounded-xl border border-border p-4 text-sm leading-7" aria-labelledby="history-title">
    <h3 id="history-title" className="font-semibold">Listening history <span className="text-xs font-normal text-muted-foreground">· optional</span></h3>
    <p className="mt-1 text-muted-foreground">Teach Sidewave what you play most. Your history shapes daily mixes, On Repeat and recommendations. It never adds liked songs.</p>
    <p className="mt-2 text-xs text-muted-foreground">Best: request <strong className="text-foreground">Extended streaming history</strong> on <a className="text-primary underline underline-offset-4" href="https://www.spotify.com/account/privacy/" target="_blank" rel="noreferrer">Spotify’s privacy page</a>. Account data and Technical log information ZIPs work too; technical logs only name songs that are also in an imported library.</p>
    {summary&&summary.plays>0&&<p className="mt-3 text-xs">Imported so far: <strong>{summary.plays.toLocaleString('en')}</strong> plays · {summary.hours} hours{summary.topArtists.length?` · top: ${summary.topArtists.slice(0,3).map(a=>a.artist).join(', ')}`:''}</p>}
    {result&&<div role="status" className="mt-3 rounded-lg bg-primary/5 border border-primary/20 p-3 text-xs leading-6"><p className="font-medium text-primary">{result.added? `${result.added.toLocaleString('en')} plays added (${result.addedHours} hours)` : "Nothing new in this file; it was already imported."}</p>
      {result.needsNames&&<p className="mt-1 text-muted-foreground">{result.unidentifiedTracks} songs could not be named from this file. Upload Extended streaming history to include them.</p>}
      {result.onRepeat>0&&<p className="mt-1 text-muted-foreground">{result.onRepeat} songs from your Spotify On Repeat are now in your On Repeat mix.</p>}</div>}
    {error&&<p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}
    <button disabled={busy} onClick={()=>input.current?.click()} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 font-medium hover:bg-white/5 disabled:opacity-40">{busy?<Loader2 size={16} className="animate-spin"/>:<Upload size={16}/>}{busy?"Reading your history…":"Choose history ZIP"}</button>
    <input ref={input} type="file" accept=".zip" aria-label="Spotify listening history ZIP" className="sr-only" tabIndex={-1} onChange={e=>{const f=e.target.files?.[0];if(f)void upload(f);e.target.value='';}}/>
  </section>;
}
