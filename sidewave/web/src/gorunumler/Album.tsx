import { useEffect, useState } from "react";
import { Play, Shuffle, Loader2, Disc3, RefreshCw, Check, Plus } from "lucide-react";
import { api, uzunSure, type AlbumDetay, type Liste, type Parca } from "../api";
import { Kapak, ParcaTablosu, SayfaHero } from "../bilesenler/Ortak";
import { usePlayerActions } from "../PlayerActions";

export function AlbumGorunum({ id, calan, onCal, onSanatciId, onAlbumId, onFavori, listeler, onListeYenile }: {
  id: string; calan: Parca | null; onCal: (p: Parca, liste: Parca[]) => void;
  onSanatciId: (id: string) => void; onAlbumId: (id: string) => void; onFavori: (p: Parca) => void;
  listeler: Liste[]; onListeYenile: () => void;
}) {
  const [a, setA] = useState<AlbumDetay | null>(null);
  const [yuk, setYuk] = useState(true), [hata, setHata] = useState("");
  const [retry, setRetry] = useState(0);
  const [kayitYuk, setKayitYuk] = useState(false), [kayitHata, setKayitHata] = useState("");
  const actions = usePlayerActions();
  useEffect(() => { setKayitHata(""); }, [id]);
  useEffect(() => {
    let active = true; setYuk(true); setHata(""); setA(null);
    (id.startsWith("yt:") ? api.ytAlbum(id.slice(3)) : api.album(id))
      .then(value => { if (active) setA(value); }).catch(e => { if (active) setHata(e.message); })
      .finally(() => { if (active) setYuk(false); });
    return () => { active = false; };
  }, [id, retry]);
  if (yuk || !a) return <div className="surface-panel rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-16 text-center" role={yuk ? "status" : "alert"}>
    <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-white/[0.04] text-muted-foreground">{yuk ? <Loader2 size={24} className="animate-spin" /> : <Disc3 size={26} />}</div>
    <h2 className="text-lg font-semibold tracking-tight">{yuk ? "Opening album…" : "Could not open this album"}</h2>
    {!yuk && <><p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{hata || "Album information is unavailable right now."}</p><button onClick={() => setRetry(value => value + 1)} className="mt-6 min-h-11 rounded-full border border-border px-5 inline-flex items-center gap-2 text-sm hover:bg-white/5"><RefreshCw size={16} /> Try again</button></>}
  </div>;
  const kaydet = async () => { if(!a.appId || kayitYuk)return; setKayitYuk(true); setKayitHata(""); try { const r=await api.albumKaydet(a.appId,!a.kayitli); setA(previous => previous && previous.appId === r.appId ? {...previous,kayitli:r.kayitli} : previous); onListeYenile(); } catch(e) {setKayitHata((e as Error).message);} finally {setKayitYuk(false);} };
  const p = a.parcalar || [], total = a.toplamSure || p.reduce((sum, track) => sum + (track.sure || 0), 0);
  const karistirCal = () => actions?.shuffleAll(p);
  return <>
    <SayfaHero ust="Album" baslik={a.ad}
      kapak={<Kapak kaynak={{ kapakId: a.kapakId, kapak: a.kapak }} boyut={512} eager className="w-full h-full" />}
      alt={<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {a.sanatci && <>{a.sanatciId ? <button onClick={() => onSanatciId(`${id.startsWith("yt:") ? "yt:" : ""}${a.sanatciId!}`)} className="min-h-11 font-medium text-foreground hover:underline underline-offset-4">{a.sanatci}</button> : <span className="font-medium text-foreground">{a.sanatci}</span>}<span aria-hidden="true">·</span></>}
        {a.yil && <><span>{a.yil}</span><span aria-hidden="true">·</span></>}
        <span>{a.parcaSayisi ?? p.length} tracks</span>{total > 0 && <><span aria-hidden="true">·</span><span>{uzunSure(total)}</span></>}
      </div>}
      eylemler={<>
        <button onClick={() => p.length && onCal(p[0], p)} disabled={!p.length} className="min-h-12 px-6 rounded-full bg-primary text-primary-foreground font-semibold inline-flex items-center justify-center gap-2 hover:brightness-110 transition disabled:opacity-40"><Play size={18} className="fill-current" /> Play all</button>
        <button onClick={karistirCal} disabled={!p.length} className="min-h-12 px-5 rounded-full border border-border font-medium inline-flex items-center justify-center gap-2 hover:bg-white/5 transition-colors disabled:opacity-40"><Shuffle size={17} /> Shuffle</button>
        <button onClick={kaydet} disabled={!a.appId || kayitYuk} aria-pressed={!!a.kayitli} className={`button-secondary min-h-12 inline-flex items-center gap-2 ${a.kayitli ? "text-primary" : ""}`}>{kayitYuk ? <Loader2 size={17} className="animate-spin" /> : a.kayitli ? <Check size={17} /> : <Plus size={17} />}{a.kayitli ? "In your library" : "Save album"}</button>
      </>} />
    {(kayitHata || a.warning) && <p role="status" className="notice mb-5">{kayitHata || a.warning}</p>}
    {p.length ? <section className="music-section" aria-label="Album tracks"><ParcaTablosu parcalar={p} calan={calan} onCal={onCal} numarali albumGoster={false}
      onSanatci={t => t.sanatciId && onSanatciId(`${t.kaynak === "youtube" ? "yt:" : ""}${t.sanatciId}`)}
      onAlbum={t => t.albumId && onAlbumId(`${t.kaynak === "youtube" ? "yt:" : ""}${t.albumId}`)}
      onFavori={onFavori} listeler={listeler} onListeYenile={onListeYenile} /></section> :
      <div className="surface-panel rounded-2xl border border-white/[0.06] bg-white/[0.02] p-10 text-center"><Disc3 className="mx-auto mb-4 text-muted-foreground" size={28} /><h2 className="font-semibold">No tracks here yet</h2><p className="mt-2 text-sm text-muted-foreground">Tracks will appear when they become available.</p></div>}
  </>;
}
