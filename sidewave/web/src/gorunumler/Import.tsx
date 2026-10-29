import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, Check, CheckCheck, FileMusic, Loader2, Upload, X } from 'lucide-react';
import { api, sureBicim, type ImportRow, type ImportPreview } from '../api';
import { SpotifyImportDialog } from './SpotifyImport';

export function ImportDialog({onClose,onCreated,onImported,spotifyReviewJobId}:{onClose:()=>void;onCreated:(id:string)=>void;onImported?:()=>void;spotifyReviewJobId?:string}) {
  const [spotify,setSpotify]=useState(!!spotifyReviewJobId);
  return spotify?<SpotifyImportDialog reviewJobId={spotifyReviewJobId} onBack={()=>setSpotify(false)} onClose={onClose} onImported={()=>onImported?.()}/>:<FileImportDialog onClose={onClose} onCreated={onCreated} onSpotify={()=>setSpotify(true)}/>;
}
function FileImportDialog({onClose, onCreated,onSpotify}: {onClose: () => void; onCreated: (id: string) => void;onSpotify:()=>void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [format, setFormat] = useState<string | undefined>();
  const [fileName, setFileName] = useState('');
  const [text, setText] = useState(''), [name, setName] = useState("Imported playlist");
  const [rows, setRows] = useState<ImportRow[] | null>(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [duplicates, setDuplicates] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null), [pending, setPending] = useState(false);
  const [progress, setProgress] = useState({completed: 0, total: 0});
  const activeJob = useRef<string | null>(null);
  const applyPreview = (result: ImportPreview) => {
    setRows(result.rows); setDuplicates(result.duplicates); setJobId(result.jobId || null); setPending(!!result.pending);
    setProgress({completed: result.completed || 0, total: result.total || result.rows.length});
    activeJob.current = result.pending ? result.jobId || null : null;
  };
  const close = () => { if (activeJob.current) void api.importCancel(activeJob.current).catch(() => {}); activeJob.current = null; onClose(); };
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  useEffect(() => {
    if (!jobId || !pending) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const result = await api.importStatus(jobId); if (stopped) return; applyPreview(result); if (result.pending) timer = setTimeout(poll, 1000); }
      catch (e) { if (!stopped) { setError((e as Error).message); setPending(false); } }
    };
    timer = setTimeout(poll, 1000); return () => { stopped = true; clearTimeout(timer); };
  }, [jobId, pending]);
  useEffect(() => () => { if (activeJob.current) void api.importCancel(activeJob.current).catch(() => {}); }, []);
  async function cancelPreview() {
    if (jobId) { try { await api.importCancel(jobId); } catch (e) { setError((e as Error).message); return; } }
    activeJob.current = null; setPending(false); setJobId(null); setRows(null); setError('');
  }
  async function preview() { setBusy(true); setError(''); try { applyPreview(await api.importPreview(text, format)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function commit() { setBusy(true); setError(''); try { const result = await api.importCommit(name, rows!.flatMap(row => row.selected ? [row.selected] : [])); onCreated(result.id); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  const selected = rows?.filter(row => row.selected).length || 0;
  return <dialog ref={dialog} aria-modal="true" aria-label="Import playlist" aria-describedby="import-description"
    onCancel={event => { event.preventDefault(); if (!busy) close(); }}
    className="m-auto w-[calc(100%-1.5rem)] max-w-3xl max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-2xl border border-border bg-popover p-0 text-foreground shadow-2xl backdrop:bg-black/75 backdrop:backdrop-blur-sm">
    <div className="flex max-h-[calc(100dvh-1.5rem)] flex-col">
      <header className="shrink-0 border-b border-border px-5 pt-5 pb-4 sm:px-7 sm:pt-6">
        <div className="flex items-start gap-3 sm:gap-4">
          <div className="mt-0.5 grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><FileMusic size={23} strokeWidth={1.6} /></div>
          <div className="min-w-0 flex-1"><h2 className="text-xl font-semibold tracking-tight">Bring your playlists</h2><p id="import-description" className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted-foreground">Upload a CSV or M3U, or paste a list of artists and songs. Review the matches and make it yours.</p></div>
          <button aria-label="Close" disabled={busy} onClick={close} className="-mt-1 -mr-2 grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground disabled:opacity-40"><X size={20} /></button>
        </div>
        <button onClick={onSpotify} disabled={busy||pending} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full border border-primary/25 bg-primary/5 px-4 text-sm font-medium text-primary disabled:opacity-40">Import from Spotify <ArrowRight size={15}/></button>
        <ol aria-label="Import steps" className="mt-5 flex items-center gap-3 text-xs font-medium">
          <li aria-current={!rows ? 'step' : undefined} className={`flex items-center gap-2 ${!rows ? 'text-foreground' : 'text-muted-foreground'}`}><span className={`grid size-6 place-items-center rounded-full ${!rows ? 'bg-primary/15 text-primary' : 'bg-white/5'}`}>{rows ? <Check size={13} /> : '1'}</span> Add your music</li>
          <ArrowRight size={13} aria-hidden="true" className="text-muted-foreground/50" />
          <li aria-current={rows ? 'step' : undefined} className={`flex items-center gap-2 ${rows ? 'text-foreground' : 'text-muted-foreground'}`}><span className={`grid size-6 place-items-center rounded-full ${rows ? 'bg-primary/15 text-primary' : 'bg-white/5'}`}>2</span> Review matches</li>
        </ol>
      </header>
      <div className="min-h-0 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
        <label className="mb-5 block text-sm font-medium">Playlist name<input autoFocus value={name} maxLength={150} onChange={event => setName(event.target.value)} className="mt-2 block min-h-12 w-full rounded-xl border border-input bg-background px-4 text-base" /></label>
        {pending && <div role="status" className="mb-5 rounded-xl border border-primary/15 bg-primary/5 px-4 py-2">
          <div className="flex items-center gap-2 text-sm"><Loader2 size={16} className="shrink-0 animate-spin text-primary" /><span className="flex-1">Finding matches · {progress.completed}/{progress.total}</span><button onClick={cancelPreview} className="min-h-11 px-2 text-xs text-muted-foreground hover:text-foreground">Cancel</button></div>
          <div role="progressbar" aria-label="Matching progress" aria-valuenow={progress.completed} aria-valuemin={0} aria-valuemax={progress.total || 1} className="mb-2 h-1 rounded-full overflow-hidden bg-white/5"><div className="h-full rounded-full bg-primary transition-[width]" style={{width: `${progress.total ? progress.completed / progress.total * 100 : 0}%`}} /></div>
        </div>}
        {!rows ? <>
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-4">
            <button onClick={() => fileInput.current?.click()} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-border bg-secondary px-4 text-sm font-medium transition-colors hover:bg-white/10"><Upload size={16} /> Choose file</button>
            <div className="min-w-0 flex-1"><p className="truncate text-sm text-foreground">{fileName || "CSV, M3U or TXT"}</p><p className="mt-1 text-xs text-muted-foreground">Up to 500 songs</p></div>
            <input ref={fileInput} type="file" accept=".csv,.m3u,.m3u8,.txt" className="sr-only" tabIndex={-1} aria-label="Import file" onChange={async event => {
              const file = event.target.files?.[0]; if (!file) return;
              try { const content = await file.text(); setFormat(file.name.toLowerCase().endsWith('.csv') ? 'csv' : /\.m3u8?$/i.test(file.name) ? 'm3u' : undefined); setText(content); setName(file.name.replace(/\.[^.]+$/, '')); setFileName(file.name); setError(''); }
              catch { setError("Could not read this file. Choose it again or paste your songs below."); }
            }} />
          </div>
          <label className="block text-sm font-medium">Or paste your songs here<textarea aria-label="Songs to import" className="mt-2 block min-h-44 w-full resize-y rounded-xl border border-input bg-background p-4 text-sm leading-7 placeholder:text-muted-foreground/60" value={text} onChange={event => setText(event.target.value)} placeholder={"Khruangbin – Friday Morning\nDaft Punk – Get Lucky"} /></label>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">One artist and song per line.</p>
        </> : <>
          <div className="mb-4 flex items-center gap-2.5"><CheckCheck size={18} className="shrink-0 text-primary" /><p className="text-sm text-muted-foreground">{selected} selected · {duplicates} duplicates · {rows.filter(row => !row.selected).length} unselected</p></div>
          {!rows.length && <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 text-center"><p className="font-medium">No songs found in this list</p><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Go back and check your file or line format.</p></div>}
          <div className="space-y-2.5">{rows.map((row, index) => {
            const searching = row.status === 'pending', failed = row.status === 'error';
            return <div key={row.index} className="min-w-0 rounded-xl border border-white/[0.06] bg-white/[0.025] p-3.5 sm:p-4">
              <div className="mb-3 flex items-start gap-3">
                <span className="mt-0.5 min-w-5 text-xs tabular-nums text-muted-foreground">{index + 1 < 10 ? `0${index + 1}` : index + 1}</span>
                <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium leading-5">{row.baslik}</p>{row.sanatci && <p className="mt-1 truncate text-xs text-muted-foreground">{row.sanatci}</p>}</div>
                <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium ${row.selected ? 'bg-primary/10 text-primary' : failed ? 'bg-destructive/10 text-destructive' : 'bg-white/5 text-muted-foreground'}`}>
                  {searching ? <Loader2 size={11} className="animate-spin" /> : row.selected ? <Check size={11} /> : failed ? <AlertCircle size={11} /> : null}
                  {searching ? "Searching" : row.selected ? "Matched" : failed ? "Source unavailable" : row.candidates.length ? "Needs review" : "Unmatched"}
                </span>
              </div>
              <select disabled={pending} aria-label={`${row.baslik} match`} className="min-h-12 w-full min-w-0 max-w-full rounded-lg border border-input bg-background px-3 text-sm disabled:opacity-50" value={row.selected ? `${row.selected.kaynak}:${row.selected.id}` : ''} onChange={event => setRows(current => current!.map((r, i) => index === i ? {...r, selected: r.candidates.find(p => `${p.kaynak}:${p.id}` === event.target.value) || null} : r))}>
                <option value="">{searching ? "Finding matches…" : row.candidates.length ? "Skip this row / choose a match" : failed ? "Source unavailable — will skip" : "No match found — will skip"}</option>
                {row.candidates.map(p => <option key={`${p.kaynak}:${p.id}`} value={`${p.kaynak}:${p.id}`}>{p.sanatci} — {p.baslik} · {sureBicim(p.sure)} · {p.kaynak === 'kutuphane' ? "Library" : "Online"}</option>)}
              </select>
            </div>;
          })}</div>
        </>}
        {error && <p role="alert" className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm leading-relaxed text-destructive">{error}</p>}
      </div>
      <footer className="shrink-0 border-t border-border px-5 py-4 sm:px-7">
        <div className="flex items-center justify-end gap-2.5">
          <p className="mr-auto hidden max-w-56 text-xs leading-relaxed text-muted-foreground sm:block">Creates a playlist only.<br />Tracks are not downloaded automatically.</p>
          {rows && <button disabled={busy || pending} className="min-h-12 px-5 rounded-full border border-border text-sm font-medium hover:bg-white/5 disabled:opacity-40" onClick={() => { setRows(null); setError(''); }}>Back</button>}
          <button disabled={busy || pending || !name.trim() || (!rows ? !text.trim() : !selected)} onClick={rows ? commit : preview} className="min-h-12 px-5 rounded-full bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-40 inline-flex items-center justify-center gap-2 hover:brightness-110 transition">
            {busy ? <Loader2 size={16} className="animate-spin" /> : rows ? <Check size={16} /> : null}{rows ? "Save playlist" : "Review matches"}{!busy && !rows && <ArrowRight size={16} />}
          </button>
        </div>
      </footer>
    </div>
  </dialog>;
}
