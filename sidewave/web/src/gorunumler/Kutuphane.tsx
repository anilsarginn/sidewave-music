import { useMemo, useState } from "react";
import { Heart, LayoutGrid, List, Plus, Search, Upload, Library } from "lucide-react";
import type { Album, Liste, Parca, SanatciDetay } from "../api";
import { Kapak, ListeKapagi } from "../bilesenler/Ortak";

type Kind = "playlist" | "album" | "artist";
type Item = { key: string; kind: Kind; title: string; subtitle: string; art: React.ReactNode; round?: boolean; order: number; pinned?: boolean; open: () => void };
const VIEW_KEY = "sidewave-library-view";
const songs = (n: number) => `${n} ${n === 1 ? "song" : "songs"}`;

/** Your Library: everything you keep, filterable by type, sortable, as a list or a grid. */
export function KutuphaneGorunum({ listeler, begeniSayisi, albumler, sanatcilar, gecmis, onLiked, onPlaylist, onAlbum, onArtist, onCreate, onImport }: {
  listeler: Liste[]; begeniSayisi: number; albumler: Album[]; sanatcilar: SanatciDetay[]; gecmis: Parca[];
  onLiked: () => void; onPlaylist: (id: string) => void; onAlbum: (id: string) => void; onArtist: (id: string) => void; onCreate: () => void; onImport: () => void;
}) {
  const [kind, setKind] = useState<Kind | "all">("all");
  const [sort, setSort] = useState<"recents" | "alpha">("recents");
  const [query, setQuery] = useState("");
  const [grid, setGrid] = useState(() => { try { return localStorage.getItem(VIEW_KEY) === "grid"; } catch { return false; } });
  const albumKey = (id: string, source?: string) => `${source === "youtube" ? "yt:" : ""}${id}`;

  const items = useMemo(() => {
    const all: Item[] = [{key: "liked", kind: "playlist", title: "Liked Songs", subtitle: `Playlist · ${songs(begeniSayisi)}`, pinned: true, order: -1, open: onLiked,
      art: <div className="library-liked-art"><Heart size={22} className="fill-current" /></div>}];
    listeler.forEach((l, i) => all.push({key: "p:" + l.id, kind: "playlist", title: l.ad, subtitle: l.owner ? `Playlist · ${l.owner}${l.mode === "edit" ? " · collaborative" : ""}` : `Playlist · ${songs(l.parcaSayisi ?? 0)}`, order: i, open: () => onPlaylist(l.id), art: <ListeKapagi liste={l} boyut={160} className="w-full h-full" />}));
    // Recently played albums count as part of your library, after the ones you saved.
    const seen = new Set<string>();
    albumler.forEach((a, i) => { const id = albumKey(a.id, a.kaynak); seen.add(id); all.push({key: "a:" + id, kind: "album", title: a.ad, subtitle: `Album · ${a.sanatci || "Saved"}`, order: 100 + i, open: () => onAlbum(id), art: <Kapak kaynak={a} boyut={160} className="w-full h-full" />}); });
    gecmis.forEach((t, i) => {
      if (!t.albumId || !t.album) return;
      const id = albumKey(t.albumId, t.kaynak); if (seen.has(id)) return; seen.add(id);
      all.push({key: "a:" + id, kind: "album", title: t.album, subtitle: `Album · ${t.sanatci || "Recently played"}`, order: 50 + i, open: () => onAlbum(id), art: <Kapak kaynak={t.kaynak === "youtube" ? t : {kapakId: t.kapakId || t.albumId}} boyut={160} className="w-full h-full" />});
    });
    sanatcilar.filter(a => a.id).forEach((a, i) => all.push({key: "r:" + a.kaynak + a.id, kind: "artist", title: a.ad, subtitle: "Artist", round: true, order: 200 + i, open: () => onArtist(albumKey(a.id!, a.kaynak)), art: <Kapak kaynak={a} boyut={160} yuvarlak className="w-full h-full" />}));
    return all;
  }, [listeler, begeniSayisi, albumler, sanatcilar, gecmis, onLiked, onPlaylist, onAlbum, onArtist]);

  const q = query.trim().toLocaleLowerCase("tr");
  const shown = items.filter(i => (kind === "all" || i.kind === kind) && (!q || i.title.toLocaleLowerCase("tr").includes(q)))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (sort === "alpha" ? a.title.localeCompare(b.title, "tr") : a.order - b.order));
  const setView = (value: boolean) => { setGrid(value); try { localStorage.setItem(VIEW_KEY, value ? "grid" : "list"); } catch { /* Optional. */ } };

  return <section className="library-page" aria-labelledby="library-title">
    <header className="flex flex-wrap items-center gap-3 mb-6">
      <div className="flex-1 min-w-0"><p className="eyebrow mb-2">YOUR COLLECTION</p><h1 id="library-title" className="text-3xl font-bold tracking-tight">Your Library</h1></div>
      <button className="button-secondary inline-flex items-center gap-2 text-sm" onClick={onImport}><Upload size={16} />Import</button>
      <button className="button-primary inline-flex items-center gap-2 text-sm" onClick={onCreate}><Plus size={16} />New playlist</button>
    </header>
    <div className="flex flex-wrap gap-2 mb-4" aria-label="Show">
      {([["all", "All"], ["playlist", "Playlists"], ["album", "Albums"], ["artist", "Artists"]] as const).map(([key, label]) => <button key={key} aria-pressed={kind === key} onClick={() => setKind(key)} className={`filter-chip ${kind === key ? "is-selected" : ""}`}>{label}</button>)}
    </div>
    <div className="flex flex-wrap items-center gap-2 mb-5">
      <label className="relative flex-1 min-w-48"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" /><input aria-label="Search in Your Library" placeholder="Search in Your Library" value={query} onChange={e => setQuery(e.target.value)} className="min-h-11 w-full rounded-lg bg-secondary pl-9 pr-3 text-sm" /></label>
      <select aria-label="Sort by" value={sort} onChange={e => setSort(e.target.value as "recents" | "alpha")} className="min-h-11 rounded-lg bg-secondary px-3 text-sm"><option value="recents">Recents</option><option value="alpha">Alphabetical</option></select>
      <div className="flex rounded-lg bg-secondary p-1" role="group" aria-label="View">
        <button aria-pressed={!grid} aria-label="List view" onClick={() => setView(false)} className={`library-view-toggle ${!grid ? "is-selected" : ""}`}><List size={16} /></button>
        <button aria-pressed={grid} aria-label="Grid view" onClick={() => setView(true)} className={`library-view-toggle ${grid ? "is-selected" : ""}`}><LayoutGrid size={16} /></button>
      </div>
    </div>
    {shown.length === 0 ? <div className="empty-state"><Library size={32} /><h2>{q ? "Nothing matches your search." : "Nothing here yet."}</h2><p>{q ? "Try another name." : "Save albums, follow artists and create playlists. They will appear here."}</p></div>
      : <ul className={grid ? "library-grid" : "library-list"}>
        {shown.map(item => <li key={item.key}><button onClick={item.open} className="library-item" aria-label={`${item.title}, ${item.subtitle}`}>
          <span className={`library-art ${item.round ? "is-round" : ""}`}>{item.art}</span>
          <span className="min-w-0 flex-1"><span className="library-title">{item.title}</span><span className="library-subtitle">{item.subtitle}</span></span>
        </button></li>)}
      </ul>}
  </section>;
}
