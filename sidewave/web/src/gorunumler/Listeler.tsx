import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Play, Shuffle, Heart, Trash2, Loader2, ListMusic, Pencil, X, AlertCircle, RefreshCw, Search, Plus, Share2, Sparkles } from "lucide-react";
import { api, uzunSure, type Liste, type Parca } from "../api";
import { Kapak, ListeKapagi, ParcaTablosu, SayfaHero } from "../bilesenler/Ortak";
import { usePlayerActions } from "../PlayerActions";
import { PaylasDialog } from "./Paylasilan";
import { useToast } from "../bilesenler/Toast";

const primaryAction = "min-h-12 px-6 rounded-full bg-primary text-primary-foreground font-semibold inline-flex items-center justify-center gap-2 hover:brightness-110 transition disabled:opacity-40";
const secondaryAction = "min-h-12 px-5 rounded-full border border-border font-medium inline-flex items-center justify-center gap-2 hover:bg-white/5 transition-colors disabled:opacity-40";

type OrtakProps = {
  calan: Parca | null;
  onCal: (p: Parca, liste: Parca[]) => void;
  onSanatciId: (id: string) => void;
  onAlbumId: (id: string) => void;
  onFavori: (p: Parca) => void;
  listeler: Liste[];
  onListeYenile: () => void;
  onKesfet?: () => void;
};

function ListeDurumu({ loading, error, title, children, onRetry, onKesfet }: {
  loading?: boolean; error?: string; title: string; children?: React.ReactNode; onRetry?: () => void; onKesfet?: () => void;
}) {
  return <div className="surface-panel rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-12 sm:py-16 text-center" role={error ? "alert" : loading ? "status" : undefined}>
    <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl border border-white/[0.06] bg-white/[0.03] text-muted-foreground">
      {loading ? <Loader2 size={23} className="animate-spin" /> : error ? <AlertCircle size={23} /> : <ListMusic size={25} />}
    </div>
    <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
    {(error || children) && <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{error || children}</p>}
    {error && onRetry && <button className={`${secondaryAction} mt-6 text-sm`} onClick={onRetry}><RefreshCw size={16} /> Try again</button>}
    {!error && !loading && onKesfet && <button className={`${primaryAction} mt-6 text-sm`} onClick={onKesfet}><Search size={16} /> Find music</button>}
  </div>;
}

function ListeDialog({ mode, name, busy, error, onClose, onSubmit }: {
  mode: "rename" | "delete"; name: string; busy: boolean; error: string;
  onClose: () => void; onSubmit: (name: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId(), descriptionId = useId();
  const [value, setValue] = useState(name);
  const deleting = mode === "delete";
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  return <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-border bg-popover p-0 text-foreground shadow-2xl backdrop:bg-black/75 backdrop:backdrop-blur-sm">
    <form onSubmit={event => { event.preventDefault(); onSubmit(value.trim()); }} className="p-6 sm:p-7">
      <div className="flex items-start justify-between gap-4">
        <div className={`mb-5 grid size-12 place-items-center rounded-xl ${deleting ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
          {deleting ? <Trash2 size={21} /> : <Pencil size={21} />}
        </div>
        <button type="button" aria-label="Close" disabled={busy} onClick={onClose} className="-mr-2 -mt-2 grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-white/5 hover:text-foreground"><X size={20} /></button>
      </div>
      <h2 id={titleId} className="text-xl font-semibold tracking-tight">{deleting ? "Delete this playlist?" : "Give your playlist a new name"}</h2>
      <p id={descriptionId} className="mt-2 text-sm leading-relaxed text-muted-foreground">{deleting ? `“${name}” will be removed. Your songs will stay in your library and liked songs.` : "Give this playlist a name that means something to you."}</p>
      {!deleting && <label className="mt-6 block text-sm font-medium">Playlist name<input autoFocus value={value} maxLength={150} onChange={event => setValue(event.target.value)} disabled={busy} className="mt-2 block min-h-12 w-full rounded-xl border border-input bg-background px-4 text-base" /></label>}
      {error && <p role="alert" className="mt-4 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      <div className="mt-7 flex justify-end gap-2">
        <button autoFocus={deleting} type="button" disabled={busy} className={secondaryAction} onClick={onClose}>Cancel</button>
        <button type="submit" disabled={busy || (!deleting && !value.trim())} className={deleting ? "min-h-12 rounded-full bg-destructive px-5 font-semibold text-destructive-foreground inline-flex items-center gap-2 disabled:opacity-40" : primaryAction}>
          {busy && <Loader2 size={16} className="animate-spin" />}{deleting ? "Delete playlist" : "Save"}
        </button>
      </div>
    </form>
  </dialog>;
}

export function FavorilerGorunum(props: OrtakProps & { yenileme: number }) {
  const [parcalar, setParcalar] = useState<Parca[]>([]);
  const [yuk, setYuk] = useState(true);
  const [hata, setHata] = useState("");
  const [retry, setRetry] = useState(0);
  const actions = usePlayerActions(), ilk = useRef(true);
  useEffect(() => { ilk.current = true; }, [retry]);
  useEffect(() => {
    let active = true;
    // After a like/unlike, refresh quietly: the table keeps its search, sort, page and scroll.
    const sessiz = !ilk.current; ilk.current = false;
    if (!sessiz) { setYuk(true); setHata(""); }
    api.favoriler().then(d => { if (active) { setParcalar(d.parcalar || []); setHata(""); } })
      .catch(e => { if (active && !sessiz) setHata(e.message); }).finally(() => { if (active) setYuk(false); });
    return () => { active = false; };
  }, [props.yenileme, retry]);
  const toplam = parcalar.reduce((t, p) => t + (p.sure || 0), 0);
  return <>
    <SayfaHero ust="Playlist" baslik="Liked Songs"
      kapak={<div className="w-full h-full rounded-2xl border border-white/10 bg-gradient-to-br from-primary/25 via-primary/10 to-card grid place-items-center shadow-xl"><Heart size={64} strokeWidth={1.5} className="fill-primary/15 text-primary" /></div>}
      alt={<span>{yuk ? "Getting your library ready" : `${parcalar.length} tracks${toplam ? ` · ${uzunSure(toplam)}` : ""}`}</span>}
      eylemler={!yuk && !hata && parcalar.length ? <>
        <button onClick={() => props.onCal(parcalar[0], parcalar)} className={primaryAction}><Play size={18} className="fill-current" /> Play</button>
        <button onClick={() => actions?.shuffleAll(parcalar)} className={secondaryAction}><Shuffle size={17} /> Shuffle</button>
      </> : undefined} />
    {yuk ? <ListeDurumu loading title="Loading your liked songs…" /> : hata ? <ListeDurumu error={hata} title="Could not load your liked songs" onRetry={() => setRetry(value => value + 1)} /> : !parcalar.length ?
      <ListeDurumu title="A home for your favorites" onKesfet={props.onKesfet}>Tap the heart beside a song. Your liked songs follow you across your devices.</ListeDurumu> :
      <section className="music-section" aria-label="Your liked songs"><ParcaTablosu parcalar={parcalar} calan={props.calan} onCal={props.onCal}
        onSanatci={t => t.sanatciId && props.onSanatciId(`${t.kaynak === "youtube" ? "yt:" : ""}${t.sanatciId}`)}
        onAlbum={t => t.albumId && props.onAlbumId(`${t.kaynak === "youtube" ? "yt:" : ""}${t.albumId}`)}
        onFavori={props.onFavori} listeler={props.listeler} onListeYenile={props.onListeYenile} /></section>}
  </>;
}

export function CalmaListesiGorunum(props: OrtakProps & { id: string; onSilindi: () => void }) {
  const [d, setD] = useState<(Liste & { parcalar: Parca[] }) | null>(null);
  const [yuk, setYuk] = useState(true), [hata, setHata] = useState("");
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);
  const [paylas, setPaylas] = useState(false), [akilliYuk, setAkilliYuk] = useState(false);
  const [busy, setBusy] = useState(false), [dialogError, setDialogError] = useState("");
  const generation = useRef(0);
  const actions = usePlayerActions(), toast = useToast();
  const yukle = useCallback(() => {
    const current = ++generation.current;
    setYuk(true); setHata("");
    api.liste(props.id).then(value => { if (current === generation.current) setD(value); })
      .catch(e => { if (current === generation.current) setHata(e.message); })
      .finally(() => { if (current === generation.current) setYuk(false); });
  }, [props.id]);
  useEffect(() => { setD(null); setDialog(null); yukle(); return () => { generation.current++; }; }, [yukle]);
  // Removal is applied locally first and can be undone; the server keeps the list order.
  async function cikarToplu(indeksler: number[]) {
    if (!d) return;
    const removed = indeksler.map(i => d.parcalar[i]).filter(p => p?.entryId);
    if (!removed.length) return;
    const ids = new Set(removed.map(p => p.entryId));
    setD({...d, parcalar: d.parcalar.filter(p => !ids.has(p.entryId))});
    try {
      await Promise.all(removed.map(p => api.listedenCikar(props.id, p.entryId!)));
      props.onListeYenile();
      toast(removed.length === 1 ? `Removed “${removed[0].baslik}”.` : `Removed ${removed.length} tracks.`, {label: "Undo", onClick: () => void api.listeyeEkle(props.id, removed).then(() => { yukle(); props.onListeYenile(); }).catch(e => setHata((e as Error).message))});
    } catch (e) { setHata((e as Error).message); yukle(); }
  }
  const cikar = (indeks: number) => cikarToplu([indeks]);
  async function kaydet(name: string) {
    if (busy) return;
    setBusy(true); setDialogError("");
    try {
      if (dialog === "delete") { await api.listeSil(props.id); props.onListeYenile(); props.onSilindi(); }
      else { await api.listeGuncelle(props.id, {ad: name}); setD(current => current ? {...current, ad: name} : current); props.onListeYenile(); }
      setDialog(null);
    } catch (e) { setDialogError((e as Error).message); } finally { setBusy(false); }
  }
  async function tasi(indeks: number, yon: number) {
    if (!d) return; const parcalar = [...d.parcalar], target = indeks + yon;
    if (target < 0 || target >= parcalar.length || !yon) return;
    parcalar.splice(target, 0, parcalar.splice(indeks, 1)[0]);
    const previous = d; setD({...d, parcalar});
    try { await api.listeGuncelle(props.id, {entryIds: parcalar.map(p => p.entryId!)}); } catch (e) { setD(previous); setHata((e as Error).message); }
  }
  if (yuk && !d) return <ListeDurumu loading title="Opening your playlist…" />;
  if (!d) return <ListeDurumu title="Could not open this playlist" error={hata || "Your playlist is unavailable right now."} onRetry={yukle} />;
  const p = d.parcalar || [], total = p.reduce((sum, track) => sum + (track.sure || 0), 0);
  return <>
    <SayfaHero ust="Playlist" baslik={d.ad}
      kapak={<ListeKapagi liste={{kapaklar: mozaik(p)}} boyut={512} className="w-full h-full" />}
      alt={<span>{p.length} tracks{total ? ` · ${uzunSure(total)}` : ""}</span>}
      eylemler={<>
        {p.length > 0 && <button onClick={() => props.onCal(p[0], p)} className={primaryAction}><Play size={18} className="fill-current" /> Play</button>}
        {p.length > 1 && <button onClick={() => actions?.shuffleAll(p)} className={secondaryAction}><Shuffle size={17} /> Shuffle</button>}
        {p.length > 2 && actions?.smartShuffle && <button disabled={akilliYuk} onClick={async () => { setAkilliYuk(true); try { const r = await api.listeOnerileri(props.id).catch(() => ({parcalar: [] as Parca[]})); actions.smartShuffle!(p, r.parcalar); if (!r.parcalar.length) toast("No recommendations right now; shuffling your playlist."); } finally { setAkilliYuk(false); } }} className={secondaryAction} title="Shuffle with recommended songs mixed in">{akilliYuk ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Smart Shuffle</button>}
        <button onClick={() => setPaylas(true)} className={secondaryAction}><Share2 size={16} /> Share</button>
        <button onClick={() => { setDialogError(""); setDialog("rename"); }} className={secondaryAction}><Pencil size={16} /> Rename</button>
        <button onClick={() => { setDialogError(""); setDialog("delete"); }} title="delete playlist" className={`${secondaryAction} text-muted-foreground hover:text-destructive hover:border-destructive/50`}><Trash2 size={17} /> Delete</button>
      </>} />
    {hata && <p role="alert" className="mb-5 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">{hata}</p>}
    {!p.length ? <ListeDurumu title="Start with a song" onKesfet={props.onKesfet}>Choose this playlist from a song’s menu. Bring the tracks you love together.</ListeDurumu> :
      <section className="music-section" aria-label="Playlist tracks" aria-busy={yuk}><ParcaTablosu parcalar={p} calan={props.calan} onCal={props.onCal}
        onSanatci={t => t.sanatciId && props.onSanatciId(`${t.kaynak === "youtube" ? "yt:" : ""}${t.sanatciId}`)}
        onAlbum={t => t.albumId && props.onAlbumId(`${t.kaynak === "youtube" ? "yt:" : ""}${t.albumId}`)}
        onFavori={props.onFavori} onCikar={cikar} onCikarToplu={cikarToplu} onTasi={tasi} listeler={props.listeler} onListeYenile={props.onListeYenile} /></section>}
    {p.length > 0 && <ListeOnerileri key={props.id} id={props.id} trackCount={p.length} onAdded={() => { yukle(); props.onListeYenile(); }} onCal={props.onCal} />}
    {paylas && <PaylasDialog id={props.id} name={d.ad} onClose={() => setPaylas(false)} />}
    {dialog && <ListeDialog mode={dialog} name={d.ad} busy={busy} error={dialogError} onClose={() => !busy && setDialog(null)} onSubmit={kaydet} />}
  </>;
}

function mozaik(tracks: Parca[]) {
  const out: Partial<Parca>[] = [], seen = new Set<string>();
  for (const t of tracks) { const key = t.albumId || t.kapakId || t.kapakUrl || t.id; if (seen.has(key)) continue; seen.add(key); out.push(t); if (out.length === 4) break; }
  return out;
}

/** Spotify-style "Recommended" under a playlist: songs like the ones in it, one tap to add. */
function ListeOnerileri({ id, trackCount, onAdded, onCal }: { id: string; trackCount: number; onAdded: () => void; onCal: (p: Parca, liste: Parca[]) => void }) {
  const [items, setItems] = useState<Parca[] | null>(null), [offset, setOffset] = useState(0), [error, setError] = useState(""), [adding, setAdding] = useState<string | null>(null);
  const toast = useToast();
  useEffect(() => { let active = true; setItems(null); setError(""); api.listeOnerileri(id, offset).then(d => { if (active) setItems(d.parcalar); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [id, offset]);
  // Refill when a song was added from here and the list changed.
  useEffect(() => { if (items && items.length < 4) setOffset(n => n + 1); }, [trackCount]); // eslint-disable-line react-hooks/exhaustive-deps
  async function ekle(p: Parca) {
    setAdding(p.id);
    try { await api.listeyeEkle(id, [p]); setItems(all => (all || []).filter(x => x !== p)); toast(`Added “${p.baslik}”.`); onAdded(); }
    catch (e) { setError((e as Error).message); } finally { setAdding(null); }
  }
  return <section className="music-section mt-12" aria-labelledby="playlist-recs-title">
    <div className="section-heading mb-3 flex items-end justify-between gap-4"><div><h2 id="playlist-recs-title" className="text-xl font-semibold tracking-tight">Recommended</h2><p className="text-xs text-muted-foreground mt-1">Based on what’s in this playlist</p></div>
      <button onClick={() => setOffset(n => n + 1)} disabled={!items} className="min-h-11 px-4 rounded-full border border-border text-sm inline-flex items-center gap-2 hover:bg-white/5 disabled:opacity-40"><RefreshCw size={15} />Refresh</button></div>
    {error ? <p role="alert" className="text-sm text-muted-foreground">{error}</p> : !items ? <div role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" />Finding songs that fit…</div>
      : !items.length ? <p className="text-sm text-muted-foreground py-4">No new suggestions right now. Try Refresh.</p>
      : <ul className="playlist-recs">{items.map(p => <li key={`${p.kaynak}:${p.id}`} className="playlist-rec">
          <button className="flex flex-1 min-w-0 items-center gap-3 text-left" onClick={() => onCal(p, items)} aria-label={`Play ${p.baslik}`}><Kapak kaynak={p} boyut={96} className="h-11 w-11 shrink-0" /><span className="min-w-0"><span className="block truncate text-sm font-medium">{p.baslik}</span><span className="block truncate text-xs text-muted-foreground">{p.sanatci}</span></span></button>
          <button onClick={() => void ekle(p)} disabled={adding !== null} className="min-h-10 px-4 rounded-full border border-border text-sm font-medium inline-flex items-center gap-1.5 hover:border-foreground disabled:opacity-40">{adding === p.id ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}Add</button>
        </li>)}</ul>}
  </section>;
}
