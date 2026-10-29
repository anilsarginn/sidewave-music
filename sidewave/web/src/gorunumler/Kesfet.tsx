import { useEffect, useState } from "react";
import { Play, ArrowUpRight, ListMusic, Loader2, X } from "lucide-react";
import { api, type Album, type Liste, type Mix, type Parca, type TrendSanatci } from "../api";
import { Kapak, Kart, ListeKapagi, ParcaTablosu } from "../bilesenler/Ortak";
import { MixKapak } from "./Mix";

import { HomeIntroduction } from "../bilesenler/HomeIntro";
import { usePlayerActions } from "../PlayerActions";

const REMINDER_KEY = "sidewave-import-reminder";
function ImportReminder({count, onReview, onDismiss}: {count: number; onReview: () => void; onDismiss: () => void}) {
  return <aside className="import-reminder" aria-label="Spotify import">
    <div className="import-reminder-icon" aria-hidden="true"><ListMusic size={20} /></div>
    <div className="min-w-0 flex-1"><p className="font-semibold text-sm">{count} songs from your Spotify import need a match</p><p className="text-xs text-muted-foreground mt-1">Choose the right recording and they’ll join your playlists.</p></div>
    <button className="button-primary text-sm" onClick={onReview}>Review</button>
    <button className="utility-button text-muted-foreground" aria-label="Dismiss reminder" onClick={onDismiss}><X size={16} /></button>
  </aside>;
}

export function KesfetGorunum({
  calan, onCal, onAlbumId, onSanatciId, onYtSanatci, onFavori, onArsiv,
  arsivDurum, listeler, onListeYenile, onReviewImport, onMix,
}: {
  onReviewImport?: (jobId: string) => void;
  onMix?: (id: string) => void;
  calan: Parca | null;
  onCal: (p: Parca, liste: Parca[]) => void;
  onAlbumId: (id: string) => void;
  onSanatciId: (id: string) => void;
  onYtSanatci: (browseId: string) => void;
  onFavori: (p: Parca) => void;
  onArsiv: (p: Parca) => void;
  arsivDurum: Record<string, string>;
  listeler: Liste[];
  onListeYenile: () => void;
}) {
  const actions = usePlayerActions(), owner = !!actions?.owner, dismiss = actions?.dismiss;
  // A finished Spotify import can leave songs that need a manual match; remind until reviewed or dismissed.
  const [importReview, setImportReview] = useState<{id: string; count: number} | null>(null);
  useEffect(() => {
    if (!onReviewImport) return;
    let active = true;
    api.spotifyJobs().then(r => {
      const job = r.jobs.find(j => j.state === "committed" && (j.counts.ambiguous || 0) > 0);
      let dismissed = ""; try { dismissed = localStorage.getItem(REMINDER_KEY) || ""; } catch { /* Optional. */ }
      if (active && job && dismissed !== job.id + ":" + job.counts.ambiguous) setImportReview({id: job.id, count: job.counts.ambiguous || 0});
    }).catch(() => { /* The reminder is optional. */ });
    return () => { active = false; };
  }, [onReviewImport]);
  const [mixes,setMixes]=useState<Mix[]>([]);
  useEffect(()=>{let active=true;api.mixes().then(d=>{if(active)setMixes(d.mixes||[])}).catch(()=>{/* Mixes appear once there is listening history. */});return()=>{active=false};},[]);
  const [rediscover,setRediscover]=useState<Parca[]>([]);
  const [homeState,setHomeState]=useState("");
  const [takipYayimlari,setTakipYayimlari] = useState<Album[]>([]);
  const [takipHata,setTakipHata] = useState("");
  const [albumler, setAlbumler] = useState<Album[]>([]);
  const [trendSanatcilar, setTrendSanatcilar] = useState<TrendSanatci[]>([]);
  const [trendParcalar, setTrendParcalar] = useState<Parca[]>([]);
  const [oneriler, setOneriler] = useState<Parca[]>([]);
  const [oneriYuk, setOneriYuk] = useState(true);
  const [gecmisYuk, setGecmisYuk] = useState(true);
  const [gecmis, setGecmis] = useState<Parca[]>([]);
  const [hata, setHata] = useState("");
  const [oneriHata, setOneriHata] = useState("");
  const [calinanListe, setCalinanListe] = useState<string | null>(null);
  useEffect(() => {
    api.takipYayimlari().then(d=>{setTakipYayimlari(d.items||[]);setTakipHata(d.warning||"");}).catch(e=>setTakipHata(e.message));
    api.kesfet().then((d) => {
      setAlbumler(d.albumler || []);
      setTrendSanatcilar(d.trendSanatcilar || []);
      setTrendParcalar((d.trendParcalar || []).map((p) => ({ ...p, kaynak: "youtube" as const })));
    }).catch(e => setHata(e.message));
    api.gecmis().then(d => setGecmis(d.parcalar)).catch(e => setHata(e.message)).finally(() => setGecmisYuk(false));
  }, []);

  const playlistVersion=listeler.map(l=>l.id+':'+l.parcaSayisi).join('|');
  useEffect(()=>{
    let active=true;
    api.home().then(async d=>{
      if(!active)return;
      if(Array.isArray(d.sections?.rediscover?.data))setRediscover(d.sections.rediscover.data as Parca[]);
      if(d.sections?.forYou?.state==='stale')setHomeState("Showing your last available personal mix.");
      if(Array.isArray(d.sections?.forYou?.data))setOneriler(d.sections.forYou.data as Parca[]);
      else if(d.sections?.forYou?.state==='error')setOneriHata(d.sections.forYou.message||"Your mix could not be loaded.");
      else setOneriler((await api.oneriler()).parcalar||[]);
    }).catch(e=>{if(active)setOneriHata(e.message);}).finally(()=>{if(active)setOneriYuk(false);});
    return()=>{active=false;};
  },[playlistVersion]);

  async function listeCal(liste: Liste) {
    setCalinanListe(liste.id);
    try {
      const d = await api.liste(liste.id);
      if (d.parcalar.length) onCal(d.parcalar[0], d.parcalar);
      else setHata("This playlist is empty. Add a song to get started.");
    } catch (e) { setHata((e as Error).message); }
    finally { setCalinanListe(null); }
  }

  return (
    <div className="music-home">
      <HomeIntroduction />
      {importReview && <ImportReminder count={importReview.count} onReview={() => onReviewImport?.(importReview.id)} onDismiss={() => { try { localStorage.setItem(REMINDER_KEY, importReview.id + ":" + importReview.count); } catch { /* Optional. */ } setImportReview(null); }} />}

      {homeState&&<p role="status" className="text-sm text-muted-foreground mb-4">{homeState}</p>}
      {hata && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-destructive text-sm mb-6">Some sections could not be loaded: {hata}</p>}

      {(gecmisYuk || gecmis.length > 0) && <section className="music-section mb-8 sm:mb-10">
        <div className="section-heading flex items-center justify-between gap-4 mb-3"><h2 className="text-xl font-semibold tracking-tight">Recently played</h2><span className="hidden sm:block text-xs text-muted-foreground">Play it again</span></div>
        {gecmisYuk ? <div role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" />Loading your history…</div>
          : <div className="home-recent-grid grid sm:grid-cols-3 xl:grid-cols-6 gap-2 sm:gap-3">{gecmis.slice(0, 6).map(p => <Kart key={`${p.kaynak}:${p.id}`} parca={p} onCal={() => onCal(p, gecmis)} />)}</div>}
      </section>}

      {mixes.length > 0 && <section className="music-section mb-8 sm:mb-10" aria-labelledby="daily-mixes-title">
        <div className="section-heading mb-3"><h2 id="daily-mixes-title" className="text-xl font-semibold tracking-tight">Your daily mixes</h2><p className="text-xs text-muted-foreground mt-1">Built around the artists you return to. New every day.</p></div>
        <div className="mix-row">{mixes.map(m => <button key={m.id} onClick={() => onMix?.(m.id)} className="mix-card text-left"><MixKapak mix={m} className="w-full aspect-square mb-3" /><span className="block text-xs text-muted-foreground line-clamp-2 leading-5">{m.altyazi}</span></button>)}</div>
      </section>}

      {listeler.length > 0 && <section className="music-section mb-8 sm:mb-10">
        <div className="section-heading mb-3"><h2 className="text-xl font-semibold tracking-tight">Your playlists</h2></div>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5">
          {listeler.slice(0, 8).map(l => <button key={l.id} onClick={() => void listeCal(l)} disabled={calinanListe !== null} aria-busy={calinanListe === l.id}
            className="home-playlist group flex items-center gap-3 min-w-0 rounded-xl border border-border/60 bg-white/[0.025] hover:bg-white/[0.06] p-3 text-left transition-colors disabled:opacity-60">
            <span aria-hidden="true" className="relative h-11 w-11 shrink-0 rounded-lg overflow-hidden">{calinanListe === l.id ? <span className="absolute inset-0 grid place-items-center bg-black/50"><Loader2 size={20} className="animate-spin" /></span> : null}<ListeKapagi liste={l} boyut={96} className="w-full h-full" /></span>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{l.ad}</span><span className="block text-[11px] text-muted-foreground mt-1">{l.parcaSayisi || 0} tracks · Play</span></span>
            <Play aria-hidden="true" size={15} className="hidden sm:block shrink-0 fill-current text-foreground/50 group-hover:text-primary transition-colors" />
          </button>)}
        </div>
      </section>}

      {takipYayimlari.length>0 && <section className="music-section mb-8 sm:mb-10"><div className="section-heading mb-4"><h2 className="text-xl font-semibold tracking-tight">From artists you follow</h2><p className="text-xs text-muted-foreground mt-1">New releases from artists you follow</p></div>{takipHata&&<p role="status" className="text-xs text-muted-foreground mb-3">{takipHata}</p>}<div className="search-card-grid">{takipYayimlari.slice(0,12).map(a=><button key={a.appId||a.id} onClick={()=>onAlbumId(`${a.kaynak==='youtube'?'yt:':''}${a.id}`)} className="search-result-card text-left"><Kapak kaynak={a} boyut={240} className="w-full aspect-square mb-3"/><span className="block font-semibold text-sm truncate">{a.ad}</span><span className="block text-xs text-muted-foreground truncate mt-1">{[a.sanatci,a.yil].filter(Boolean).join(' · ')}</span></button>)}</div></section>}
      {albumler.length > 0 && <section className="music-section mb-8 sm:mb-10">
        <div className="section-heading mb-3"><h2 className="text-xl font-semibold tracking-tight">From your library</h2><p className="text-xs text-muted-foreground mt-1">Albums from your collection</p></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
          {albumler.slice(0, 6).map(a => <button key={a.id} onClick={() => onAlbumId(a.id)} className="group flex items-center gap-3 min-w-0 rounded-xl border border-border/50 bg-white/[0.02] hover:bg-white/[0.055] p-2 text-left transition-colors">
            <Kapak kaynak={{kapakId: a.id}} boyut={160} className="h-16 w-16 shrink-0" />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{a.ad}</span><span className="block truncate text-xs text-muted-foreground mt-1">{a.sanatci || "Album"}</span></span>
            <ArrowUpRight aria-hidden="true" size={17} className="shrink-0 mr-2 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity" />
          </button>)}
        </div>
      </section>}

      {rediscover.length>0&&<section className="music-section mb-8"><h2 className="text-xl font-semibold mb-3">Rediscover</h2><div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">{rediscover.slice(0,12).map(p=><Kart key={p.appId||p.id} parca={p} onCal={()=>onCal(p,rediscover)}/>)}</div></section>}
      <section id="oneriler" className="music-section mb-8 sm:mb-10">
        <div className="section-heading mb-3"><h2 className="text-xl font-semibold tracking-tight">Made for you</h2><p className="text-xs text-muted-foreground mt-1">Inspired by your likes. Filled with fresh finds.</p></div>
        {oneriYuk ? <div role="status" className="flex items-center gap-3 text-muted-foreground py-8 text-sm"><Loader2 size={16} className="animate-spin" />Finding your next favorites…</div>
          : oneriHata ? <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 text-destructive text-sm p-4">{oneriHata}</p>
          : oneriler.length === 0 ? <div className="rounded-xl border border-dashed border-border px-5 py-7"><p className="font-medium text-sm">Let’s find your sound.</p><p className="text-muted-foreground mt-1 text-sm">Listen and like a few songs. Your recommendations will grow with you.</p></div>
          : <div className="home-recommendation-grid grid sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 sm:gap-3">
            {oneriler.map(p => <div key={`${p.kaynak}:${p.id}`} className="min-w-0 flex flex-col">
              <Kart parca={p} onCal={() => onCal(p, oneriler)} onArsiv={owner && p.kaynak === "youtube" ? () => onArsiv(p) : undefined} arsivDurum={arsivDurum[p.id]} />
              {p.reason&&<p className="px-3 pt-2 text-xs text-muted-foreground">{p.reason}</p>}
              <button className="min-h-11 px-3 text-left text-[11px] text-muted-foreground/75 hover:text-foreground rounded-lg transition-colors" onClick={async () => { if (await dismiss?.(p)) setOneriler(all => all.filter(x => x.id !== p.id)); }}>Not for me</button>
            </div>)}
          </div>}
      </section>

      {trendSanatcilar.length > 0 && <section className="music-section mb-8 sm:mb-10 pt-5 border-t border-border/60">
        <div className="section-heading mb-5"><h2 className="text-xl font-semibold tracking-tight">Trending in Türkiye</h2><p className="text-xs text-muted-foreground mt-1">Artists making waves this week</p></div>
        <div className="grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-6 gap-x-4 gap-y-6">
          {trendSanatcilar.map(a => <button key={a.ad} onClick={() => a.browseId && onYtSanatci(a.browseId)} disabled={!a.browseId} className="group min-w-0 text-center rounded-xl disabled:cursor-default">
            <Kapak kaynak={{kapak: a.kapak}} boyut={240} yuvarlak className="w-full aspect-square max-w-36 mx-auto transition-transform group-hover:scale-[1.025]" />
            <span className="block font-medium text-xs sm:text-sm truncate mt-3">{a.ad}</span>
            <span className="block text-[11px] text-muted-foreground truncate mt-1">{a.sira ? `#${a.sira} · ` : ""}{a.abone || "Artist"}</span>
          </button>)}
        </div>
      </section>}

      {trendParcalar.length > 0 && <section className="music-section mb-8 sm:mb-10">
        <div className="section-heading mb-4"><h2 className="text-xl font-semibold tracking-tight">On repeat this week</h2></div>
        <ParcaTablosu parcalar={trendParcalar} calan={calan} onCal={onCal}
          onSanatci={(t) => t.sanatciId && onSanatciId(`${t.kaynak === "youtube" ? "yt:" : ""}${t.sanatciId}`)}
          onAlbum={(t) => t.albumId && onAlbumId(`${t.kaynak === "youtube" ? "yt:" : ""}${t.albumId}`)}
          onFavori={onFavori} onArsiv={onArsiv} arsivDurum={arsivDurum} listeler={listeler} onListeYenile={onListeYenile} />
      </section>}

      <footer className="mt-12 pt-6 border-t border-border/60 text-[11px] text-muted-foreground/70 flex flex-wrap justify-between gap-2"><span>Sidewave</span><span>SARGIN LABS</span></footer>
    </div>
  );
}
