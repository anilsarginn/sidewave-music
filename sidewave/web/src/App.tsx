import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Home, Search, Library, Heart, Play, Pause, SkipBack, SkipForward,
  Shuffle, Repeat, Repeat1, ListMusic, Download, Loader2, X,
  ChevronLeft, ChevronRight, MonitorSmartphone, Maximize2, Radio, AlertCircle, AudioLines, Keyboard, Sparkles,
} from "lucide-react";
import { api, sureBicim, type ArchiveJob, type Indirme, type Liste, type Parca } from "./api";
import { AppearanceSettings, useAppearance } from "./bilesenler/Appearance";
import { AccountButton, useMember } from "./bilesenler/Membership";
import { useToast } from "./bilesenler/Toast";
import { PlayerActionsContext } from "./PlayerActions";
import { NowPlayingView } from "./gorunumler/NowPlaying";
import { CollectionsView } from "./gorunumler/Collections";
import { SidebarCollection } from "./bilesenler/SidebarCollection";
import { useCalar, useProgress, type Calar } from "./useCalar";
import { DragHandle, IconBtn, Kapak, ParcaTablosu, Slider, VolumeButton } from "./bilesenler/Ortak";
import { KesfetGorunum } from "./gorunumler/Kesfet";
import { AlbumGorunum } from "./gorunumler/Album";
import { SanatciGorunum } from "./gorunumler/Sanatci";
import { FavorilerGorunum, CalmaListesiGorunum } from "./gorunumler/Listeler";
import { KutuphaneGorunum } from "./gorunumler/Kutuphane";
import { GozatGorunum } from "./gorunumler/Gozat";
import { MixGorunum } from "./gorunumler/Mix";
import { PaylasilanGorunum } from "./gorunumler/Paylasilan";
import { IstatistikGorunum } from "./gorunumler/Istatistik";
import { SarkiGorunum } from "./gorunumler/Sarki";

/* --------------------------------------------------------------- gezinme */

import { DiscoveryContext,type DiscoveryTarget } from "./DiscoveryContext";
import { parseView, viewUrl, type Gorunum } from "./navigation";

const aramaAnahtari = (text: string) => text.normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "").replace(/ı/g, "i").replace(/[^\p{L}\p{N}]/gu, "");

// Dialogs that most sessions never open load on demand.
const ImportDialog = lazy(() => import("./gorunumler/Import").then(m => ({default: m.ImportDialog})));
const DiscoveryPanel = lazy(() => import("./gorunumler/Discovery").then(m => ({default: m.DiscoveryPanel})));
const RECENT_KEY = "sidewave-recent-searches";

export default function App() {
  const calar = useCalar();
  const owner = !!useMember()?.user.owner;
  const toast = useToast();
  const [kisayollar, setKisayollar] = useState(false);
  const scrollPositions = useRef(new Map<number, number>());
  const searchTabs = useRef(new Map<number, "tumu" | "parcalar" | "albumler" | "sanatcilar">());
  const restoring = useRef(false);
  const aramaOnbellek = useRef(new Map<string, {at: number; data: Awaited<ReturnType<typeof api.ara>>}>());
  const appearance = useAppearance();
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [searchFocused,setSearchFocused]=useState(false);
  const [recentQueries,setRecentQueries]=useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem(RECENT_KEY)||"[]")}catch{return []}});
  // Only deliberate searches are remembered: Enter, or opening/playing a result.
  const sonAramalariKaydet = useCallback((next: string[]) => { setRecentQueries(next); try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* Optional convenience. */ } }, []);
  const aramayiHatirla = useCallback((q: string) => { q = q.trim(); if (q.length < 2) return; setRecentQueries(old => { const next = [q, ...old.filter(x => x.toLocaleLowerCase("tr") !== q.toLocaleLowerCase("tr"))].slice(0, 8); try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* Optional convenience. */ } return next; }); }, []);
  const [discovery,setDiscovery] = useState<DiscoveryTarget|null>(null);

  const [gecmis, setGecmis] = useState<Gorunum[]>([parseView(window.location.hash)]);
  const [gIndeks, setGIndeks] = useState(0);
  const gorunum = gecmis[gIndeks];

  const [sorgu, setSorgu] = useState(() => {const initial=parseView(window.location.hash);return initial.tip === "arama" ? initial.q : "";});
  const [sonuclar, setSonuclar] = useState<Parca[] | null>(null);
  const [araniyor, setAraniyor] = useState(false);
  const [aramaHata, setAramaHata] = useState("");
  const [aramaAlbumler, setAramaAlbumler] = useState<Awaited<ReturnType<typeof api.ara>>["albumler"]>([]);
  const [aramaSanatcilar, setAramaSanatcilar] = useState<Awaited<ReturnType<typeof api.ara>>["sanatcilar"]>([]);
  const [mesaj, setMesaj] = useState("");
  const [kenarHata, setKenarHata] = useState("");
  const [kenarYuk, setKenarYuk] = useState(true);
  const [iceAktar, setIceAktar] = useState<false | {spotifyJob?: string}>(false);
  const [tamEkran, setTamEkran] = useState(false);
  const [aramaSekme, setAramaSekme] = useState<"tumu" | "parcalar" | "albumler" | "sanatcilar">("tumu");
  const [yeniListeAcik, setYeniListeAcik] = useState(false);
  const [yeniListeAd, setYeniListeAd] = useState("");
  const [listeKaydediliyor, setListeKaydediliyor] = useState(false);
  const [listeHata, setListeHata] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);

  const [albumler, setAlbumler] = useState<import("./api").Album[]>([]);
  const [sanatcilar, setSanatcilar] = useState<import("./api").SanatciDetay[]>([]);
  const [listeler, setListeler] = useState<Liste[]>([]);
  const [begeniSayisi, setBegeniSayisi] = useState(0);
  const [ortakListeler, setOrtakListeler] = useState<Liste[]>([]);
  const [dinlemeGecmisi, setDinlemeGecmisi] = useState<Parca[]>([]);
  const [favYenileme, setFavYenileme] = useState(0);

  const [indirmeler, setIndirmeler] = useState<Indirme[]>([]);
  const [archiveJobs, setArchiveJobs] = useState<ArchiveJob[]>([]);
  const [archiveHata, setArchiveHata] = useState("");
  const [panel, setPanel] = useState<"yok" | "kuyruk" | "indirme" | "cihazlar">("yok");
  const [arsivDurum, setArsivDurum] = useState<Record<string, string>>({});
  const [mobilMenu, setMobilMenu] = useState(false);

  /* ------------------------------------------------------------- gezinme */

  // git() bagimliliksiz kalsin diye guncel indeks ref'te tutulur
  const gIndeksRef = useRef(gIndeks);
  useEffect(() => { gIndeksRef.current = gIndeks; }, [gIndeks]);

  const gecmisRef = useRef(gecmis);
  useEffect(() => { gecmisRef.current = gecmis; }, [gecmis]);
  const git = useCallback((g: Gorunum) => {
    // Geri gidilmisken yeni sayfaya atlanirsa ileri gecmisi atilir (tarayici gibi)
    const previousIndex = gIndeksRef.current, leaving = gecmisRef.current[previousIndex];
    if (leaving?.tip === "arama" && g.tip !== "arama") aramayiHatirla(leaving.q);
    for (const key of [...scrollPositions.current.keys()]) if (key > previousIndex) scrollPositions.current.delete(key);
    for (const key of [...searchTabs.current.keys()]) if (key > previousIndex) searchTabs.current.delete(key);
    setGecmis((h) => [...h.slice(0, previousIndex + 1), g]);
    const index = previousIndex + 1; gIndeksRef.current = index; setGIndeks(index);
    setMobilMenu(false);
    setTamEkran(false);
    setSorgu(g.tip === "arama" ? g.q : "");
    window.history.pushState({ sidewave: true, index }, "", viewUrl(g));
  }, [aramayiHatirla]);
  // Typing a search creates one history entry and then updates it, so Back returns to the
  // page before the search and Forward/Back from an opened result returns to the results.
  const aramaDegistir = useCallback((value: string) => {
    setSorgu(value); setTamEkran(false);
    const index = gIndeksRef.current, current = gecmisRef.current[index];
    // Clearing the box keeps you on Search, which then shows Browse (like Spotify's Search tab).
    if (!value.trim()) { if (current?.tip === "arama" && current.q) { const browse: Gorunum = {tip: "arama", q: ""}; setGecmis(h => h.map((v, i) => i === index ? browse : v)); window.history.replaceState({sidewave: true, index}, "", viewUrl(browse)); } return; }
    const view: Gorunum = {tip: "arama", q: value.trim()};
    if (current?.tip === "arama") { setGecmis(h => h.map((v, i) => i === index ? view : v)); window.history.replaceState({sidewave: true, index}, "", viewUrl(view)); }
    else git(view);
  }, [git]);

  const geri = useCallback(() => window.history.back(), []);
  const ileri = useCallback(() => window.history.forward(), []);
  useEffect(() => {
    window.history.replaceState({sidewave:true,index:0}, "", viewUrl(parseView(window.location.hash)));
    const f = (event: PopStateEvent) => {
      const g = parseView(window.location.hash), index = event.state?.sidewave ? event.state.index : 0;
      gIndeksRef.current = index;
      setGecmis(h => { const next = [...h]; next[index] = g; return next; });
      setGIndeks(index); setTamEkran(false); setSorgu(g.tip === "arama" ? g.q : ""); setMobilMenu(false);
    };
    window.addEventListener("popstate", f);
    return () => window.removeEventListener("popstate", f);
  }, []);
  // Each history entry keeps its own search category, like its scroll position.
  useEffect(() => { setAramaSekme(searchTabs.current.get(gIndeks) || "tumu"); }, [gIndeks]);
  const favoriRef = useRef<(p: Parca) => void>(() => {});
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const input = e.target instanceof Element && !!e.target.closest("input, textarea, select, [contenteditable=true]");
      const dialogOpen = !!document.querySelector("dialog[open]");
      if (!input && e.key === "/" && !dialogOpen) { e.preventDefault(); setMobilMenu(false); document.getElementById("arama")?.focus(); }
      if (!input && !dialogOpen && e.key === "?") { e.preventDefault(); setKisayollar(true); }
      if (!input && !dialogOpen && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "l" && calarRef.current.calan) { e.preventDefault(); favoriRef.current(calarRef.current.calan); }
      if (e.key === "Escape" && !document.querySelector("dialog[open], [role=menu]")) { setMobilMenu(false); setPanel("yok"); setTamEkran(false); }
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, []);

  const calarRef = useRef(calar); calarRef.current = calar;
  const acAlbum = useCallback((id: string) => git({ tip: "album", id }), [git]);
  const acSanatci = useCallback((id: string) => git({ tip: "sanatci", id: id.startsWith("yt:") ? id.slice(3) : id, kaynak: id.startsWith("yt:") ? "youtube" : "kutuphane" }), [git]);
  const acYtSanatci = useCallback((id: string) => git({ tip: "sanatci", id, kaynak: "youtube" }), [git]);

  /* --------------------------------------------------------- kenar verisi */

  const kenarYenile = useCallback(() => {
    setKenarHata(""); setKenarYuk(true);
    void Promise.allSettled([api.kutuphane().then(d => { setAlbumler(d.albumler || []); setSanatcilar(d.sanatcilar || []); }), api.listeler().then(d => { setListeler(d.listeler || []); setBegeniSayisi(d.begeniSayisi || 0); }), api.sharedFollowed().then(d => setOrtakListeler(d.listeler || [])).catch(() => setOrtakListeler([])), api.gecmis().then(d => setDinlemeGecmisi(d.parcalar || []))]).then(results => {
      const failed = results.find(r => r.status === "rejected");
      if (failed?.status === "rejected") setKenarHata(failed.reason.message || "Your library could not be loaded.");
      setKenarYuk(false);
    });
  }, []);
  useEffect(kenarYenile, [kenarYenile]);
  useEffect(() => {
    if (!calar.oynuyor || !calar.calan) return;
    const track = calar.calan;
    setDinlemeGecmisi(previous => [track, ...previous.filter(item => item.id !== track.id || item.kaynak !== track.kaynak)].slice(0, 50));
  }, [calar.oynuyor, calar.calan]);
  const aktifIndirme = indirmeler.filter((d) => !d.bitti && !d.hatali).length;
  const izlenecek = panel === "indirme" || aktifIndirme > 0 || archiveJobs.some(j => !["hazir", "basarisiz", "bulunamadi"].includes(j.durum));
  useEffect(() => {
    // Downloads and archive jobs belong to the library owner. Poll quickly only while
    // something is in progress or the panel is open, and never in a hidden tab.
    if (!owner) return;
    let stopped = false;
    const update = async () => {
      if (document.hidden) return;
      await Promise.allSettled([
        api.indirmeler().then(d => { if (!stopped) setIndirmeler(d.indirmeler || []); }),
        api.archiveJobs().then(d => { if (!stopped) { setArchiveJobs(d.jobs); setArchiveHata(""); setArsivDurum(previous => ({...previous, ...Object.fromEntries(d.jobs.map(j => [j.parca.id, j.durum === "hazir" ? "indi" : ["basarisiz", "bulunamadi"].includes(j.durum) ? "yok" : j.durum]))})); } }).catch(e => { if (!stopped) setArchiveHata(e.message); }),
      ]);
    };
    void update(); const timer = setInterval(update, izlenecek ? 5000 : 60000);
    const visible = () => { if (!document.hidden) void update(); };
    document.addEventListener("visibilitychange", visible);
    return () => { stopped = true; clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [owner, izlenecek]);
  const archiveTimers = useRef(new Map<string, ReturnType<typeof setInterval>>());
  useEffect(() => () => archiveTimers.current.forEach(clearInterval), []);

  /* --------------------------------------------------------------- arama */

  useEffect(() => {
    const q = sorgu.trim(); const controller = new AbortController();
    if (!restoring.current) setAramaSekme("tumu");
    if (!q) { setSonuclar(null); setAraniyor(false); setAramaHata(""); return; }
    const goster = (d: Awaited<ReturnType<typeof api.ara>>) => { setSonuclar(d.parcalar || []); setAramaAlbumler(d.albumler || []); setAramaSanatcilar(d.sanatcilar || []); setAramaHata(d.hata ? (typeof d.hata === "string" ? d.hata : Object.values(d.hata).filter(Boolean).join(" · ")) : ""); };
    // Returning to a search (Back from an album) shows the same results instantly.
    const cached = aramaOnbellek.current.get(q);
    if (cached && Date.now() - cached.at < 5 * 60000) { goster(cached.data); setAraniyor(false); return; }
    if (!restoring.current) contentRef.current?.scrollTo({top: 0});
    setAraniyor(true); setSonuclar([]); setAramaHata(""); setAramaAlbumler([]); setAramaSanatcilar([]);
    const timer = setTimeout(() => {
      api.ara(q, controller.signal).then(d => { if (controller.signal.aborted) return; aramaOnbellek.current.set(q, {at: Date.now(), data: d}); if (aramaOnbellek.current.size > 30) aramaOnbellek.current.delete(aramaOnbellek.current.keys().next().value!); goster(d); })
        .catch(e => { if (!controller.signal.aborted) setAramaHata(e.message); })
        .finally(() => { if (!controller.signal.aborted) setAraniyor(false); });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [sorgu]);
  // Back/Forward return to the previous scroll position once the page has content to scroll.
  useLayoutEffect(() => {
    const el = contentRef.current; if (!el) return;
    const target = scrollPositions.current.get(gIndeks) || 0;
    let frame = 0, tries = 0; restoring.current = true;
    const stop = () => { restoring.current = false; cancelAnimationFrame(frame); el.removeEventListener("wheel", stop); el.removeEventListener("touchstart", stop); el.removeEventListener("keydown", stop); };
    const attempt = () => { el.scrollTop = target; if (Math.abs(el.scrollTop - target) > 2 && tries++ < 150) frame = requestAnimationFrame(attempt); else stop(); };
    el.addEventListener("wheel", stop, {passive: true}); el.addEventListener("touchstart", stop, {passive: true}); el.addEventListener("keydown", stop);
    attempt();
    return stop;
  }, [gIndeks]);

  useEffect(() => { searchTabs.current.set(gIndeksRef.current, aramaSekme); }, [aramaSekme]);

  /* -------------------------------------------------------------- eylemler */

  const favoriYap = useCallback(async (p: Parca) => {
    const yeni = !p.favori;
    // Views share track objects, so the heart updates everywhere without refetching.
    p.favori = yeni;
    calar.parcaGuncelle(p);
    try {
      await api.favoriYap(p, yeni); setFavYenileme(n => n + 1);
      if (yeni) toast("Saved to Liked Songs."); else toast("Removed from Liked Songs.", {label: "Undo", onClick: () => void favoriRef.current(p)});
    }
    catch (e) { p.favori = !yeni; calar.parcaGuncelle(p); setMesaj((e as Error).message); }
  }, [calar.parcaGuncelle, toast]);
  favoriRef.current = favoriYap;

  const arsiveEkle = useCallback(async (p: Parca) => {
    if (archiveTimers.current.has(p.id)) return;
    setArsivDurum(s => ({...s, [p.id]: "araniyor"}));
    try {
      const r = await api.arsiveEkle(p); toast("Saving to your library…", {label: "View", onClick: () => setPanel("indirme")});
      const timer = setInterval(async () => {
        try {
          const job = await api.arsivDurum(r.isId);
          const ready = ["kutuphanede", "hazir", "ready"].includes(job.durum);
          const failed = ["bulunamadi", "error", "basarisiz", "failed"].includes(job.durum);
          setArsivDurum(x => ({...x, [p.id]: ready ? "indi" : failed ? "yok" : job.durum}));
          if (ready || failed) { clearInterval(timer); archiveTimers.current.delete(p.id); if (ready) kenarYenile(); else setMesaj(job.message || "Could not save to your library."); }
        } catch (e) { clearInterval(timer); archiveTimers.current.delete(p.id); setArsivDurum(x => ({...x, [p.id]: "yok"})); setMesaj((e as Error).message); }
      }, 3000);
      archiveTimers.current.set(p.id, timer);
    } catch (e) { setArsivDurum(s => ({...s, [p.id]: "yok"})); setMesaj((e as Error).message); }
  }, [kenarYenile]);
  const radyoBaslat = async () => {
    if (!calar.calan) return;
    try { const result = await api.radyo(calar.calan); if (result.parcalar.length) calar.cal(result.parcalar[0], result.parcalar); else setMesaj("No radio was found for this track."); } catch (e) { setMesaj((e as Error).message); }
  };
  // "Not for me" removes a song (or an artist) from recommendations, radio and weekly mixes.
  const gizle = useCallback(async (p: Parca, scope: "track" | "artist" = "track") => {
    try {
      await api.oneriGizle(p, scope);
      const now = calarRef.current.calan, norm = (v?: string) => (v || "").toLocaleLowerCase("tr").trim();
      if (now && calarRef.current.oynuyor && (scope === "artist" ? norm(now.sanatci) === norm(p.sanatci) : now.id === p.id && now.kaynak === p.kaynak)) calarRef.current.atla(1);
      toast(scope === "artist" ? `You won’t get songs by ${p.sanatci} in recommendations.` : "Got it. We won’t recommend this song.", {label: "Undo", onClick: () => void api.oneriGeriAl(p, scope).catch(e => setMesaj((e as Error).message))});
      return true;
    } catch (e) { setMesaj((e as Error).message); return false; }
  }, [toast]);
  const kuyruktanCikar = (i: number) => { const removed = calar.kuyruk[i]; calar.kuyruktanCikar(i); if (removed) toast(`Removed “${removed.baslik}” from queue.`, {label: "Undo", onClick: calar.kaldirmayiGeriAl}); };
  // Collaborative playlists you follow can be added to like your own (their id is share:<token>).
  const eklenebilirListeler = [...listeler, ...ortakListeler.filter(l => l.mode === "edit").map(l => ({...l, ad: `${l.ad} · ${l.owner}`}))];
  const listeAcId = (id: string) => git(id.startsWith("share:") ? {tip: "paylasilan", token: id.slice(6)} : {tip: "liste", id});
  const ortak = {
    calan: calar.calan, onCal: calar.cal,
    onSanatciId: acSanatci, onAlbumId: acAlbum,
    onFavori: favoriYap, listeler: eklenebilirListeler, onListeYenile: kenarYenile,
    onKesfet: () => { git({tip: "kesfet"}); requestAnimationFrame(() => document.getElementById("arama")?.focus()); },
  };

  const sorguAnahtari = aramaAnahtari(sorgu);
  const tumAramaSanatcilari = aramaSanatcilar || [];
  const eslesenSanatcilar = tumAramaSanatcilari.filter(a => sorguAnahtari && aramaAnahtari(a.ad) === sorguAnahtari);
  const eslesenSanatciKimlikleri = new Set(eslesenSanatcilar.map(a => `${a.kaynak}:${a.id}`));
  const altBolumSanatcilari = aramaSekme === "tumu" ? tumAramaSanatcilari.filter(a => !eslesenSanatciKimlikleri.has(`${a.kaynak}:${a.id}`)) : tumAramaSanatcilari;
  const toplamAramaSonucu = (sonuclar?.length || 0) + (aramaAlbumler?.length || 0) + tumAramaSanatcilari.length;
  const kategoriSonucSayisi = aramaSekme === "tumu" ? toplamAramaSonucu : aramaSekme === "parcalar" ? sonuclar?.length || 0 : aramaSekme === "albumler" ? aramaAlbumler?.length || 0 : tumAramaSanatcilari.length;
  const baskaKategorideSonuc = aramaSekme !== "tumu" && toplamAramaSonucu > 0 && kategoriSonucSayisi === 0;
  const listeAc = () => { setListeHata(""); setYeniListeAd(""); setYeniListeAcik(true); };
  const listeOlustur = async (e: React.FormEvent) => {
    e.preventDefault(); if (!yeniListeAd.trim() || listeKaydediliyor) return;
    setListeKaydediliyor(true); setListeHata("");
    try { const r = await api.listeOlustur(yeniListeAd.trim()); setYeniListeAcik(false); kenarYenile(); git({tip: "liste", id: r.id}); }
    catch (error) { setListeHata((error as Error).message); }
    finally { setListeKaydediliyor(false); }
  };

  /* ---------------------------------------------------------------- render */

  return (
    <PlayerActionsContext.Provider value={{playNext: calar.siradakiOlarak, addToQueue: calar.kuyrugaEkle, shuffleAll: calar.karistirCal, smartShuffle: calar.akilliKaristir, dismiss: gizle, owner}}><DiscoveryContext.Provider value={{open:setDiscovery}}><div style={appearance.style} className={`app-shell ${appearance.wallpaper ? "has-wallpaper" : ""} ${tamEkran ? "listening-active" : ""} h-dvh w-full overflow-hidden bg-background text-foreground flex flex-col font-sans`}>
      <div className="app-grid flex-1 min-h-0 grid overflow-hidden">

        {/* ------------------------------------------------------ kenar cubugu */}
        <aside aria-label="Library navigation" className={`app-sidebar ${mobilMenu ? "is-open" : ""}`}>
          <div className="sidebar-navigation">
            <div className="flex items-center justify-between mb-6">
              <button aria-label="Sidewave home" onClick={() => git({ tip: "kesfet" })} className="brand-button flex items-center gap-3">
                <div className="brand-mark"><AudioLines size={21} strokeWidth={2.3} /></div>
                <span className="font-bold tracking-tight text-lg">Sidewave</span>
              </button>
              <button aria-label="Close library" onClick={() => setMobilMenu(false)} className="utility-button lg:hidden text-muted-foreground">
                <X size={18} />
              </button>
            </div>
            <nav className="space-y-1">
              <YanOge ikon={<Home size={20} />} etiket="Home"
                aktif={gorunum.tip === "kesfet" && !sorgu} onClick={() => { setSorgu(""); git({ tip: "kesfet" }); }} />
              <YanOge ikon={<Radio size={20} />} etiket="Discover Weekly" aktif={gorunum.tip === "weekly"} onClick={() => git({tip:"weekly"})} />
              <YanOge ikon={<ListMusic size={20} />} etiket="Sidewave Sessions" aktif={gorunum.tip === "collections" || gorunum.tip === "collection"} onClick={() => git({tip:"collections"})} />
              <YanOge ikon={<Heart size={20} />} etiket="Liked Songs"
                aktif={gorunum.tip === "favoriler"} onClick={() => git({ tip: "favoriler" })} />
              <YanOge ikon={<Library size={20} />} etiket="Your Library" aktif={gorunum.tip === "kutuphane"} onClick={() => git({tip: "kutuphane"})} />
            </nav>
          </div>

          <SidebarCollection history={dinlemeGecmisi} albums={albumler} artists={sanatcilar} playlists={[...listeler, ...ortakListeler]}
            loading={kenarYuk} error={kenarHata}
            activeAlbum={gorunum.tip === "album" ? gorunum.id : undefined}
            activePlaylist={gorunum.tip === "liste" ? gorunum.id : undefined}
            onAlbum={acAlbum} onArtist={acSanatci} onPlaylist={listeAcId}
            onCreate={listeAc} onImport={() => setIceAktar({})} onRetry={kenarYenile} />
        </aside>

        {/* --------------------------------------------------------- ana panel */}
        <main className="main-surface min-w-0 overflow-hidden relative flex flex-col">
          <header className="app-topbar flex items-center gap-2 sm:gap-3 shrink-0 z-20">
            <button aria-label="Open library" onClick={() => setMobilMenu(true)} className="mobile-brand brand-mark lg:hidden shrink-0">
              <AudioLines size={21} />
            </button>

            <div className="hidden sm:flex items-center gap-1 shrink-0">
              <button onClick={() => tamEkran ? setTamEkran(false) : geri()} disabled={gIndeks === 0 && !tamEkran} title="Back"
                className="utility-button text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors">
                <ChevronLeft size={18} />
              </button>
              <button onClick={ileri} disabled={gIndeks >= gecmis.length - 1} title="Forward"
                className="utility-button text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors">
                <ChevronRight size={18} />
              </button>
            </div>

            <div className="search-field relative flex-1 max-w-xl">
              <Search size={19} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input onFocus={()=>setSearchFocused(true)} onBlur={e=>{if(!e.currentTarget.parentElement?.contains(e.relatedTarget as Node))setSearchFocused(false)}} id="arama" value={sorgu} onChange={(e) => aramaDegistir(e.target.value)}
                aria-label="Search songs, albums or artists" placeholder="Search songs, albums or artists…" autoComplete="off"
                role="combobox" aria-expanded={searchFocused&&!sorgu&&recentQueries.length>0} aria-controls="son-aramalar" aria-autocomplete="list"
                onKeyDown={e => { if (e.key === "Escape") { aramaDegistir(""); e.currentTarget.blur(); } if (e.key === "Enter") aramayiHatirla(sorgu); if (e.key === "ArrowDown" && !sorgu) { e.preventDefault(); document.querySelector<HTMLButtonElement>("#son-aramalar [data-recent]")?.focus(); } }}
                className="w-full h-12 rounded-full pl-12 pr-12 text-sm transition-colors" />
              {searchFocused&&!sorgu&&recentQueries.length>0&&<div id="son-aramalar" role="listbox" aria-label="Recent searches" className="recent-searches absolute top-full left-0 right-0 z-40 mt-2 rounded-xl border border-border bg-popover p-2 shadow-xl"
                onKeyDown={e=>{if(!["ArrowDown","ArrowUp"].includes(e.key))return;e.preventDefault();const items=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("[data-recent]")),i=items.indexOf(document.activeElement as HTMLButtonElement);if(e.key==="ArrowUp"&&i<=0){document.getElementById("arama")?.focus();return;}items[Math.min(items.length-1,Math.max(0,i+(e.key==="ArrowDown"?1:-1)))]?.focus();}}
                onBlur={e=>{if(!e.currentTarget.parentElement?.contains(e.relatedTarget as Node))setSearchFocused(false)}}>
                <div className="flex items-center justify-between px-3 pt-1 pb-2"><span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Recent searches</span><button className="text-xs text-muted-foreground hover:text-foreground min-h-9 px-2" onMouseDown={e=>e.preventDefault()} onClick={()=>sonAramalariKaydet([])}>Clear all</button></div>
                {recentQueries.map(q=><div key={q} className="recent-search-row flex items-center"><button data-recent role="option" aria-selected={false} className="flex-1 flex items-center gap-3 text-left min-h-11 px-3 rounded-lg hover:bg-white/6 focus-visible:bg-white/8" onMouseDown={e=>e.preventDefault()} onClick={()=>{aramaDegistir(q);setSearchFocused(false)}}><Search size={15} className="text-muted-foreground shrink-0"/><span className="truncate">{q}</span></button><button aria-label={`Remove ${q} from recent searches`} className="utility-button text-muted-foreground" onMouseDown={e=>e.preventDefault()} onClick={()=>sonAramalariKaydet(recentQueries.filter(x=>x!==q))}><X size={14}/></button></div>)}
              </div>}
              {sorgu ? <button aria-label="Clear search" onClick={() => {aramaDegistir(""); document.getElementById("arama")?.focus();}} className="absolute right-1 top-1 utility-button"><X size={16} /></button> : <kbd className="search-shortcut hidden md:block">/</kbd>}
            </div>

            <AccountButton onAppearance={() => setAppearanceOpen(true)} onDownloads={owner ? () => setPanel(p => p === "indirme" ? "yok" : "indirme") : undefined} onShortcuts={() => setKisayollar(true)} onStats={() => git({tip: "istatistik"})} downloadCount={aktifIndirme} />
          </header>

          <div className="content-stack flex-1 min-h-0 relative">
          {/* The page stays mounted (and keeps its scroll position) underneath Now Playing. */}
          <div ref={contentRef} inert={tamEkran && !!calar.calan} aria-hidden={tamEkran && !!calar.calan || undefined} onScroll={e => { if (!restoring.current) scrollPositions.current.set(gIndeksRef.current, e.currentTarget.scrollTop); }} className={`content-scroll absolute inset-0 overflow-y-auto ${tamEkran && calar.calan ? "is-covered" : ""}`}>
            <div key={sorgu?"search":`${gorunum.tip}:${'id' in gorunum?gorunum.id:''}`} className="content-body relative">

              {sonuclar ? (
                <section className="search-results">
                  <div className="section-heading mb-5">
                    <div><p className="eyebrow mb-2">FIND YOUR SOUND</p><h1 className="text-3xl font-bold tracking-tight">Search results</h1><p className="text-sm text-muted-foreground mt-2">“{sorgu.trim()}” in your library and beyond.</p></div>
                    {araniyor && <Loader2 size={20} className="animate-spin text-primary" />}
                  </div>
                  <div className="search-filters flex gap-2 mb-7" aria-label="Search categories">
                    {([["tumu", "All"], ["parcalar", "Songs"], ["albumler", "Albums"], ["sanatcilar", "Artists"]] as const).map(([key, label]) => <button key={key} onClick={() => setAramaSekme(key)} aria-pressed={aramaSekme === key} className={`filter-chip ${aramaSekme === key ? "is-selected" : ""}`}>{label}</button>)}
                  </div>
                  {aramaHata && <p role="alert" className="notice notice-error mb-5"><AlertCircle size={18} className="shrink-0" />{aramaHata}</p>}
                  {araniyor ? <div aria-label="Loading search results" role="status" className="space-y-3">{[0,1,2,3,4].map(i => <div key={i} className="flex items-center gap-4 py-2"><div className="skeleton h-12 w-12 rounded-lg" /><div className="flex-1 space-y-2"><div className="skeleton h-3 w-2/5 rounded" /><div className="skeleton h-2 w-1/4 rounded" /></div></div>)}</div> : <>
                    {aramaSekme === "tumu" && eslesenSanatcilar.length > 0 && <section aria-labelledby="eslesen-sanatcilar-baslik" className="music-section mb-7">
                      <div className="section-heading mb-3"><h2 id="eslesen-sanatcilar-baslik" className="text-lg font-semibold">Matching artists</h2></div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {eslesenSanatcilar.map(a => <button key={`${a.kaynak}:${a.id}`} aria-label={`${a.ad} · Artist`} onClick={() => a.kaynak === "youtube" ? acYtSanatci(a.id) : acSanatci(a.id)} className="flex items-center gap-4 min-w-0 rounded-xl border border-border bg-white/[0.025] hover:bg-white/[0.06] p-3 text-left transition-colors">
                          <Kapak kaynak={a} yuvarlak boyut={160} className="h-16 w-16 shrink-0" />
                          <span className="min-w-0 flex-1"><span className="block font-semibold truncate">{a.ad}</span><span className="block text-xs text-muted-foreground mt-1">Artist · {a.kaynak === "kutuphane" ? "In your library" : "Online"}</span></span>
                          <ChevronRight aria-hidden="true" size={19} className="shrink-0 text-muted-foreground" />
                        </button>)}
                      </div>
                    </section>}
                    {(aramaSekme === "tumu" || aramaSekme === "parcalar") && !!sonuclar.length && <section className="music-section">
                      <div className="section-heading mb-3"><div><h2 className="text-lg font-semibold">Songs <span className="text-muted-foreground text-sm font-normal ml-2">{sonuclar.length}</span></h2></div>
                        {aramaSekme === "tumu" && sonuclar.length > 8 && <button onClick={() => setAramaSekme("parcalar")} className="text-sm text-muted-foreground hover:text-foreground min-h-11">See all <span aria-hidden="true">→</span></button>}
                      </div>
                      <ParcaTablosu parcalar={aramaSekme === "tumu" ? sonuclar.slice(0, 8) : sonuclar} calan={calar.calan} onCal={p => { aramayiHatirla(sorgu); calar.cal(p, sonuclar); }}
                        onSanatci={(t) => t.sanatciId && (t.kaynak === "youtube" ? acYtSanatci(t.sanatciId) : acSanatci(t.sanatciId))}
                        onAlbum={(t) => t.albumId && acAlbum(`${t.kaynak === "youtube" ? "yt:" : ""}${t.albumId}`)}
                        onFavori={favoriYap} onArsiv={arsiveEkle} arsivDurum={arsivDurum}
                        listeler={eklenebilirListeler} onListeYenile={kenarYenile} />
                    </section>}
                    {(aramaSekme === "tumu" || aramaSekme === "albumler") && !!aramaAlbumler?.length && <section className="music-section mt-8"><div className="section-heading mb-4"><h2 className="text-lg font-semibold">Albums</h2>{aramaSekme === "tumu" && aramaAlbumler.length > 6 && <button className="text-sm text-muted-foreground hover:text-foreground min-h-11" onClick={() => setAramaSekme("albumler")}>See all <span aria-hidden="true">→</span></button>}</div><div className="search-card-grid">{(aramaSekme === "tumu" ? aramaAlbumler.slice(0, 6) : aramaAlbumler).map(a => <button key={`${a.kaynak}:${a.id}`} onClick={() => acAlbum(`${a.kaynak === "youtube" ? "yt:" : ""}${a.id}`)} className="search-result-card text-left"><Kapak kaynak={a} boyut={240} className="w-full aspect-square mb-3" /><span className="block font-semibold text-sm truncate">{a.ad}</span><span className="block text-xs text-muted-foreground truncate mt-1">{a.sanatci || "Album"}</span></button>)}</div></section>}
                    {(aramaSekme === "tumu" || aramaSekme === "sanatcilar") && altBolumSanatcilari.length > 0 && <section className="music-section mt-8"><div className="section-heading mb-4"><h2 className="text-lg font-semibold">Artists</h2></div><div className="search-card-grid">{(aramaSekme === "tumu" ? altBolumSanatcilari.slice(0, 6) : altBolumSanatcilari).map(a => <button key={`${a.kaynak}:${a.id}`} onClick={() => a.kaynak === "youtube" ? acYtSanatci(a.id) : acSanatci(a.id)} className="search-result-card text-left"><Kapak kaynak={a} yuvarlak boyut={240} className="w-full aspect-square mb-3" /><span className="block font-semibold text-sm truncate">{a.ad}</span><span className="block text-xs text-muted-foreground mt-1">Artist</span></button>)}</div></section>}
                    {(!aramaHata || baskaKategorideSonuc) && kategoriSonucSayisi === 0 && <div className="empty-state"><Search size={32} /><h2>{aramaSekme === "tumu" ? "No results found." : "No results in this category."}</h2><p>{baskaKategorideSonuc ? "Your search has results in another category. Take a look." : "Try a song, an artist or a different spelling."}</p>{baskaKategorideSonuc && <button onClick={() => setAramaSekme("tumu")} className="button-primary mt-4">Show all results</button>}</div>}
                  </>}
                </section>
              ) : gorunum.tip === "arama" ? (
                <GozatGorunum recent={recentQueries} onSearch={q => { aramaDegistir(q); document.getElementById("arama")?.focus(); }} onRemoveRecent={q => sonAramalariKaydet(recentQueries.filter(x => x !== q))}
                  onCollection={id => git({tip: "collection", id})} onWeekly={() => git({tip: "weekly"})} onLiked={() => git({tip: "favoriler"})} onMix={id => git({tip: "mix", id})} />
              ) : gorunum.tip === "kutuphane" ? (
                <KutuphaneGorunum listeler={[...listeler, ...ortakListeler]} begeniSayisi={begeniSayisi} albumler={albumler} sanatcilar={sanatcilar} gecmis={dinlemeGecmisi}
                  onLiked={() => git({tip: "favoriler"})} onPlaylist={listeAcId} onAlbum={acAlbum} onArtist={acSanatci} onCreate={listeAc} onImport={() => setIceAktar({})} />
              ) : gorunum.tip === "mix" ? (
                <MixGorunum id={gorunum.id} {...ortak} />
              ) : gorunum.tip === "weekly" || gorunum.tip === "collections" || gorunum.tip === "collection" ? (
                <CollectionsView key={gorunum.tip === "collection" ? gorunum.id : gorunum.tip} view={gorunum} {...ortak} onOpen={id=>git({tip:"collection",id})} />
              ) : gorunum.tip === "album" ? (
                <AlbumGorunum id={gorunum.id} {...ortak} />
              ) : gorunum.tip === "sanatci" ? (
                <SanatciGorunum id={gorunum.id} kaynak={gorunum.kaynak} {...ortak}
                  onArsiv={arsiveEkle} arsivDurum={arsivDurum} />
              ) : gorunum.tip === "favoriler" ? (
                <FavorilerGorunum {...ortak} yenileme={favYenileme} />
              ) : gorunum.tip === "sarki" ? (
                <SarkiGorunum token={gorunum.token} onCal={calar.cal} onFavori={favoriYap} onSanatciId={acSanatci} listeler={eklenebilirListeler} onListeYenile={kenarYenile} />
              ) : gorunum.tip === "istatistik" ? (
                <IstatistikGorunum onCal={calar.cal} onSanatciAra={artist => aramaDegistir(artist)} />
              ) : gorunum.tip === "paylasilan" ? (
                <PaylasilanGorunum token={gorunum.token} {...ortak} onOwn={id => { const index = gIndeksRef.current, view: Gorunum = {tip: "liste", id}; setGecmis(h => h.map((v, i) => i === index ? view : v)); window.history.replaceState({sidewave: true, index}, "", viewUrl(view)); }} onSaved={id => git({tip: "liste", id})} />
              ) : gorunum.tip === "liste" ? (
                <CalmaListesiGorunum id={gorunum.id} {...ortak}
                  onSilindi={() => git({ tip: "kesfet" })} />
              ) : (
                <KesfetGorunum {...ortak} onYtSanatci={acYtSanatci} onMix={id => git({tip: "mix", id})} onReviewImport={jobId => setIceAktar({spotifyJob: jobId})}
                  onArsiv={arsiveEkle} arsivDurum={arsivDurum} />
              )}
            </div>
          </div>
          {tamEkran && calar.calan && <div className="now-playing-layer absolute inset-0 overflow-y-auto"><div className="content-body relative"><NowPlayingView player={calar} onClose={()=>{setTamEkran(false);requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>(".player-art-button")?.focus());}} onFavorite={favoriYap} onDismiss={p => void gizle(p)} onArtist={acSanatci} onAlbum={acAlbum} onDiscover={setDiscovery} onRadio={radyoBaslat} onDevices={()=>setPanel("cihazlar")} onQueue={()=>setPanel("kuyruk")}/></div></div>}
          </div>

          {/* paneller */}
          {panel !== "yok" && (
            <section aria-label={panel === "kuyruk" ? "Play queue" : panel === "cihazlar" ? "Connected devices" : "Downloads"} className="utility-panel">
              <div className="utility-panel-header">
                <div><h2 className="font-semibold text-base">{panel === "kuyruk" ? "Queue" : panel === "cihazlar" ? "Your devices" : "Downloads"}</h2><p className="text-xs text-muted-foreground mt-1">{panel === "kuyruk" ? `${calar.kuyruk.length} tracks` : panel === "cihazlar" ? "Take your music with you" : "Your downloads and saved music"}</p></div>
                <button aria-label="Close panel" onClick={() => setPanel("yok")} className="utility-button text-muted-foreground hover:text-foreground">
                  <X size={16} />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {panel === "cihazlar" ? <div className="p-3 space-y-3"><p className="text-xs text-muted-foreground">Pick up where you left off on your other devices.</p>{calar.devices.map(d => <div key={d.id} className="device-row text-sm"><span className={`device-dot ${d.online ? "is-online" : ""}`} aria-hidden="true"/><div className="min-w-0"><span className="font-medium">{d.name}{d.id === calar.deviceId ? " · This device" : ""}</span><p className="text-xs text-muted-foreground truncate">{d.online ? (d.state === "playing" ? "Playing" : "Online") : `Last seen ${lastSeen(d.updatedAt)}`} · {d.queue?.[d.index]?.baslik || "Not playing"}{d.position ? ` · ${sureBicim(d.position)}` : ""}</p></div></div>)}{calar.deviceError && <p role="alert" className="text-destructive text-xs">{calar.deviceError}</p>}<button onClick={calar.takeover} className="bg-primary text-primary-foreground font-semibold rounded-full px-4 py-2 text-sm">Play on this device</button></div> : panel === "kuyruk" ? (
                  calar.kuyruk.length === 0
                    ? <div className="empty-state"><ListMusic size={32} /><h2>Your queue is empty.</h2><p>Play a song or add one to your queue.</p></div>
                    : <><div className="flex flex-wrap gap-2 px-1 pb-1"><button className="min-h-11 px-3 text-sm text-muted-foreground hover:text-foreground" onClick={()=>document.querySelector(".queue-row.is-current")?.scrollIntoView({block:"nearest"})}>Jump to current track</button>{calar.kuyruk.length > calar.indeks + 1 && <button className="min-h-11 px-3 text-sm text-muted-foreground hover:text-foreground ml-auto" onClick={() => { const undo = calar.kuyruguTemizle(); toast("Cleared your queue.", {label: "Undo", onClick: undo}); }}>Clear queue</button>}</div><div data-drag-list>{calar.kuyruk.map((p, i) => (<div key={p.queueId}>
                      {i === calar.indeks + 1 && <p className="queue-section-label">Next up</p>}
                      <div data-drag-row
                        className={`queue-row flex items-center gap-1 rounded-lg hover:bg-white/5 group ${i === calar.indeks ? "is-current text-primary" : i < calar.indeks ? "is-played" : ""}`}>
                        <button className="queue-row-main flex flex-1 min-w-0 items-center gap-2 p-2 text-left rounded-lg" aria-current={i === calar.indeks || undefined} aria-label={`Play ${p.baslik}${p.sanatci ? ` by ${p.sanatci}` : ""}`} onClick={() => calar.atlaIndekse(i)}>
                        <span className="w-5 text-xs text-muted-foreground tabular-nums text-center">{i === calar.indeks ? <AudioLines size={16} className="text-primary" /> : i + 1}</span>
                        <Kapak kaynak={p} boyut={64} className="h-9 w-9 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{p.baslik}</span>
                          <span className="block truncate text-xs text-muted-foreground">{p.oneri && <span className="queue-recommended"><Sparkles size={11} />Recommended · </span>}{p.sanatci}</span>
                        </span>
                        </button>
                        <div className="queue-row-actions flex items-center shrink-0">
                        <DragHandle index={i} count={calar.kuyruk.length} label={p.baslik} onMove={(from, to) => calar.tasi(from, to - from)} />
                        <button aria-label="Remove from queue" onClick={(e) => { e.stopPropagation(); kuyruktanCikar(i); }}
                          className="queue-order text-muted-foreground hover:text-destructive transition-colors">
                          <X size={14} />
                        </button>
                        </div>
                      </div>
                    </div>))}</div></>
                ) : <>
                  {archiveHata && <p role="alert" className="p-3 text-xs text-destructive">{archiveHata}</p>}
                  {archiveJobs.slice().reverse().map(job => <div key={job.id} className="p-3 mb-2 rounded-lg bg-secondary"><p className="text-sm font-medium">{job.parca.baslik}</p><p className="text-xs text-muted-foreground mt-1">{archiveLabel(job.durum)}{job.mesaj ? ` · ${job.mesaj}` : ""}</p>{job.durum === "eslesme_bekliyor" && <div className="space-y-2 mt-2"><p className="text-xs text-muted-foreground">Check the recording and choose a match.</p>{job.candidates?.map(candidate => <button key={candidate.candidateId} className="block w-full text-left border border-border rounded p-2 hover:border-primary" onClick={async () => { try { await api.archiveSelect(job.id, candidate.candidateId); setArchiveJobs(all => all.map(j => j.id === job.id ? {...j, durum: "indirme_baslatiliyor"} : j)); } catch (e) { setArchiveHata((e as Error).message); } }}><span className="block text-xs break-all">{candidate.dosyaAdi}</span><span className="block text-[11px] text-muted-foreground mt-1">{[candidate.bicim, candidate.bitrate ? `${candidate.bitrate} kbps` : null, candidate.sure ? sureBicim(candidate.sure) : null].filter(Boolean).join(" · ")}</span></button>)}</div>}</div>)}
                  {indirmeler.length === 0
                    ? !archiveJobs.length && !archiveHata && <div className="p-4 text-sm text-muted-foreground">No downloads yet.</div>
                    : indirmeler.slice().reverse().slice(0, 30).map((d) => (
                      <div key={d.id} className="p-2 rounded-md hover:bg-white/5">
                        <div className="flex items-center gap-2 justify-between">
                          <span className="text-xs truncate flex-1">{d.dosyaAdi}</span>
                          <span className="text-[11px] text-muted-foreground tabular-nums">
                            {d.bitti ? "Ready in your library" : d.hatali ? "Failed" : d.durum}
                          </span>
                        </div>
                        <div className="h-[3px] mt-1.5 rounded-full bg-white/10 overflow-hidden">
                          <div className={`h-full rounded-full ${d.hatali ? "bg-destructive" : d.bitti ? "bg-primary" : "bg-accent"}`}
                            style={{ width: `${d.hatali ? 100 : d.yuzde}%` }} />
                        </div>
                      </div>
                    ))}
                </>}
              </div>
            </section>
          )}
        </main>
      </div>

      {(calar.hata || calar.uyari || mesaj) && <div role={calar.hata ? "alert" : "status"} className={`notice playback-notice ${calar.hata ? "notice-error" : ""} flex-wrap`}><AlertCircle size={16} className="shrink-0" /><span className="flex-1 min-w-40">{calar.hata?.message || calar.uyari || mesaj}</span>{calar.hata && <><button onClick={calar.yenidenDene} className="font-semibold underline min-h-11">Try again</button><button onClick={() => calar.atla(1)} className="font-semibold underline min-h-11">Skip track</button></>}{!calar.hata && <button className="utility-button" aria-label="Dismiss notification" onClick={() => { setMesaj(""); calar.uyariKapat(); }}><X size={16} /></button>}</div>}

      {appearanceOpen && <AppearanceSettings appearance={appearance} onClose={() => setAppearanceOpen(false)} />}
      <footer className="player-bar" aria-label="Music player">
        <div className="player-track">
          <button className="player-art-button" aria-label="Show now playing" disabled={!calar.calan} onClick={() => setTamEkran(true)}>
            {calar.calan ? <Kapak kaynak={calar.calan} boyut={160} eager className="h-14 w-14" /> : <div className="h-12 w-12 rounded-lg bg-secondary grid place-items-center text-muted-foreground"><AudioLines size={22} /></div>}
          </button>
          <div className="min-w-0 flex-1">
            <button disabled={!calar.calan} onClick={() => setTamEkran(true)} className="player-track-title block truncate text-sm font-semibold text-left max-w-full hover:underline disabled:no-underline">{calar.calan?.baslik || "Make room for music"}</button>
            <button disabled={!calar.calan?.sanatciId} onClick={() => calar.calan?.sanatciId && acSanatci(`${calar.calan.kaynak === "youtube" ? "yt:" : ""}${calar.calan.sanatciId}`)} className="player-track-artist block max-w-full truncate text-xs text-muted-foreground mt-1 text-left hover:underline disabled:no-underline">{calar.calan?.sanatci || "Choose a song to get started"}</button>
          </div>
          {calar.calan && <button aria-label={calar.calan.favori ? "Remove from liked songs" : "Like song"} aria-pressed={!!calar.calan.favori} onClick={() => favoriYap(calar.calan!)} title={calar.calan.favori ? "Remove from Liked Songs (L)" : "Save to Liked Songs (L)"} className={`utility-button hidden sm:inline-grid ${calar.calan.favori ? "text-primary" : "text-muted-foreground"}`}><Heart size={17} className={calar.calan.favori ? "fill-current" : ""} /></button>}
        </div>
        <div className="player-center hidden lg:block">
          <div className="flex items-center justify-center gap-3">
            <IconBtn onClick={calar.karistirDegistir} aktif={calar.karistir} baslik="Shuffle" disabled={!calar.calan}><Shuffle size={16} /></IconBtn>
            <IconBtn onClick={() => calar.atla(-1)} baslik="Previous" disabled={!calar.calan}><SkipBack size={18} /></IconBtn>
            <button aria-label={calar.oynuyor ? "Pause" : "Play"} disabled={!calar.calan} onClick={calar.oynatDurdur} className="player-main-button">
              {["preparing", "buffering"].includes(calar.durum) ? <Loader2 size={18} className="animate-spin" /> : calar.oynuyor ? <Pause size={17} className="fill-current" /> : <Play size={17} className="fill-current ml-0.5" />}
            </button>
            <IconBtn onClick={() => calar.atla(1)} baslik="Next" disabled={!calar.calan}><SkipForward size={18} /></IconBtn>
            <IconBtn onClick={calar.tekrarDegistir} aktif={calar.tekrar !== "kapali"} disabled={!calar.calan} baslik={calar.tekrar === "tek" ? "Repeat one" : calar.tekrar === "tumu" ? "Repeat all" : "Repeat off"}>{calar.tekrar === "tek" ? <Repeat1 size={16} /> : <Repeat size={16} />}</IconBtn>
          </div>
          <PlayerProgress calar={calar} />
        </div>
        <div className="player-actions">
          <button aria-label={calar.oynuyor ? "Pause" : "Play"} disabled={!calar.calan} onClick={calar.oynatDurdur} className="player-main-button lg:!hidden">
            {["preparing", "buffering"].includes(calar.durum) ? <Loader2 size={18} className="animate-spin" /> : calar.oynuyor ? <Pause size={19} className="fill-current" /> : <Play size={19} className="fill-current ml-0.5" />}
          </button>
          <span className="lg:hidden inline-flex"><IconBtn onClick={() => calar.atla(1)} baslik="Next" disabled={!calar.calan}><SkipForward size={19} /></IconBtn></span>
          <IconBtn onClick={() => setPanel(p => p === "kuyruk" ? "yok" : "kuyruk")} aktif={panel === "kuyruk"} baslik="Queue"><ListMusic size={19} /></IconBtn>
          <span className="hidden sm:inline-flex"><IconBtn aktif={panel === "cihazlar"} onClick={() => setPanel(p => p === "cihazlar" ? "yok" : "cihazlar")} baslik="Devices"><MonitorSmartphone size={18} /></IconBtn></span>
          <span className="hidden sm:inline-flex"><IconBtn disabled={!calar.calan} onClick={() => setTamEkran(true)} baslik="Open now playing"><Maximize2 size={17} /></IconBtn></span>
          <div className="volume-control hidden lg:flex items-center gap-1 w-32 pl-1"><VolumeButton calar={calar} /><Slider label="Volume" live value={calar.ses} onChange={calar.setSes} valueText={v => `${Math.round(v)}%`} /></div>
        </div>
        {calar.calan && <MiniProgress calar={calar} />}
      </footer>
      <nav aria-label="Main navigation" className="mobile-nav lg:hidden flex items-center justify-around shrink-0">
        <button aria-current={!mobilMenu && gorunum.tip === "kesfet" ? "page" : undefined} onClick={() => git({tip: "kesfet"})}><Home size={21} />Home</button>
        <button aria-current={!mobilMenu && gorunum.tip === "arama" ? "page" : undefined} onClick={() => { if (gorunum.tip !== "arama") git({tip: "arama", q: ""}); requestAnimationFrame(() => document.getElementById("arama")?.focus()); }}><Search size={21} />Search</button>
        <button aria-current={!mobilMenu && gorunum.tip === "kutuphane" ? "page" : undefined} onClick={() => git({tip: "kutuphane"})}><Library size={21} />Your library</button>
      </nav>
      {yeniListeAcik && <MusicDialog label="New playlist" onClose={() => !listeKaydediliyor && setYeniListeAcik(false)}>
        <form onSubmit={listeOlustur} className="p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4 mb-6"><div><div className="h-12 w-12 bg-primary/10 rounded-xl text-primary grid place-items-center mb-5"><ListMusic size={24} /></div><h2 className="text-2xl font-semibold tracking-tight">New playlist</h2><p className="text-sm text-muted-foreground mt-2">A mood, a moment, a place for your favorites.</p></div><button type="button" disabled={listeKaydediliyor} aria-label="Close" className="utility-button -mr-3 -mt-3 text-muted-foreground" onClick={() => setYeniListeAcik(false)}><X size={20} /></button></div>
          <label htmlFor="yeni-liste-ad" className="text-sm font-medium block mb-2">Playlist name</label><input id="yeni-liste-ad" autoFocus required maxLength={120} placeholder="e.g. Night Drive" value={yeniListeAd} onChange={e => setYeniListeAd(e.target.value)} className="form-input w-full" />
          {listeHata && <p role="alert" className="text-sm text-destructive mt-3">{listeHata}</p>}
          <div className="flex justify-end gap-3 mt-7"><button type="button" disabled={listeKaydediliyor} className="button-secondary" onClick={() => setYeniListeAcik(false)}>Cancel</button><button type="submit" disabled={!yeniListeAd.trim() || listeKaydediliyor} className="button-primary flex items-center gap-2">{listeKaydediliyor && <Loader2 size={16} className="animate-spin" />}Create playlist</button></div>
        </form>
      </MusicDialog>}
      {discovery && <MusicDialog label="Sound discovery" onClose={()=>setDiscovery(null)} className="discovery-dialog"><Suspense fallback={<DialogLoading />}><DiscoveryPanel target={discovery} onClose={()=>setDiscovery(null)} onPlay={calar.cal} onQueue={tracks=>tracks.forEach(calar.kuyrugaEkle)} onArtist={acSanatci} listeler={listeler} onSaved={kenarYenile}/></Suspense></MusicDialog>}
      {kisayollar && <MusicDialog label="Keyboard shortcuts" onClose={() => setKisayollar(false)}><ShortcutHelp onClose={() => setKisayollar(false)} /></MusicDialog>}
      {iceAktar && <Suspense fallback={null}><ImportDialog spotifyReviewJobId={iceAktar.spotifyJob} onClose={() => setIceAktar(false)} onImported={kenarYenile} onCreated={id => { setIceAktar(false); kenarYenile(); git({tip: "liste", id}); }} /></Suspense>}


    </div></DiscoveryContext.Provider></PlayerActionsContext.Provider>
  );
}

/* ---------------------------------------------------------- alt bilesenler */

function YanOge({ ikon, etiket, aktif, onClick }: {
  ikon: React.ReactNode; etiket: string; aktif?: boolean; onClick?: () => void;
}) {
  return (
    <button onClick={onClick} aria-current={aktif ? "page" : undefined}
      className={`nav-item ${aktif ? "is-active" : ""}`}>
      {ikon}<span className="font-semibold text-sm">{etiket}</span>
    </button>
  );
}

/** Only these small components re-render with the playback position. */
function PlayerProgress({calar}: {calar: Calar}) {
  const {position, duration} = useProgress(calar);
  return <div className="w-full flex items-center gap-3 text-[11px] text-muted-foreground">
    <span className="tabular-nums w-10 text-right">{sureBicim(position)}</span>
    <Slider value={position} max={duration || 1} step={0.5} onChange={v => calar.sar(duration ? v / duration * 100 : 0)} valueText={v => `${sureBicim(v)} of ${sureBicim(duration)}`} />
    <span className="tabular-nums w-10">{sureBicim(duration)}</span>
  </div>;
}
function MiniProgress({calar}: {calar: Calar}) {
  const {position, duration} = useProgress(calar);
  return <div className="mini-progress lg:hidden" aria-hidden="true"><span style={{width: `${duration ? Math.min(100, position / duration * 100) : 0}%`}} /></div>;
}
const SHORTCUTS: [string, string][] = [["Space", "Play or pause"], ["← / →", "Seek 5 seconds"], ["Shift + ← / →", "Previous / next track"], ["Shift + ↑ / ↓", "Volume up / down"], ["M", "Mute"], ["L", "Like the current song"], ["/", "Search"], ["Esc", "Close panels"], ["?", "Show shortcuts"]];
function ShortcutHelp({onClose}: {onClose: () => void}) {
  return <div className="p-6 sm:p-8">
    <div className="flex items-start justify-between gap-4 mb-5"><div><div className="h-12 w-12 bg-primary/10 rounded-xl text-primary grid place-items-center mb-5"><Keyboard size={24} /></div><h2 className="text-2xl font-semibold tracking-tight">Keyboard shortcuts</h2></div><button aria-label="Close" className="utility-button -mr-3 -mt-3 text-muted-foreground" onClick={onClose}><X size={20} /></button></div>
    <dl className="shortcut-list">{SHORTCUTS.map(([keys, label]) => <div key={keys}><dt>{label}</dt><dd>{keys.split(" ").map((k, i) => k === "+" || k === "/" ? <span key={i}> {k} </span> : <kbd key={i}>{k}</kbd>)}</dd></div>)}</dl>
  </div>;
}
function DialogLoading() { return <div role="status" className="p-10 flex items-center justify-center gap-3 text-sm text-muted-foreground"><Loader2 size={18} className="animate-spin text-primary" />Loading…</div>; }
function lastSeen(at?: string | number) {
  const minutes = at ? Math.round((Date.now() - Number(at)) / 60000) : NaN;
  return !Number.isFinite(minutes) ? "a while ago" : minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} d ago`;
}

function archiveLabel(state: string) { return ({araniyor: "Finding a match", eslesme_bekliyor: "Choose your match", indirme_baslatiliyor: "Starting download", indiriliyor: "Downloading", dogrulaniyor: "Verifying file", ice_aktariliyor: "Adding to library", hazir: "Ready in your library", basarisiz: "Failed", bulunamadi: "No match found"} as Record<string, string>)[state] || state; }

function MusicDialog({label, onClose, className = "", children}: {label: string; onClose: () => void; className?: string; children: React.ReactNode}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current, previous = document.activeElement;
    dialog?.showModal(); dialog?.querySelector<HTMLInputElement>("input, textarea")?.focus();
    return () => { dialog?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={ref} aria-label={label} className={`music-dialog ${className}`} onCancel={e => {e.preventDefault(); onClose();}} onClick={e => {if (e.target !== e.currentTarget) return; const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose();}}>{children}</dialog>;
}
