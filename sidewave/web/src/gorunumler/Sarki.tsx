import { useEffect, useState } from "react";
import { Heart, Loader2, Music2, Play, Radio, Share2 } from "lucide-react";
import { api, sureBicim, type Liste, type Parca } from "../api";
import { Kapak, ParcaMenu } from "../bilesenler/Ortak";
import { useShareTrack } from "../bilesenler/Paylas";

/** A song someone shared: play it, like it, start its radio or add it to a playlist. */
export function SarkiGorunum({ token, onCal, onFavori, onSanatciId, listeler, onListeYenile }: {
  token: string; onCal: (p: Parca, l: Parca[]) => void; onFavori: (p: Parca) => void; onSanatciId: (id: string) => void; listeler: Liste[]; onListeYenile: () => void;
}) {
  const share = useShareTrack();
  const [d, setD] = useState<Awaited<ReturnType<typeof api.sharedTrack>> | null>(null), [error, setError] = useState(""), [radio, setRadio] = useState(false), [, render] = useState(0);
  useEffect(() => { let active = true; api.sharedTrack(token).then(r => { if (active) setD(r); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [token]);
  if (!d) return <div role={error ? "alert" : "status"} className="empty-state">{error ? <><Music2 size={32} /><h2>This song link isn’t available</h2><p>{error}</p></> : <><Loader2 size={28} className="animate-spin" /><h2>Opening song…</h2></>}</div>;
  const p = d.parca;
  async function startRadio() { setRadio(true); try { const r = await api.radyo(p); onCal(p, [p, ...r.parcalar.filter(x => x.id !== p.id)]); } catch (e) { setError((e as Error).message); } finally { setRadio(false); } }
  return <section className="song-page" aria-labelledby="song-title">
    <Kapak kaynak={p} boyut={640} eager className="song-cover" />
    <div className="min-w-0">
      <p className="eyebrow mb-2">{d.sharedBy ? `SHARED BY ${d.sharedBy.toLocaleUpperCase("tr")}` : "SONG"}</p>
      <h1 id="song-title" className="text-[clamp(2rem,5vw,4rem)] font-extrabold tracking-tight leading-[1.05] break-words">{p.baslik}</h1>
      <p className="mt-3 text-muted-foreground">{p.sanatciId ? <button className="font-semibold text-foreground hover:underline" onClick={() => onSanatciId(`${p.kaynak === "youtube" ? "yt:" : ""}${p.sanatciId}`)}>{p.sanatci}</button> : <span className="font-semibold text-foreground">{p.sanatci}</span>}{p.album ? ` · ${p.album}` : ""}{p.sure ? ` · ${sureBicim(p.sure)}` : ""}</p>
      <div className="flex flex-wrap items-center gap-3 mt-7">
        <button onClick={() => onCal(p, [p])} className="min-h-14 px-7 rounded-full bg-primary text-primary-foreground font-semibold inline-flex items-center gap-2 text-base"><Play size={20} className="fill-current" /> Play</button>
        <button onClick={() => { onFavori(p); render(n => n + 1); }} aria-pressed={!!p.favori} aria-label={p.favori ? "Remove from Liked Songs" : "Save to Liked Songs"} className={`h-14 w-14 grid place-items-center rounded-full border border-border hover:bg-white/5 ${p.favori ? "text-primary" : ""}`}><Heart size={22} className={p.favori ? "fill-current" : ""} /></button>
        <button onClick={() => void startRadio()} disabled={radio} className="min-h-14 px-5 rounded-full border border-border font-medium inline-flex items-center gap-2 hover:bg-white/5">{radio ? <Loader2 size={18} className="animate-spin" /> : <Radio size={18} />}Song radio</button>
        <button onClick={() => void share(p)} aria-label="Share" className="h-14 w-14 grid place-items-center rounded-full border border-border hover:bg-white/5"><Share2 size={19} /></button>
        <ParcaMenu parca={p} listeler={listeler} onYenile={onListeYenile} />
      </div>
    </div>
  </section>;
}
