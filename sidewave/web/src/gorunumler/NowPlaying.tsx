import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowUpRight, AudioLines, ChevronDown, Clock3, EyeOff, Heart, ListMusic, Loader2, Maximize2, MicVocal, Minimize2, MonitorSmartphone, Pause, Play, Radio, Repeat, Repeat1, Route, Share2, Shuffle, SkipBack, SkipForward, Sparkles } from 'lucide-react';
import { api, kapakSrc, sureBicim, type Parca, type SanatciDetay } from '../api';
import { IconBtn, Kapak, Slider, VolumeButton } from '../bilesenler/Ortak';
import { useShareTrack } from '../bilesenler/Paylas';
import { useProgress, type useCalar } from '../useCalar';
import type { DiscoveryTarget } from '../DiscoveryContext';

type Player = ReturnType<typeof useCalar>;
type Lyrics = Awaited<ReturnType<typeof api.lyrics>>;

/** The cover's dominant colour, darkened enough for white text (like Spotify's player backdrop). */
function useDominantColor(src: string | null) {
  const [color, setColor] = useState('oklch(0.32 0.04 160)');
  useEffect(() => {
    if (!src) return;
    let active = true; const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 24;
        const ctx = canvas.getContext('2d', {willReadFrequently: true}); if (!ctx) return;
        ctx.drawImage(image, 0, 0, 24, 24);
        const data = ctx.getImageData(0, 0, 24, 24).data; let r = 0, g = 0, b = 0, w = 0;
        for (let i = 0; i < data.length; i += 4) { const max = Math.max(data[i], data[i + 1], data[i + 2]), min = Math.min(data[i], data[i + 1], data[i + 2]), weight = 1 + (max - min) / 32; r += data[i] * weight; g += data[i + 1] * weight; b += data[i + 2] * weight; w += weight; }
        const [h, s] = rgbToHsl(r / w, g / w, b / w);
        if (active) setColor(`hsl(${Math.round(h)} ${Math.round(Math.min(62, s))}% 30%)`);
      } catch { /* A cross-origin image keeps the default colour. */ }
    };
    image.src = src;
    return () => { active = false; };
  }, [src]);
  return color;
}
function rgbToHsl(r: number, g: number, b: number): [number, number] {
  r /= 255; g /= 255; b /= 255; const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  if (!d) return [0, 0];
  const s = d / (1 - Math.abs(2 * l - 1)), h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s * 100];
}

export function NowPlayingView({player: p, onClose, onFavorite, onDismiss, onArtist, onAlbum, onDiscover, onRadio, onDevices, onQueue}: {
  player: Player; onClose: () => void; onFavorite: (track: Parca) => void; onDismiss: (track: Parca) => void; onArtist: (id: string) => void; onAlbum: (id: string) => void;
  onDiscover: (target: DiscoveryTarget) => void; onRadio: () => void; onDevices: () => void; onQueue: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null), track = p.calan!, share = useShareTrack();
  const [lyricsMode, setLyricsModeState] = useState(false);
  const setLyricsMode = (on: boolean) => { setLyricsModeState(on); document.querySelector('.now-playing-layer')?.scrollTo({top: 0}); };
  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => { let active = true; setLyrics(null); if (track.appId) api.lyrics(track.appId).then(d => { if (active) setLyrics(d); }).catch(() => { if (active) setLyrics({synced: null, plain: null, instrumental: false, source: null}); }); return () => { active = false; }; }, [track.appId]);
  const color = useDominantColor(kapakSrc(track, 96));
  const prefix = track.kaynak === 'youtube' ? 'yt:' : '';
  const upcoming = p.kuyruk.slice(p.indeks + 1, p.indeks + 4);
  return <section className={`np ${lyricsMode ? 'is-lyrics' : ''}`} aria-label="Now playing" style={{'--np-color': color} as CSSProperties}>
    <div className="np-backdrop" aria-hidden="true" />
    <header className="np-top">
      <button className="utility-button" onClick={lyricsMode ? () => setLyricsMode(false) : onClose} aria-label={lyricsMode ? 'Back to player' : 'Close now playing'} title={lyricsMode ? 'Back to player' : 'Back to browsing'}><ChevronDown size={24} /></button>
      <div className="np-context"><span>PLAYING FROM YOUR QUEUE</span><strong>{p.kuyruk.length} songs{p.otomatik ? ' · Autoplay on' : ''}</strong></div>
      <button className="utility-button" onClick={() => void share(track)} aria-label="Share this song" title="Share"><Share2 size={19} /></button>
    </header>

    {lyricsMode ? <FullLyrics lyrics={lyrics} player={p} onExit={() => setLyricsMode(false)} /> : <div className="np-main">
      <div className="np-stage">
        <Kapak kaynak={track} boyut={640} eager className="np-cover" />
        <div className="np-title-row">
          <div className="min-w-0 flex-1">
            <h1 ref={heading} tabIndex={-1} className="np-title">{track.baslik}</h1>
            <button className="np-artist" disabled={!track.sanatciId} onClick={() => track.sanatciId && onArtist(prefix + track.sanatciId)}>{track.sanatci || 'Artist'}</button>
            {track.albumId && <button className="np-album" onClick={() => onAlbum(prefix + track.albumId!)}>{track.album}</button>}
          </div>
          <IconBtn aktif={!!track.favori} baslik={track.favori ? 'Remove from liked songs' : 'Like song'} onClick={() => onFavorite(track)}><Heart size={24} className={track.favori ? 'fill-current' : ''} /></IconBtn>
        </div>
        <ListeningProgress player={p} />
        <div className="np-controls" role="group" aria-label="Now playing controls">
          <IconBtn baslik="Shuffle" aktif={p.karistir} onClick={p.karistirDegistir}><Shuffle size={21} /></IconBtn>
          <IconBtn baslik="Previous" onClick={() => p.atla(-1)}><SkipBack size={27} className="fill-current" /></IconBtn>
          <button className="np-play" aria-label={p.oynuyor ? 'Pause' : 'Play'} onClick={p.oynatDurdur}>{['preparing', 'buffering'].includes(p.durum) ? <Loader2 className="animate-spin" /> : p.oynuyor ? <Pause size={30} className="fill-current" /> : <Play size={30} className="fill-current ml-1" />}</button>
          <IconBtn baslik="Next" onClick={() => p.atla(1)}><SkipForward size={27} className="fill-current" /></IconBtn>
          <IconBtn baslik="Repeat" aktif={p.tekrar !== 'kapali'} onClick={p.tekrarDegistir}>{p.tekrar === 'tek' ? <Repeat1 size={21} /> : <Repeat size={21} />}</IconBtn>
        </div>
        {p.hata && <p role="alert" className="notice notice-error mt-4">{p.hata.message}<button className="underline" onClick={p.yenidenDene}>Try again</button></p>}
        <div className="np-secondary">
          <IconBtn baslik="Devices" onClick={onDevices}><MonitorSmartphone size={19} /></IconBtn>
          <IconBtn baslik="Lyrics" aktif={lyricsMode} onClick={() => setLyricsMode(true)}><MicVocal size={19} /></IconBtn>
          <div className="np-volume"><VolumeButton calar={p} /><Slider label="Volume" live value={p.ses} onChange={p.setSes} valueText={v => `${Math.round(v)}%`} /></div>
          <IconBtn baslik="Queue" onClick={onQueue}><ListMusic size={19} /></IconBtn>
        </div>
      </div>

      <div className="np-cards">
        <LyricsCard lyrics={lyrics} player={p} onExpand={() => setLyricsMode(true)} />
        {track.sanatciId && <ArtistCard id={track.sanatciId} source={track.kaynak === 'youtube' ? 'youtube' : 'kutuphane'} fallbackName={track.sanatci} onOpen={() => onArtist(prefix + track.sanatciId)} />}
        {upcoming.length > 0 && <article className="np-card">
          <div className="np-card-head"><h2>Next in queue</h2><button onClick={onQueue}>Open queue</button></div>
          {upcoming.map((t, i) => <button key={t.queueId} className="np-next" onClick={() => p.atlaIndekse(p.indeks + 1 + i)} aria-label={`Play ${t.baslik}`}><Kapak kaynak={t} boyut={96} className="h-12 w-12 shrink-0" /><span className="min-w-0"><strong>{t.baslik}</strong><span>{t.sanatci}</span></span></button>)}
        </article>}
        <article className="np-card">
          <div className="np-card-head"><h2>Follow this sound</h2></div>
          <div className="np-discovery">
            <button onClick={() => onDiscover({parca: track, mode: 'similar-tracks'})}><AudioLines size={17} /><span>Discover similar tracks</span><ArrowUpRight size={14} /></button>
            <button onClick={() => onDiscover({parca: track, mode: 'instant-mix'})}><Sparkles size={17} /><span>Instant mix</span><ArrowUpRight size={14} /></button>
            <button onClick={() => onDiscover({parca: track, mode: 'path'})}><Route size={17} /><span>Sound journey</span><ArrowUpRight size={14} /></button>
            <button onClick={onRadio}><Radio size={17} /><span>Song radio</span><ArrowUpRight size={14} /></button>
          </div>
        </article>
        <CreditsCard track={track} />
        <article className="np-card np-settings">
          <div className="np-card-head"><h2>Playback</h2></div>
          <button aria-pressed={p.otomatik} onClick={p.otomatikDegistir}><Sparkles size={16} /><span>Autoplay</span><span className={`listening-toggle ${p.otomatik ? 'is-on' : ''}`} aria-hidden="true" /></button>
          <button aria-pressed={p.dengele} onClick={p.dengeleDegistir} title="Plays every song at a similar loudness"><AudioLines size={16} /><span>Even volume</span><span className={`listening-toggle ${p.dengele ? 'is-on' : ''}`} aria-hidden="true" /></button>
          <label className={p.gecis ? 'is-active' : ''}><Shuffle size={16} /><span className="sr-only">Crossfade</span><select aria-label="Crossfade" value={p.gecis} onChange={e => p.gecisAyarla(Number(e.target.value))}><option value={0}>Crossfade: off</option>{[3, 6, 9, 12].map(s => <option key={s} value={s}>Crossfade: {s} s</option>)}</select></label>
          <SleepTimer player={p} />
          <button onClick={() => onDismiss(track)}><EyeOff size={16} /><span>Not for me</span></button>
        </article>
      </div>
    </div>}
  </section>;
}

function ListeningProgress({player: p}: {player: Player}) {
  const {position, duration} = useProgress(p);
  return <div className="np-progress"><Slider label="Now playing position" value={position} max={duration || 1} step={0.5} onChange={v => p.sar(duration ? v / duration * 100 : 0)} valueText={v => `${sureBicim(v)} of ${sureBicim(duration)}`} /><div><span>{sureBicim(position)}</span><span>{sureBicim(duration)}</span></div></div>;
}

/** Shows the remaining time while a timer runs; the value no longer depends on render timing. */
function SleepTimer({player: p}: {player: Player}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!p.uykuZamani) return; const timer = setInterval(() => setNow(Date.now()), 15000); setNow(Date.now()); return () => clearInterval(timer); }, [p.uykuZamani]);
  const remaining = p.uykuZamani ? Math.max(1, Math.ceil((p.uykuZamani - now) / 60000)) : 0;
  return <label className={p.uykuZamani || p.uykuSonu ? 'is-active' : ''}><Clock3 size={16} /><span className="sr-only">Sleep timer</span><select aria-label="Sleep timer" value={p.uykuSonu ? -1 : p.uykuZamani ? 'on' : 0} onChange={e => p.uyku(Number(e.target.value))}>
    <option value={0}>{p.uykuZamani || p.uykuSonu ? 'Turn off timer' : 'Sleep timer'}</option>
    {p.uykuZamani && <option value="on" disabled>{remaining} min left</option>}
    <option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={45}>45 minutes</option><option value={60}>1 hour</option><option value={-1}>End of track</option>
  </select></label>;
}

function currentLine(lines: {t: number}[], position: number) { let current = -1; for (let i = 0; i < lines.length && lines[i].t <= position + 0.25; i++) current = i; return current; }

/** Lyrics preview card on the player colour; expands to full-screen lyrics. */
function LyricsCard({lyrics, player, onExpand}: {lyrics: Lyrics | null; player: Player; onExpand: () => void}) {
  const {position} = useProgress(player);
  const lines = lyrics?.synced || null, current = lines ? currentLine(lines, position) : -1;
  const from = Math.max(0, current - 1), visible = lines ? lines.slice(from, from + 5) : [];
  return <article className="np-card np-lyrics-card">
    <div className="np-card-head"><h2>Lyrics</h2>{(lines || lyrics?.plain) && <button onClick={onExpand} aria-label="Show full lyrics"><Maximize2 size={15} /></button>}</div>
    {!lyrics ? <p className="np-muted">Loading lyrics…</p> : lyrics.instrumental ? <p className="np-muted">This track is instrumental.</p>
      : lines ? <ol className="np-lyrics-preview">{visible.map((l, i) => <li key={from + i} className={from + i === current ? 'is-current' : from + i < current ? 'is-past' : ''}>{l.text || '♪'}</li>)}</ol>
      : lyrics.plain ? <p className="np-lyrics-plain">{lyrics.plain.split('\n').slice(0, 6).join('\n')}</p> : <p className="np-muted">Lyrics for this song are not here yet.</p>}
    {lyrics?.source === 'lrclib' && <p className="np-credit">Lyrics from LRCLIB</p>}
  </article>;
}

/** Full-screen synced lyrics: follows the song; selecting a line seeks there. */
function FullLyrics({lyrics, player, onExit}: {lyrics: Lyrics | null; player: Player; onExit: () => void}) {
  const {position, duration} = useProgress(player);
  const box = useRef<HTMLOListElement>(null), userScrolled = useRef(0);
  const lines = lyrics?.synced || null, current = lines ? currentLine(lines, position) : -1;
  useEffect(() => {
    if (current < 0 || Date.now() - userScrolled.current < 4000) return;
    const el = box.current?.children[current] as HTMLElement | undefined;
    if (el && box.current) box.current.scrollTo({top: el.offsetTop - box.current.clientHeight / 3, behavior: 'smooth'});
  }, [current]);
  return <div className="np-full-lyrics">
    {!lyrics ? <p className="np-muted">Loading lyrics…</p> : lines ? <ol ref={box} aria-label="Synced lyrics" onWheel={() => { userScrolled.current = Date.now(); }} onTouchMove={() => { userScrolled.current = Date.now(); }}>
      {lines.map((line, i) => <li key={i} className={i === current ? 'is-current' : i < current ? 'is-past' : ''} aria-current={i === current || undefined}><button onClick={() => duration && player.sar(line.t / duration * 100)}>{line.text || '♪'}</button></li>)}
    </ol> : <p className="np-lyrics-plain is-full">{lyrics.plain || 'Lyrics for this song are not here yet.'}</p>}
    <div className="np-full-lyrics-bar"><ListeningProgress player={player} /><button className="np-play is-small" aria-label={player.oynuyor ? 'Pause' : 'Play'} onClick={player.oynatDurdur}>{player.oynuyor ? <Pause size={22} className="fill-current" /> : <Play size={22} className="fill-current ml-0.5" />}</button><IconBtn baslik="Exit lyrics" onClick={onExit}><Minimize2 size={18} /></IconBtn></div>
  </div>;
}

const artistCache = new Map<string, SanatciDetay>();
function ArtistCard({id, source, fallbackName, onOpen}: {id: string; source: 'youtube' | 'kutuphane'; fallbackName?: string; onOpen: () => void}) {
  const [artist, setArtist] = useState<SanatciDetay | null>(artistCache.get(source + id) || null);
  useEffect(() => {
    if (artistCache.has(source + id)) { setArtist(artistCache.get(source + id)!); return; }
    let active = true; setArtist(null);
    (source === 'youtube' ? api.ytSanatci(id) : api.sanatci(id)).then(a => { artistCache.set(source + id, a); if (active) setArtist(a); }).catch(() => {});
    return () => { active = false; };
  }, [id, source]);
  const image = artist?.gorselUrl ? {gorselUrl: artist.gorselUrl} : artist?.kapakId ? {kapakId: artist.kapakId} : null;
  return <article className="np-card np-artist-card">
    <button onClick={onOpen} className="block w-full text-left" aria-label={`About the artist: ${artist?.ad || fallbackName}`}>
      {image && <div className="np-artist-image"><Kapak kaynak={image as Partial<Parca>} boyut={640} className="w-full h-full !rounded-none" /><span>About the artist</span></div>}
      <div className="p-4">{!image && <p className="np-eyebrow">ABOUT THE ARTIST</p>}<h2 className="text-lg font-bold">{artist?.ad || fallbackName}</h2>{artist?.abone && <p className="np-muted mt-1">{artist.abone}</p>}
        {artist?.biyografi && <p className="np-bio">{artist.biyografi}</p>}</div>
    </button>
  </article>;
}

function CreditsCard({track}: {track: Parca}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.trackDetail>> | null>(null);
  useEffect(() => { let active = true; setData(null); if (track.appId) api.trackDetail(track.appId).then(d => { if (active) setData(d); }).catch(() => {}); return () => { active = false; }; }, [track.appId]);
  const contributors = data?.credits?.map(c => c.ad).filter(Boolean) || [];
  return <article className="np-card">
    <div className="np-card-head"><h2>Credits</h2></div>
    <dl className="np-credits"><div><dt>{track.sanatci || 'Artist'}</dt><dd>Main artist</dd></div>
      {contributors.filter(name => name !== track.sanatci).map(name => <div key={name}><dt>{name}</dt><dd>Featured</dd></div>)}
      {track.album && <div><dt>{track.album}</dt><dd>Album</dd></div>}
      {track.sure ? <div><dt>{sureBicim(track.sure)}</dt><dd>Duration</dd></div> : null}</dl>
  </article>;
}
