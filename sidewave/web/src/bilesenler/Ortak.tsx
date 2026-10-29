import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Play, Plus, Heart, MoreHorizontal, Loader2, Check, X, Disc3, ArrowUp, ArrowDown, Clock3, Download, ListPlus, AudioLines, Info, ListStart, EyeOff, UserX, ListMusic, GripVertical, Share2, Volume1, Volume2, VolumeX } from "lucide-react";
import { api, kapakSrc, sureBicim, type Liste, type Parca } from "../api";

import {TrackDetails} from "./Experience";
import {useDiscovery} from "../DiscoveryContext";
import {usePlayerActions} from "../PlayerActions";
import {useToast} from "./Toast";
import {useShareTrack} from "./Paylas";
import type {Calar} from "../useCalar";

/* ------------------------------------------------------------ kucuk parcalar */

export function IconBtn({ children, onClick, aktif, baslik, disabled }: {
  children: React.ReactNode; onClick?: () => void; aktif?: boolean; baslik?: string; disabled?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} title={baslik} aria-label={baslik} aria-pressed={aktif} disabled={disabled}
      className={`music-icon-button h-11 w-11 shrink-0 grid place-items-center rounded-full transition-colors hover:bg-white/6 disabled:opacity-30 disabled:hover:bg-transparent ${
        aktif ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}>
      {children}
    </button>
  );
}

/** Range control. While dragging a non-live slider (seek) it previews locally and commits on release. */
export function Slider({ value, onChange, label = "Playback position", max = 100, step = 1, live = false, valueText }: {
  value: number; onChange: (v: number) => void; label?: string; max?: number; step?: number; live?: boolean; valueText?: (v: number) => string;
}) {
  const limit = Number.isFinite(max) && max > 0 ? max : 1;
  const [preview, setPreview] = useState<number | null>(null);
  const dragging = useRef(false);
  const shown = preview ?? (Number.isFinite(value) ? Math.min(limit, Math.max(0, value)) : 0);
  const commit = (v: number) => { if (dragging.current) { dragging.current = false; setPreview(null); onChange(v); } };
  return (
    <div className="music-slider relative flex-1 min-w-0 h-6 flex items-center group">
      <div aria-hidden="true" className="w-full h-1 bg-white/12 rounded-full">
        <div className="h-full rounded-full bg-foreground group-hover:bg-primary group-focus-within:bg-primary transition-colors relative" style={{ width: `${shown / limit * 100}%` }}>
          <span className="music-slider-thumb absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 h-3 w-3 rounded-full bg-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" />
        </div>
      </div>
      <input aria-label={label} type="range" min={0} max={limit} step={step} value={shown} aria-valuetext={valueText?.(shown)}
        onPointerDown={() => { if (!live) dragging.current = true; }}
        onChange={(e) => { const v = Number(e.target.value); if (dragging.current) setPreview(v); else onChange(v); }}
        onPointerUp={e => commit(Number(e.currentTarget.value))} onPointerCancel={e => commit(Number(e.currentTarget.value))} onBlur={e => commit(Number(e.currentTarget.value))}
        className="absolute inset-0 z-10 w-full h-full opacity-0 cursor-pointer" />
    </div>
  );
}

export function Kapak({ kaynak, boyut = 300, className = "", yuvarlak, eager }: {
  kaynak: Partial<Parca> & { gorselUrl?: string | null }; boyut?: number;
  className?: string; yuvarlak?: boolean; eager?: boolean;
}) {
  const src = kapakSrc(kaynak as any, boyut);
  const [hata, setHata] = useState(false);
  useEffect(() => setHata(false), [src]);
  if (!src || hata) {
    return (
      <div aria-hidden="true" className={`music-artwork ${className} ${yuvarlak ? "rounded-full" : "rounded-lg"} bg-[var(--sidewave-elevated)] grid place-items-center ring-1 ring-inset ring-white/5`}>
        <Disc3 className="text-muted-foreground/40" size={Math.max(16, boyut / 10)} />
      </div>
    );
  }
  return (
    <img src={src} alt="" loading={eager ? "eager" : "lazy"} decoding="async" {...(eager ? {fetchPriority: "high" as const} : {})} onError={() => setHata(true)}
      className={`music-artwork ${className} ${yuvarlak ? "rounded-full" : "rounded-lg"} object-cover bg-[var(--sidewave-elevated)]`} />
  );
}

export function VolumeButton({calar}: {calar: Pick<Calar, "ses" | "sessiz">}) {
  const Icon = calar.ses === 0 ? VolumeX : calar.ses < 50 ? Volume1 : Volume2;
  return <button type="button" onClick={calar.sessiz} aria-label={calar.ses === 0 ? "Unmute" : "Mute"} title={calar.ses === 0 ? "Unmute (M)" : "Mute (M)"} className="utility-button text-muted-foreground hover:text-foreground shrink-0"><Icon size={17} /></button>;
}

/**
 * Reorder handle for rows inside a [data-drag-list] container whose rows carry data-drag-row.
 * Works with mouse, touch and pen (pointer capture) and with the arrow keys.
 */
export function DragHandle({ index, count, label, onMove }: { index: number; count: number; label: string; onMove: (from: number, to: number) => void }) {
  const state = useRef<{rows: HTMLElement[]; target: number} | null>(null);
  const mark = (target: number) => state.current?.rows.forEach((row, i) => { row.classList.toggle("is-drop-before", i === target && target < index); row.classList.toggle("is-drop-after", i === target && target > index); });
  const finish = (commit: boolean) => {
    const current = state.current; if (!current) return;
    mark(-1); current.rows[index]?.classList.remove("is-dragging"); state.current = null;
    if (commit && current.target !== index) onMove(index, current.target);
  };
  return <button type="button" aria-label={`Reorder ${label}`} title="Drag to reorder (or use arrow keys)" aria-describedby={undefined}
    className="drag-handle music-row-action h-11 w-11 shrink-0 grid place-items-center rounded-full text-muted-foreground hover:text-foreground"
    onClick={e => e.stopPropagation()}
    onKeyDown={e => { if (e.key === "ArrowUp" && index > 0) { e.preventDefault(); e.stopPropagation(); onMove(index, index - 1); } if (e.key === "ArrowDown" && index < count - 1) { e.preventDefault(); e.stopPropagation(); onMove(index, index + 1); } }}
    onPointerDown={e => {
      const list = e.currentTarget.closest("[data-drag-list]"); if (!list) return;
      e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
      const rows = Array.from(list.querySelectorAll<HTMLElement>("[data-drag-row]"));
      state.current = {rows, target: index}; rows[index]?.classList.add("is-dragging");
    }}
    onPointerMove={e => {
      const current = state.current; if (!current) return;
      let target = current.rows.length - 1;
      for (let i = 0; i < current.rows.length; i++) { const r = current.rows[i].getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { target = i <= index ? i : i - 1; break; } }
      target = Math.max(0, Math.min(current.rows.length - 1, target));
      if (target !== current.target) { current.target = target; mark(target); }
    }}
    onPointerUp={() => finish(true)} onPointerCancel={() => finish(false)} onLostPointerCapture={() => finish(false)}>
    <GripVertical size={16} />
  </button>;
}

/** Playlist artwork: a 2×2 mosaic of its first album covers, one cover, or the list icon. */
export function ListeKapagi({ liste, className = "", boyut = 300 }: { liste: Pick<Liste, "kapaklar">; className?: string; boyut?: number }) {
  const covers = (liste.kapaklar || []).filter(Boolean);
  if (covers.length >= 4) return <div className={`playlist-mosaic ${className}`} aria-hidden="true">{covers.slice(0, 4).map((c, i) => <Kapak key={i} kaynak={c} boyut={Math.round(boyut / 2)} className="w-full h-full !rounded-none" />)}</div>;
  if (covers.length) return <Kapak kaynak={covers[0]} boyut={boyut} className={className} />;
  return <div aria-hidden="true" className={`playlist-mosaic-empty ${className}`}><ListMusic size={Math.max(18, boyut / 6)} strokeWidth={1.5} /></div>;
}

/* ------------------------------------------------------------- parca menusu */

/** One menu per row: queue actions, "not for me" and playlists, with arrow-key navigation. */
export function ParcaMenu({ parca, listeler, onYenile }: {
  parca: Parca; listeler: Liste[]; onYenile?: () => void;
}) {
  const actions = usePlayerActions(), toast = useToast(), share = useShareTrack();
  const [acik, setAcik] = useState(false);
  const [durum, setDurum] = useState<string>("");
  const [konum, setKonum] = useState<React.CSSProperties>({});
  const kutu = useRef<HTMLDivElement | null>(null);
  const tetik = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const dialog = useRef<HTMLDialogElement | null>(null);
  const [yeniAcik, setYeniAcik] = useState(false);
  const [yeniAd, setYeniAd] = useState("");
  const [yeniHata, setYeniHata] = useState("");

  useEffect(() => {
    if (yeniAcik) { dialog.current?.showModal(); dialog.current?.querySelector("input")?.focus(); }
  }, [yeniAcik]);

  useEffect(() => {
    if (!acik) return;
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const f = (e: MouseEvent) => {
      if (!kutu.current?.contains(e.target as Node) && !menu.current?.contains(e.target as Node)) setAcik(false);
    };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); setAcik(false); tetik.current?.focus(); } };
    const close = () => setAcik(false);
    const scroll = (e: Event) => { if (!(e.target instanceof Node) || !menu.current?.contains(e.target)) setAcik(false); };
    document.addEventListener("mousedown", f);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", scroll, true);
    return () => { document.removeEventListener("mousedown", f); document.removeEventListener("keydown", escape); window.removeEventListener("resize", close); document.removeEventListener("scroll", scroll, true); };
  }, [acik]);

  const kapat = () => { setAcik(false); tetik.current?.focus(); };
  async function ekle(l: Liste) {
    setDurum("...");
    try {
      await api.listeyeEkle(l.id, [parca]);
      setDurum("eklendi"); onYenile?.(); toast(`Added to ${l.ad}.`);
      setTimeout(() => { setAcik(false); setDurum(""); }, 600);
    } catch { setDurum("error"); }
  }

  async function yeniListe() {
    if (!yeniAd.trim() || durum === "...") return;
    setDurum("..."); setYeniHata("");
    try {
      const r = await api.listeOlustur(yeniAd.trim());
      if (r.id) await api.listeyeEkle(r.id, [parca]);
      setDurum("eklendi"); onYenile?.(); toast(`Added to ${yeniAd.trim()}.`);
      dialog.current?.close();
      setTimeout(() => { setAcik(false); setDurum(""); }, 600);
    } catch { setDurum("error"); setYeniHata("Could not create the playlist. Please try again."); }
  }
  const item = "min-h-11 w-full rounded-lg text-left px-3 py-2 text-sm hover:bg-white/6 focus-visible:bg-white/8 flex items-center gap-2.5 disabled:opacity-50";

  return (
    <div className="relative" ref={kutu}>
      <button ref={tetik} onClick={(e) => {
        e.stopPropagation();
        if (!acik) { const rect = e.currentTarget.getBoundingClientRect(); setKonum({left: Math.max(12, Math.min(rect.left - 200, window.innerWidth - 268)), ...(rect.top > 380 ? {bottom: window.innerHeight - rect.top + 6} : {top: rect.bottom + 6})}); }
        setAcik(v => !v);
      }}
        title="More options" aria-label={`More options for ${parca.baslik}`} aria-haspopup="menu" aria-expanded={acik}
        className="music-row-action h-11 w-11 grid place-items-center rounded-full text-muted-foreground hover:text-foreground hover:bg-white/8 transition-colors">
        {durum === "eklendi" ? <Check size={17} className="text-primary" /> : <MoreHorizontal size={18} />}
      </button>
      {acik && createPortal(
        <div ref={menu} role="menu" aria-label={`${parca.baslik} options`} onClick={(e) => e.stopPropagation()} style={konum}
          onKeyDown={e => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return; e.preventDefault();
            const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')), index = items.indexOf(document.activeElement as HTMLButtonElement);
            items[e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
          }}
          className="music-popover fixed z-50 w-64 max-w-[calc(100vw_-_2rem)] rounded-xl bg-popover border border-border shadow-2xl p-1.5">
          {actions && <>
            <button role="menuitem" className={item} onClick={() => { actions.playNext(parca); toast("Playing next."); kapat(); }}><ListStart size={16} /> Play next</button>
            <button role="menuitem" className={item} onClick={() => { actions.addToQueue(parca); toast("Added to queue."); kapat(); }}><ListPlus size={16} /> Add to queue</button>
            <button role="menuitem" className={item} onClick={() => { void share(parca); kapat(); }}><Share2 size={16} /> Share</button>
            {actions.dismiss && <button role="menuitem" className={item} onClick={() => { void actions.dismiss!(parca); kapat(); }}><EyeOff size={16} /> Not for me</button>}
            {actions.dismiss && parca.sanatci && <button role="menuitem" className={item} onClick={() => { void actions.dismiss!(parca, "artist"); kapat(); }}><UserX size={16} /> <span className="truncate">Hide songs by {parca.sanatci}</span></button>}
          </>}
          {onYenile && <>
            <div className={`px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground ${actions ? "border-t border-border mt-1" : ""}`}>Add to playlist</div>
            <div className="max-h-52 overflow-y-auto">
              {listeler.map((l) => (
                <button role="menuitem" key={l.id} onClick={() => ekle(l)} disabled={durum === "..."} className={`${item} truncate`}>
                  <span className="truncate">{l.ad}</span>
                </button>
              ))}
              {listeler.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">No playlists yet.</div>}
            </div>
            {durum === "error" && <p role="alert" className="px-3 py-2 text-xs text-destructive">Could not add the track. Try again.</p>}
            <button role="menuitem" disabled={durum === "..."} onClick={() => { setAcik(false); setYeniAd(""); setYeniHata(""); setYeniAcik(true); }} className={`${item} mt-1 border-t border-border rounded-t-none`}>
              <Plus size={14} /> Create new playlist
            </button>
          </>}
        </div>, document.body
      )}
      {yeniAcik && createPortal(<dialog ref={dialog} aria-label="New playlist" onClick={e => e.stopPropagation()} onClose={() => { setYeniAcik(false); tetik.current?.focus(); }}
        className="music-dialog m-auto w-[calc(100%_-_2rem)] max-w-[420px] rounded-2xl border border-border bg-popover p-6 text-foreground shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm">
        <form onSubmit={e => { e.preventDefault(); void yeniListe(); }}>
          <div className="flex items-center justify-between gap-4 mb-2"><h2 className="text-xl font-semibold tracking-tight">New playlist</h2><IconBtn baslik="Close" onClick={() => dialog.current?.close()}><X size={19} /></IconBtn></div>
          <p className="text-sm text-muted-foreground mb-5"><span className="text-foreground">{parca.baslik}</span> will be added to your new playlist.</p>
          <label className="block text-sm font-medium">Playlist name<input autoFocus value={yeniAd} onChange={e => setYeniAd(e.target.value)} placeholder="e.g. Night Drive" maxLength={160} className="mt-2 min-h-12 w-full rounded-lg border border-border bg-background px-3 text-sm" /></label>
          {yeniHata && <p role="alert" className="text-sm text-destructive mt-3">{yeniHata}</p>}
          <div className="flex justify-end gap-2 mt-6"><button type="button" onClick={() => dialog.current?.close()} className="min-h-11 rounded-full px-5 text-sm font-medium hover:bg-white/6">Cancel</button><button type="submit" disabled={!yeniAd.trim() || durum === "..."} className="min-h-11 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-40">{durum === "..." ? "Creating…" : "Create and add"}</button></div>
        </form>
      </dialog>, document.body)}
    </div>
  );
}

/* -------------------------------------------------------------- parca tablosu */

export type TabloProps = {
  parcalar: Parca[];
  calan: Parca | null;
  onCal: (p: Parca, liste: Parca[]) => void;
  onSanatci?: (p: Parca) => void;
  onAlbum?: (p: Parca) => void;
  onFavori?: (p: Parca) => void;
  onArsiv?: (p: Parca) => void;
  arsivDurum?: Record<string, string>;
  listeler?: Liste[];
  onListeYenile?: () => void;
  onCikar?: (indeks: number) => void;
  /** Removes several rows in one request; falls back to onCikar per row. */
  onCikarToplu?: (indeksler: number[]) => Promise<void> | void;
  onTasi?: (indeks: number, yon: number) => void;
  numarali?: boolean;
  albumGoster?: boolean;
};

export function ParcaTablosu({
  parcalar, calan, onCal, onSanatci, onAlbum, onFavori, onArsiv,
  arsivDurum = {}, listeler = [], onListeYenile, onCikar, onCikarToplu, onTasi,
  numarali, albumGoster = true,
}: TabloProps) {
  const discovery=useDiscovery(), actions=usePlayerActions(), toast=useToast();
  if (!actions?.owner) onArsiv = undefined;
  const [query,setQuery]=useState(''),[sort,setSort]=useState('original'),[source,setSource]=useState('all'),[shown,setShown]=useState(50);
  const [selected,setSelected]=useState<Set<number>>(new Set()),[bulkList,setBulkList]=useState(''),[bulkError,setBulkError]=useState(''),[bulkBusy,setBulkBusy]=useState(false);
  const [detail,setDetail]=useState<Parca|null>(null);
  const filtered=useMemo(()=>parcalar.map((p,index)=>({p,index})).filter(({p})=>(source==='all'||p.kaynak===source)&&[p.baslik,p.sanatci,p.album].join(' ').toLocaleLowerCase('tr').includes(query.toLocaleLowerCase('tr'))).sort((a,b)=>sort==='title'?a.p.baslik.localeCompare(b.p.baslik,'tr'):sort==='artist'?(a.p.sanatci||'').localeCompare(b.p.sanatci||'','tr'):sort==='newest'?b.index-a.index:a.index-b.index),[parcalar,query,sort,source]);
  useEffect(()=>{setShown(50)},[query,sort,source]);
  useEffect(()=>{setSelected(new Set())},[parcalar]);
  // Long lists render in chunks as you scroll, so a 750-song list opens instantly.
  const sentinel=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const el=sentinel.current;if(!el||shown>=filtered.length||typeof IntersectionObserver==='undefined')return;
    const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))setShown(n=>n+100)},{root:el.closest('.content-scroll'),rootMargin:'800px'});
    observer.observe(el);return()=>observer.disconnect();
  },[shown,filtered.length]);
  // Resting on a row for a moment warms that song's source so pressing play starts faster.
  const niyetZamani=useRef<ReturnType<typeof setTimeout>>(undefined);
  const niyet=(t:Parca)=>{clearTimeout(niyetZamani.current);niyetZamani.current=setTimeout(()=>api.prefetchIntent(t),250);};
  const niyetBirak=()=>clearTimeout(niyetZamani.current);
  useEffect(()=>()=>clearTimeout(niyetZamani.current),[]);
  // Moving rows only makes sense in the list's own order.
  const tasinabilir=!!onTasi&&sort==='original'&&!query&&source==='all';
  const seciliParcalar=()=>parcalar.filter((_,i)=>selected.has(i));
  const bulk=async()=>{if(!bulkList)return;setBulkBusy(true);try{await api.listeyeEkle(bulkList,parcalar.filter((_,i)=>selected.has(i)));setSelected(new Set());onListeYenile?.();setBulkError('')}catch(e){setBulkError((e as Error).message)}finally{setBulkBusy(false)}};

  const actionCount = 1 + Number(!!discovery) + Number(!!onFavori) + Number(!!onArsiv && parcalar.some(p => p.kaynak !== "kutuphane"))
    + Number(!!onListeYenile || !!actions) + (tasinabilir ? 1 : 0) + Number(!!onCikar);
  const actionWidth = 52 + actionCount * 44 + Math.max(0, actionCount - 1) * 2;
  return (
    <div className="track-table rounded-xl overflow-visible" data-drag-list={tasinabilir || undefined} style={{"--track-actions-width": `${actionWidth}px`} as React.CSSProperties}>
      <div className="track-toolbar flex flex-wrap items-center gap-2 py-3">
        <input aria-label="Search this list" placeholder="Search this list" className="min-h-12 rounded-lg bg-secondary px-3 flex-1 min-w-32" value={query} onChange={e=>setQuery(e.target.value)}/>
        <select aria-label="Track order" className="min-h-12 rounded-lg bg-secondary px-3" value={sort} onChange={e=>setSort(e.target.value)}><option value="original">Playlist order</option><option value="title">Title</option><option value="artist">Artist</option><option value="newest">Recently added</option></select>
        <select aria-label="Source filter" className="min-h-12 rounded-lg bg-secondary px-3" value={source} onChange={e=>setSource(e.target.value)}><option value="all">All sources</option><option value="kutuphane">In library</option><option value="youtube">Online</option></select>
        <button className="min-h-12 px-3" onClick={()=>setSelected(selected.size?new Set():new Set(filtered.map(x=>x.index)))}>{selected.size?"Deselect all":"Select all"}</button>
      </div>
      {selected.size>0&&<div className="flex flex-wrap items-center gap-2 py-3" role="region" aria-label="Bulk actions"><span>{selected.size} tracks</span><select aria-label="Destination playlist" value={bulkList} className="bg-secondary min-h-12 px-3" onChange={e=>setBulkList(e.target.value)}><option value="">Choose playlist</option>{listeler.map(l=><option key={l.id} value={l.id}>{l.ad}</option>)}</select><button disabled={bulkBusy||!bulkList} className="min-h-12 px-3" onClick={()=>void bulk()}>Add to playlist</button>{actions&&<button disabled={bulkBusy} className="min-h-12 px-3" onClick={()=>{const tracks=seciliParcalar();tracks.forEach(actions.addToQueue);toast(`${tracks.length} tracks added to queue.`);setSelected(new Set())}}>Add to queue</button>}{(onCikarToplu||onCikar)&&<button disabled={bulkBusy} className="min-h-12 px-3" onClick={async()=>{setBulkBusy(true);try{const indexes=[...selected].sort((a,b)=>b-a);if(onCikarToplu)await onCikarToplu(indexes);else for(const index of indexes)await onCikar!(index);setSelected(new Set())}finally{setBulkBusy(false)}}}>Remove from playlist</button>}</div>}
      {bulkError&&<p role="alert">{bulkError}</p>}
      <div className={`track-grid track-header ${albumGoster ? "has-album" : ""} px-3 py-3 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground border-b border-border/70 mb-1`}>
        <span className="text-center">#</span><span>Title</span>{albumGoster && <span className="track-album">Album</span>}<span className="flex items-center justify-end gap-2"><Clock3 aria-hidden="true" size={13} /><span>Duration</span></span>
      </div>

      {filtered.slice(0,shown).map(({p:t,index:i}) => {
        const aktif = calan?.id === t.id && calan?.kaynak === t.kaynak;
        const durum = arsivDurum[t.id];
        return (
          <div key={t.entryId || t.id + "_" + i} data-drag-row={tasinabilir || undefined} role="group" aria-label={t.baslik} tabIndex={0} onPointerEnter={() => niyet(t)} onPointerLeave={niyetBirak} onFocus={e => { if (e.target === e.currentTarget) niyet(t); }} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onCal(t, parcalar); } }} onClick={() => onCal(t, parcalar)}
            className={`track-grid track-row ${albumGoster ? "has-album" : ""} ${aktif ? "is-current bg-primary/[0.055]" : ""} w-full px-2 sm:px-3 py-2.5 items-center rounded-lg group hover:bg-white/[0.045] transition-colors cursor-pointer`}>

            <span className={`relative h-11 flex items-center justify-center text-xs tabular-nums ${aktif ? "text-primary" : "text-muted-foreground"}`}>
              <input type="checkbox" aria-label={`Select ${t.baslik}`} checked={selected.has(i)} onClick={e=>e.stopPropagation()} onChange={()=>setSelected(old=>{const next=new Set(old);if(next.has(i))next.delete(i);else next.add(i);return next})}/>
              <Play size={14} className="absolute fill-current opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity" />
            </span>

            <div className="flex items-center gap-3 min-w-0">
              {!numarali && <Kapak kaynak={t} boyut={96} className="h-11 w-11 shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className={`truncate text-sm font-medium leading-6 ${aktif ? "text-primary" : "text-foreground"}`}>{t.baslik}</div>
                <div className="flex items-center gap-2 min-w-0 text-xs text-muted-foreground">
                  {t.sanatciId && onSanatci ? (
                    <button onClick={(e) => { e.stopPropagation(); onSanatci(t); }}
                      className="track-text-link min-w-0 truncate text-left hover:underline hover:text-foreground transition-colors">
                      {t.sanatci}
                    </button>
                  ) : <span className="truncate">{t.sanatci}</span>}
                  <span className="hidden sm:inline-flex shrink-0 text-[9px] uppercase tracking-wide leading-4 px-1 rounded border border-white/10 text-muted-foreground/80">{t.kaynak === "kutuphane" ? (t.bicim || "Library") : "Online"}</span>
                </div>
              </div>
            </div>

            {albumGoster && (
              <span className="track-album min-w-0 truncate text-xs text-muted-foreground">
                {t.albumId && onAlbum ? (
                  <button onClick={(e) => { e.stopPropagation(); onAlbum(t); }}
                    className="track-text-link max-w-full truncate text-left hover:underline hover:text-foreground transition-colors">
                    {t.album}
                  </button>
                ) : (t.album || "—")}
              </span>
            )}

            <div className="track-actions flex items-center gap-0.5"><button className="music-row-action min-h-12 min-w-12 grid place-items-center" aria-label="Track details" onClick={e=>{e.stopPropagation();setDetail(t)}}><Info size={16}/></button>
              {onFavori && (
                <button onClick={(e) => { e.stopPropagation(); onFavori(t); }} title={t.favori ? "Remove from Liked Songs" : "Save to Liked Songs"} aria-label={t.favori ? `Remove ${t.baslik} from Liked Songs` : `Save ${t.baslik} to Liked Songs`} aria-pressed={!!t.favori}
                  className={`music-row-action h-11 w-11 shrink-0 grid place-items-center rounded-full hover:bg-white/6 transition-colors ${
                    t.favori ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                  <Heart size={16} className={t.favori ? "fill-current" : ""} />
                </button>
              )}

              {t.kaynak !== "kutuphane" && onArsiv && (
                <button onClick={(e) => { e.stopPropagation(); onArsiv(t); }} disabled={!!durum && !["yok", "error", "basarisiz", "bulunamadi"].includes(durum)}
                  title={durum ? `Library: ${durum}` : "Save to library"}
                  className="music-row-action h-11 w-11 shrink-0 rounded-full grid place-items-center text-muted-foreground hover:text-foreground hover:bg-white/6 transition-colors disabled:opacity-50">
                  {durum && !["indi", "yok", "error", "basarisiz", "bulunamadi"].includes(durum) ? <Loader2 size={16} className="animate-spin" />
                    : durum === "indi" ? <Check size={16} className="text-primary" />
                    : durum === "yok" ? <X size={16} />
                    : <Download size={16} />}
                </button>
              )}

              {(onListeYenile || actions) && <ParcaMenu parca={t} listeler={listeler} onYenile={onListeYenile} />}

              {discovery && <button title="Sound discovery" aria-label={`${t.baslik} sound discovery`} onClick={e=>{e.stopPropagation();discovery.open({parca:t,mode:'instant-mix'});}} className="music-row-action h-11 w-11 shrink-0 grid place-items-center rounded-full text-muted-foreground hover:text-foreground hover:bg-white/6"><AudioLines size={16}/></button>}
              {tasinabilir && onTasi && <DragHandle index={i} count={parcalar.length} label={t.baslik} onMove={(from, to) => onTasi(from, to - from)} />}
              {onCikar && (
                <button onClick={(e) => { e.stopPropagation(); onCikar(i); }} title="Remove from playlist" aria-label={`Remove ${t.baslik} from playlist`}
                  className="music-row-action h-11 w-11 shrink-0 grid place-items-center rounded-full text-muted-foreground hover:bg-white/6 hover:text-destructive transition-colors">
                  <X size={16} />
                </button>
              )}

              <span className="ml-1 text-xs text-muted-foreground tabular-nums min-w-10 text-right">
                {sureBicim(t.sure)}
              </span>
            </div>
          </div>
        );
      })}
      {shown<filtered.length&&<div ref={sentinel} className="flex items-center justify-center gap-3 py-5 text-xs text-muted-foreground"><span>{shown} of {filtered.length} tracks</span><button className="min-h-11 px-4 rounded-full border border-border hover:bg-white/5" onClick={()=>setShown(n=>n+100)}>Show more</button></div>}
      {detail&&<TrackDetails track={detail} onClose={()=>setDetail(null)}/>}
    </div>
  );
}

/* ------------------------------------------------------------------- kart */

let kartNiyet: ReturnType<typeof setTimeout> | undefined;

export function Kart({ parca, onCal, onArsiv, arsivDurum, altYazi }: {
  parca: Parca; onCal: () => void; onArsiv?: () => void;
  arsivDurum?: string; altYazi?: string;
}) {
  return (
    <article onPointerEnter={() => { clearTimeout(kartNiyet); kartNiyet = setTimeout(() => api.prefetchIntent(parca), 250); }} onPointerLeave={() => clearTimeout(kartNiyet)} className="music-card group relative min-w-0 h-full rounded-xl p-2.5 sm:p-3 bg-white/[0.018] hover:bg-white/[0.055] transition-colors">
      <button onClick={onCal} className="w-full text-left rounded-lg">
        <div className="relative mb-3">
          <Kapak kaynak={parca} boyut={360} className="w-full aspect-square shadow-[0_8px_20px_-8px_rgb(0_0_0/0.55)]" />
          <span aria-hidden="true" className="music-card-play absolute bottom-2 right-2 h-11 w-11 rounded-full bg-primary grid place-items-center shadow-lg opacity-100 sm:opacity-0 sm:translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:opacity-100 group-focus-within:translate-y-0 transition-all">
            <Play size={17} className="fill-current text-primary-foreground ml-0.5" />
          </span>
        </div>
        <div className="font-semibold text-sm leading-5 truncate">{parca.baslik}</div>
        <div className="text-xs text-muted-foreground truncate mt-1 leading-5">{altYazi ?? parca.sanatci}</div>
        {parca.gerekce && (
          <div className="text-xs text-muted-foreground/80 mt-2 line-clamp-2 leading-relaxed">{parca.gerekce}</div>
        )}
      </button>
      {onArsiv && (
        <button onClick={onArsiv} disabled={!!arsivDurum && !["yok", "error", "basarisiz", "bulunamadi"].includes(arsivDurum)}
          title="Save to library" aria-label="Save to library"
          className="music-card-archive absolute top-4 right-4 h-11 w-11 rounded-full bg-black/70 backdrop-blur grid place-items-center text-white/80 hover:text-white opacity-100 sm:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity disabled:opacity-100">
          {arsivDurum && !["indi", "yok", "error", "basarisiz", "bulunamadi"].includes(arsivDurum) ? <Loader2 size={16} className="animate-spin" />
            : arsivDurum === "indi" ? <Check size={16} className="text-primary" />
            : arsivDurum === "yok" ? <X size={16} />
            : <Download size={16} />}
        </button>
      )}
    </article>
  );
}

/* -------------------------------------------------------------- sayfa basligi */

export function SayfaHero({ ust, baslik, alt, kapak, yuvarlak, eylemler }: {
  ust?: string; baslik: string; alt?: React.ReactNode;
  kapak: React.ReactNode; yuvarlak?: boolean; eylemler?: React.ReactNode;
}) {
  return (
    <header className="page-hero flex flex-col sm:flex-row items-start sm:items-end gap-5 sm:gap-7 mb-8 sm:mb-10">
      <div className={`page-hero-art w-40 h-40 sm:w-48 sm:h-48 lg:w-56 lg:h-56 shrink-0 shadow-[0_16px_42px_-12px_rgb(0_0_0/0.55)] ${yuvarlak ? "rounded-full overflow-hidden" : "rounded-xl overflow-hidden"}`}>
        {kapak}
      </div>
      <div className="page-hero-copy min-w-0 flex-1">
        {ust && <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground mb-2.5">{ust}</div>}
        <h1 className="text-[clamp(2rem,4.4vw,3.75rem)] leading-[1.08] font-bold tracking-[-0.04em] break-words">{baslik}</h1>
        {alt && <div className="text-sm leading-relaxed text-muted-foreground mt-3">{alt}</div>}
        {eylemler && <div className="flex flex-wrap items-center gap-3 mt-5 sm:mt-6">{eylemler}</div>}
      </div>
    </header>
  );
}
