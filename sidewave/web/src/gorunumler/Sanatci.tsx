import {useDiscovery} from "../DiscoveryContext";
import { useEffect, useState } from "react";
import { Play, Loader2, Mic2, RefreshCw, ArrowUpRight, Shuffle, Check, Plus, Link, Radio } from "lucide-react";
import { api, type Liste, type Parca, type SanatciDetay } from "../api";
import { Kapak, ParcaTablosu, SayfaHero } from "../bilesenler/Ortak";

import { usePlayerActions } from "../PlayerActions";

export function SanatciGorunum({ id, kaynak, calan, onCal, onAlbumId, onSanatciId, onFavori, onArsiv, arsivDurum, listeler, onListeYenile }: {
  id: string; kaynak: "kutuphane" | "youtube"; calan: Parca | null;
  onCal: (p: Parca, liste: Parca[]) => void; onAlbumId: (id: string) => void; onSanatciId: (id: string) => void;
  onFavori: (p: Parca) => void; onArsiv: (p: Parca) => void; arsivDurum: Record<string, string>;
  listeler: Liste[]; onListeYenile: () => void;
}) {
  const discovery=useDiscovery();
  const [s, setS] = useState<SanatciDetay | null>(null);
  const [yuk, setYuk] = useState(true), [hata, setHata] = useState("");
  const [retry, setRetry] = useState(0);
  const [tumParcalar,setTumParcalar] = useState(false);
  const [diskografiYuk, setDiskografiYuk] = useState(false);
  const [islem, setIslem] = useState(false), [islemHata, setIslemHata] = useState("");
  const [filtre, setFiltre] = useState<"all" | "album" | "single">("all");
  const [sira, setSira] = useState("newest"), [limit, setLimit] = useState(24);
  useEffect(() => { setTumParcalar(false); setFiltre("all"); setSira("newest"); setLimit(24); setIslemHata(""); }, [id, kaynak]);
  useEffect(() => { setLimit(24); }, [filtre, sira]);
  useEffect(() => {
    let active = true; setYuk(true); setHata(""); setS(null);
    const istek = kaynak === "youtube" ? api.ytSanatci(id) : api.sanatci(id);
    istek.then(value => { if (active) setS(value); }).catch(e => { if (active) setHata(e.message); })
      .finally(() => { if (active) setYuk(false); });
    return () => { active = false; };
  }, [id, kaynak, retry]);
  if (yuk || !s) return <div className="surface-panel rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-16 text-center" role={yuk ? "status" : "alert"}>
    <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-white/[0.04] text-muted-foreground">{yuk ? <Loader2 size={24} className="animate-spin" /> : <Mic2 size={25} />}</div>
    <h2 className="text-lg font-semibold tracking-tight">{yuk ? "Opening artist…" : "Could not open this artist"}</h2>
    {!yuk && <><p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{hata || "Artist information is unavailable right now."}</p><button onClick={() => setRetry(value => value + 1)} className="mt-6 min-h-11 rounded-full border border-border px-5 inline-flex items-center gap-2 text-sm hover:bg-white/5"><RefreshCw size={16} /> Try again</button></>}
  </div>;
  const parcalar = tumParcalar ? s.parcalar || s.enCokDinlenen || [] : s.enCokDinlenen || [];
  const yayimlar = (s.albumler || []).filter(a => filtre === "all" || a.tur === filtre).sort((a,b) => sira === "name" ? a.ad.localeCompare(b.ad,"tr") : sira === "oldest" ? (Number(a.yil)||0)-(Number(b.yil)||0) : (Number(b.yil)||0)-(Number(a.yil)||0));
  const diskografiGetir = async () => {
    if(!s.appId || diskografiYuk) return; setDiskografiYuk(true); setIslemHata("");
    const currentId=s.appId, type=filtre;
    try {
      let page=await api.sanatciYayimlari(currentId,type,0,true); const albums=[...page.items];
      while(page.nextOffset!=null) {page=await api.sanatciYayimlari(currentId,type,page.nextOffset);albums.push(...page.items);}
      setS(previous => previous && previous.appId === currentId ? {...previous,albumler:[...previous.albumler.filter(a=>type!=="all" && a.tur!==type),...albums],diskografiTam:type==="all"?page.complete:previous.diskografiTam} : previous);
    }catch(e) {setIslemHata((e as Error).message);} finally {setDiskografiYuk(false);}
  };
  const takipEt = async () => {
    if (!s.appId || islem) return; setIslem(true); setIslemHata("");
    try { const r = await api.sanatciTakip(s.appId, !s.takip); setS(previous => previous && previous.appId === r.appId ? {...previous,takip:r.takip} : previous); onListeYenile(); }
    catch(e) { setIslemHata((e as Error).message); } finally { setIslem(false); }
  };
  const actions = usePlayerActions();
  const karistir = () => actions?.shuffleAll(parcalar);
  const radyo = async () => { if(!parcalar.length || islem) return; setIslem(true); setIslemHata(""); try { const r=await api.radyo(parcalar[0]); if(r.parcalar.length)onCal(r.parcalar[0],r.parcalar); else setIslemHata("No radio was found for this artist."); } catch(e) {setIslemHata((e as Error).message);} finally {setIslem(false);} };

  return <>
    <SayfaHero ust="Artist" baslik={s.ad} yuvarlak
      kapak={<Kapak kaynak={{ kapakId: s.kapakId, gorselUrl: s.gorselUrl } as any} boyut={512} yuvarlak className="w-full h-full" />}
      alt={<div className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {s.abone && <span>{s.abone} subscribers</span>}
          {!!s.albumler?.length && <>{s.abone && <span aria-hidden="true">·</span>}<span>{s.albumler.length} {kaynak === "youtube" ? "releases" : "albums"}</span></>}
        </div>
        {s.biyografi && <details className="text-sm max-w-2xl leading-relaxed"><summary className="cursor-pointer min-h-11 flex items-center font-medium">About the artist</summary><p className="text-muted-foreground whitespace-pre-line">{s.biyografi}</p></details>}
      </div>}
      eylemler={<>
        <button onClick={() => parcalar.length && onCal(parcalar[0], parcalar)} disabled={!parcalar.length} className="button-primary min-h-12 inline-flex items-center gap-2 disabled:opacity-40"><Play size={18} className="fill-current" /> Play</button>
        <button onClick={karistir} disabled={!parcalar.length} className="button-secondary min-h-12 inline-flex items-center gap-2 disabled:opacity-40"><Shuffle size={17} /> Shuffle</button>
        <button onClick={takipEt} disabled={!s.appId || islem} aria-pressed={!!s.takip} className={`button-secondary min-h-12 inline-flex items-center gap-2 ${s.takip ? "text-primary" : ""}`}>{islem ? <Loader2 size={17} className="animate-spin" /> : s.takip ? <Check size={17} /> : <Plus size={17} />}{s.takip ? "Following" : "Follow"}</button>
        {kaynak==='kutuphane' && s.appId && <button onClick={()=>discovery?.open({artistId:s.appId,mode:'artists'})} className="button-secondary min-h-12">Artists with a similar sound</button>}
        <button onClick={radyo} disabled={!parcalar.length || islem} className="button-secondary min-h-12 inline-flex items-center gap-2 disabled:opacity-40"><Radio size={17} /> Radio</button>
        <button onClick={async () => { try { await navigator.clipboard.writeText(window.location.href); setIslemHata("Artist link copied."); } catch { setIslemHata("Copy the address from your browser to share this artist."); } }} className="button-secondary min-h-12 inline-flex items-center gap-2"><Link size={17} /> Share</button>
      </>} />
    {(s.warning || s.catalogWarning || islemHata) && <p role="status" className="notice mt-4">{islemHata || s.warning || s.catalogWarning}</p>}
    {parcalar.length > 0 && <section className="music-section mt-8">
      <div className="section-heading mb-5 flex items-end justify-between gap-4"><h2 className="text-xl sm:text-2xl font-semibold tracking-tight">{tumParcalar ? "All tracks" : s.parcaBasligi || (kaynak === "youtube" ? "Popular tracks" : "From your library")}</h2><span className="shrink-0 text-xs text-muted-foreground">{parcalar.length} tracks</span></div>
      {!!s.parcalar?.length && s.parcalar.length>(s.enCokDinlenen?.length||0) && <button onClick={()=>setTumParcalar(!tumParcalar)} aria-pressed={tumParcalar} className="filter-chip mb-4">{tumParcalar ? "Show highlights" : `All tracks (${s.parcalar.length})`}</button>}
      <ParcaTablosu parcalar={parcalar} calan={calan} onCal={onCal}
        onSanatci={t => t.sanatciId && onSanatciId(`${t.kaynak === "youtube" ? "yt:" : ""}${t.sanatciId}`)}
        onAlbum={t => t.albumId && onAlbumId(`${t.kaynak === "youtube" ? "yt:" : ""}${t.albumId}`)}
        onFavori={onFavori} onArsiv={onArsiv} arsivDurum={arsivDurum} listeler={listeler} onListeYenile={onListeYenile} />
    </section>}
    {!!s.albumler?.length && <section className="music-section mt-10 sm:mt-12">
      <div className="section-heading mb-5 flex items-end justify-between gap-4"><h2 className="text-xl sm:text-2xl font-semibold tracking-tight">{kaynak === "youtube" ? "Albums & singles" : "Albums"}</h2><span className="shrink-0 text-xs text-muted-foreground">{s.albumler.length} {kaynak === "youtube" ? "releases" : "albums"}</span></div>
      <div className="flex flex-wrap items-center gap-2 mb-5" aria-label="Discography filters">
        {([["all","All"],["album","Albums"],["single","Single / EP"]] as const).map(([value,label]) => <button key={value} aria-pressed={filtre === value} onClick={() => setFiltre(value)} className={`filter-chip ${filtre === value ? "is-selected" : ""}`}>{label}</button>)}
        <select aria-label="Sort releases" value={sira} onChange={e => setSira(e.target.value)} className="form-select min-h-11 ml-auto text-xs"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name">By name</option></select>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 sm:gap-4">
        {yayimlar.slice(0,limit).map(al => <button key={al.id} onClick={() => onAlbumId(`${kaynak === "youtube" ? "yt:" : ""}${al.id}`)} className="group min-w-0 text-left rounded-2xl border border-transparent p-2.5 sm:p-3 transition-colors hover:border-white/[0.06] hover:bg-white/[0.04]">
          <div className="relative mb-3 overflow-hidden rounded-xl"><Kapak kaynak={{ kapakId: kaynak === "kutuphane" ? al.id : undefined, kapak: al.kapak }} boyut={300} className="w-full aspect-square shadow-lg" />
            <span aria-hidden="true" className="absolute bottom-2 right-2 grid size-9 place-items-center rounded-full bg-background/90 text-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"><ArrowUpRight size={18} /></span></div>
          <div className="font-medium text-sm truncate leading-5">{al.ad}</div>
          <div className="text-xs text-muted-foreground truncate mt-1 leading-5">{[al.yil, al.tur === "single" ? "Single / EP" : al.parcaSayisi ? `${al.parcaSayisi} tracks` : "Album"].filter(Boolean).join(" · ")}</div>
        </button>)}
      </div>
      {!yayimlar.length && <p className="text-sm text-muted-foreground py-8">No releases in this category.</p>}
      {yayimlar.length > limit && <button className="button-secondary mt-6" onClick={() => setLimit(n => n+24)}>Show more ({yayimlar.length-limit})</button>}
      {kaynak === "youtube" && !s.diskografiTam && <button onClick={diskografiGetir} disabled={diskografiYuk || !s.appId} className="button-secondary mt-6 inline-flex items-center gap-2">{diskografiYuk && <Loader2 size={16} className="animate-spin" />}{diskografiYuk ? "Loading releases…" : "Load more releases"}</button>}
      {kaynak === "youtube" && !s.diskografiTam && <p className="text-xs leading-relaxed text-muted-foreground mt-6">Showing available releases. Some regional or channel-specific recordings may be missing.</p>}
    </section>}
    {!s.albumler?.length && !parcalar.length && <div className="surface-panel rounded-2xl border border-white/[0.06] bg-white/[0.02] p-10 text-center"><Mic2 className="mx-auto mb-4 text-muted-foreground" size={28} /><h2 className="font-semibold">Nothing here yet</h2><p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">This artist’s albums and tracks will appear when they become available.</p></div>}
    {!!s.benzer?.length && <section className="music-section mt-10 sm:mt-12">
      <h2 className="section-heading text-xl sm:text-2xl font-semibold tracking-tight mb-5">Similar artists</h2>
      <div className="flex flex-wrap gap-2.5">{s.benzer.map(b => <button key={b.id} onClick={() => onSanatciId(`${kaynak === "youtube" ? "yt:" : ""}${b.id}`)} className="min-h-11 px-5 rounded-full border border-border bg-white/[0.02] text-sm inline-flex items-center gap-2 hover:bg-white/[0.06] transition-colors">{b.ad}<ArrowUpRight size={14} className="text-muted-foreground" /></button>)}</div>
    </section>}
  </>;
}
