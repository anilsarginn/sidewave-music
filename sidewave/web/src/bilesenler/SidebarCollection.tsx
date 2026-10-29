import { ChevronRight, Plus, Upload } from "lucide-react";
import type { Album, Liste, Parca, SanatciDetay } from "../api";
import { Kapak, ListeKapagi } from "./Ortak";

export function SidebarCollection({ history, albums, artists, playlists, loading, error, activeAlbum, activePlaylist, onAlbum, onArtist, onPlaylist, onCreate, onImport, onRetry }: {
  history: Parca[]; albums: Album[]; artists: SanatciDetay[]; playlists: Liste[];
  loading: boolean; error: string; activeAlbum?: string; activePlaylist?: string;
  onAlbum: (id: string) => void; onArtist: (id: string) => void; onPlaylist: (id: string) => void;
  onCreate: () => void; onImport: () => void; onRetry: () => void;
}) {
  const seen = new Set<string>();
  const recent = history.filter(track => {
    if (!track.albumId || !track.album) return false;
    const key = `${track.kaynak || "kutuphane"}:${track.albumId}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 4);
  const albumId = (id: string, source?: string) => `${source === "youtube" ? "yt:" : ""}${id}`;

  return <div className="sidebar-collection flex-1 min-h-0 flex flex-col">
    <div className="sidebar-collection-scroll flex-1 min-h-0 overflow-y-auto">
      <section aria-labelledby="sidebar-recent-title" className="sidebar-section">
        <div className="sidebar-section-heading"><h2 id="sidebar-recent-title">Recently played albums</h2><span className="sidebar-section-count">{recent.length || ""}</span></div>
        {loading && recent.length === 0 ? <p role="status" className="sidebar-hint">Loading your albums…</p> : recent.map(track => {
          const id = albumId(track.albumId!, track.kaynak);
          const cover = track.kaynak === "youtube"
            ? track
            : { kapakId: track.kapakId || track.albumId };
          return <CollectionRow key={id} title={track.album!} subtitle={track.sanatci || "Album"} active={activeAlbum === id} onClick={() => onAlbum(id)} artwork={<Kapak kaynak={cover} boyut={96} className="h-11 w-11" />} />;
        })}
        {!loading && !recent.length && !error && <p className="sidebar-hint">Your recent albums will appear here.</p>}
      </section>

      <section aria-labelledby="sidebar-playlists-title" className="sidebar-section">
        <div className="sidebar-section-heading"><h2 id="sidebar-playlists-title">Your playlists</h2><button className="sidebar-add" title="New playlist" aria-label="New playlist" onClick={onCreate}><Plus size={17} /></button></div>
        {playlists.map(playlist => <CollectionRow key={playlist.id} title={playlist.ad} subtitle={`${playlist.parcaSayisi ?? 0} tracks`} active={activePlaylist === playlist.id} onClick={() => onPlaylist(playlist.id)} artwork={<span className="block h-11 w-11 overflow-hidden rounded-lg"><ListeKapagi liste={playlist} boyut={96} className="w-full h-full" /></span>} />)}
        {!loading && !playlists.length && <div className="sidebar-hint"><p>Bring your favorite songs together.</p><button onClick={onCreate} className="sidebar-text-action">Create your first playlist <Plus size={13} /></button></div>}
        <button onClick={onImport} className="sidebar-import"><Upload size={14} /><span>Import playlist</span></button>
      </section>

      {albums.length > 0 && <section aria-labelledby="sidebar-saved-title" className="sidebar-section"><div className="sidebar-section-heading"><h2 id="sidebar-saved-title">Saved albums</h2></div>{albums.map(album => {
        const id = albumId(album.id, album.kaynak);
        return <CollectionRow key={id} title={album.ad} subtitle={album.sanatci || "Album"} active={activeAlbum === id} onClick={() => onAlbum(id)} artwork={<Kapak kaynak={album} boyut={96} className="h-11 w-11" />} />;
      })}</section>}
      {artists.length > 0 && <section aria-labelledby="sidebar-artists-title" className="sidebar-section"><div className="sidebar-section-heading"><h2 id="sidebar-artists-title">Following</h2></div>{artists.filter(artist => artist.id).map(artist => <CollectionRow key={`${artist.kaynak}:${artist.id}`} title={artist.ad} subtitle="Artist" onClick={() => onArtist(albumId(artist.id!, artist.kaynak))} artwork={<Kapak kaynak={artist} boyut={96} yuvarlak className="h-11 w-11" />} />)}</section>}
      {error && <p role="alert" className="sidebar-hint text-destructive">{error}<button className="sidebar-text-action" onClick={onRetry}>Try again</button></p>}
    </div>
  </div>;
}

function CollectionRow({ title, subtitle, artwork, active, onClick }: { title: string; subtitle: string; artwork: React.ReactNode; active?: boolean; onClick: () => void }) {
  return <button onClick={onClick} aria-current={active ? "page" : undefined} title={title} className={`sidebar-collection-row ${active ? "is-current" : ""}`}>
    <span className="shrink-0">{artwork}</span><span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{title}</span><span className="block truncate text-[11px] text-muted-foreground mt-1">{subtitle}</span></span><ChevronRight size={14} className="sidebar-row-arrow shrink-0" />
  </button>;
}
