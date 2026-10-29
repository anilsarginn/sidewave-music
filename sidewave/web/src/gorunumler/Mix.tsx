import { useEffect, useState } from "react";
import { Loader2, Play, RefreshCw, Shuffle, Sparkles } from "lucide-react";
import { api, uzunSure, type Liste, type Mix, type Parca } from "../api";
import { Kapak, ParcaTablosu, SayfaHero } from "../bilesenler/Ortak";
import { usePlayerActions } from "../PlayerActions";

/** Daily Mix artwork: the anchor artist's cover on the mix colour, with the mix number. */
export function MixKapak({ mix, className = "" }: { mix: Pick<Mix, "ad" | "renk" | "kapak">; className?: string }) {
  return <div className={`mix-cover ${className}`} style={{"--mix-color": mix.renk} as React.CSSProperties} aria-hidden="true">
    {mix.kapak && <Kapak kaynak={mix.kapak} boyut={300} className="mix-cover-art" />}
    <span className="mix-cover-label">{mix.ad}</span>
  </div>;
}

export function MixGorunum({ id, calan, onCal, onSanatciId, onAlbumId, onFavori, listeler, onListeYenile }: {
  id: string; calan: Parca | null; onCal: (p: Parca, liste: Parca[]) => void; onSanatciId: (id: string) => void; onAlbumId: (id: string) => void;
  onFavori: (p: Parca) => void; listeler: Liste[]; onListeYenile: () => void;
}) {
  const actions = usePlayerActions();
  const [mix, setMix] = useState<(Mix & {parcalar: Parca[]}) | null>(null), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  useEffect(() => { let active = true; setMix(null); setError(""); api.mix(id).then(d => { if (active) setMix(d); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [id, retry]);
  if (!mix) return <div className="surface-panel rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-16 text-center" role={error ? "alert" : "status"}>
    <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-white/[0.04] text-muted-foreground">{error ? <Sparkles size={24} /> : <Loader2 size={24} className="animate-spin" />}</div>
    <h2 className="text-lg font-semibold tracking-tight">{error ? "Could not open this mix" : "Mixing your tracks…"}</h2>
    {error && <><p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{error}</p><button onClick={() => setRetry(n => n + 1)} className="mt-6 min-h-11 rounded-full border border-border px-5 inline-flex items-center gap-2 text-sm hover:bg-white/5"><RefreshCw size={16} /> Try again</button></>}
  </div>;
  const p = mix.parcalar, total = p.reduce((n, t) => n + (t.sure || 0), 0);
  return <>
    <SayfaHero ust="Made for you · Daily mix" baslik={mix.ad} kapak={<MixKapak mix={mix} className="w-full h-full" />}
      alt={<span>{mix.altyazi} · {p.length} tracks{total ? ` · ${uzunSure(total)}` : ""}<br />Updated every day</span>}
      eylemler={p.length ? <>
        <button onClick={() => onCal(p[0], p)} className="min-h-12 px-6 rounded-full bg-primary text-primary-foreground font-semibold inline-flex items-center gap-2 hover:brightness-110"><Play size={18} className="fill-current" /> Play</button>
        <button onClick={() => actions?.shuffleAll(p)} className="min-h-12 px-5 rounded-full border border-border font-medium inline-flex items-center gap-2 hover:bg-white/5"><Shuffle size={17} /> Shuffle</button>
      </> : undefined} />
    <section className="music-section" aria-label="Mix tracks"><ParcaTablosu parcalar={p} calan={calan} onCal={onCal}
      onSanatci={t => t.sanatciId && onSanatciId(`${t.kaynak === "youtube" ? "yt:" : ""}${t.sanatciId}`)}
      onAlbum={t => t.albumId && onAlbumId(`${t.kaynak === "youtube" ? "yt:" : ""}${t.albumId}`)}
      onFavori={onFavori} listeler={listeler} onListeYenile={onListeYenile} /></section>
  </>;
}
