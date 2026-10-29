import { useEffect, useState } from "react";
import { BarChart3, Loader2, Play } from "lucide-react";
import { api, type Parca } from "../api";
import { Kapak } from "../bilesenler/Ortak";

type Range = "4w" | "6m" | "all";
const RANGES: [Range, string][] = [["4w", "Last 4 weeks"], ["6m", "Last 6 months"], ["all", "All time"]];
const fmt = (n: number) => n.toLocaleString("en");

/** Your listening, Wrapped-style: Sidewave plays and imported Spotify history together. */
export function IstatistikGorunum({ onCal, onSanatciAra }: { onCal: (p: Parca, list: Parca[]) => void; onSanatciAra: (artist: string) => void }) {
  const [range, setRange] = useState<Range>("4w");
  const [data, setData] = useState<Awaited<ReturnType<typeof api.stats>> | null>(null), [error, setError] = useState("");
  useEffect(() => { let active = true; setData(null); setError(""); api.stats(range).then(d => { if (active) setData(d); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [range]);
  const playable = data?.topTracks.filter(t => t.playable).map(t => t.track) || [];
  return <section className="stats-page" aria-labelledby="stats-title">
    <header className="mb-6"><p className="eyebrow mb-2">YOUR LISTENING</p><h1 id="stats-title" className="text-3xl font-bold tracking-tight">Your stats</h1>
      <p className="text-sm text-muted-foreground mt-2">From what you play here{data?.sources.spotify ? " and your imported Spotify history" : ""}.</p></header>
    <div className="flex flex-wrap gap-2 mb-7" aria-label="Time range">{RANGES.map(([key, label]) => <button key={key} aria-pressed={range === key} onClick={() => setRange(key)} className={`filter-chip ${range === key ? "is-selected" : ""}`}>{label}</button>)}</div>
    {error ? <p role="alert" className="notice notice-error">{error}</p> : !data ? <div role="status" className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" />Counting your plays…</div>
      : data.minutes === 0 ? <div className="empty-state"><BarChart3 size={32} /><h2>Nothing to count yet</h2><p>Listen for a while, or import your Spotify listening history, and your stats will appear here.</p></div> : <>
      <div className="stats-tiles">
        <div className="stat-tile"><span className="stat-value">{fmt(data.minutes)}</span><span className="stat-label">minutes listened</span></div>
        <div className="stat-tile"><span className="stat-value">{fmt(data.plays)}</span><span className="stat-label">plays</span></div>
        <div className="stat-tile"><span className="stat-value">{fmt(data.artists)}</span><span className="stat-label">artists</span></div>
      </div>

      <h2 className="text-xl font-semibold tracking-tight mt-10 mb-4">Top artists</h2>
      <ol className="stats-artists">{data.topArtists.map((a, i) => <li key={a.artist}><button onClick={() => onSanatciAra(a.artist)} className="stats-artist" aria-label={`${i + 1}. ${a.artist}, ${fmt(a.minutes)} minutes`}>
        <span className="stats-artist-art"><Kapak kaynak={a.kapak || {}} boyut={200} yuvarlak className="w-full h-full" /><span className="stats-rank" aria-hidden="true">{i + 1}</span></span>
        <span className="block truncate font-semibold text-sm mt-2">{a.artist}</span><span className="block text-xs text-muted-foreground mt-0.5">{fmt(a.minutes)} min · {fmt(a.plays)} plays</span>
      </button></li>)}</ol>

      <h2 className="text-xl font-semibold tracking-tight mt-10 mb-3">Top songs</h2>
      <ol className="stats-tracks">{data.topTracks.map((t, i) => <li key={t.track.appId || t.track.id} className="stats-track">
        <span className="w-6 text-right text-sm tabular-nums text-muted-foreground">{i + 1}</span>
        <Kapak kaynak={t.track} boyut={96} className="h-11 w-11 shrink-0" />
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{t.track.baslik}</span><span className="block truncate text-xs text-muted-foreground">{t.track.sanatci}</span></span>
        <span className="text-xs tabular-nums text-muted-foreground shrink-0">{fmt(t.plays)} plays</span>
        {t.playable ? <button aria-label={`Play ${t.track.baslik}`} onClick={() => onCal(t.track, playable)} className="music-row-action h-11 w-11 grid place-items-center rounded-full text-muted-foreground hover:text-foreground"><Play size={16} className="fill-current" /></button> : <span className="w-11" aria-hidden="true" />}
      </li>)}</ol>

      <HourChart hours={data.hours} />
      {data.sources.spotify > 0 && <p className="text-xs text-muted-foreground mt-8">{fmt(data.sources.sidewave)} minutes on Sidewave · {fmt(data.sources.spotify)} minutes from Spotify history</p>}
    </>}
  </section>;
}

/** Minutes by hour of day (Istanbul): one series, one hue, hover values and a table for screen readers. */
function HourChart({ hours }: { hours: number[] }) {
  const max = Math.max(1, ...hours), peak = hours.indexOf(Math.max(...hours));
  const label = (h: number) => `${String(h).padStart(2, "0")}:00`;
  return <figure className="mt-10" aria-labelledby="hours-title">
    <figcaption><h2 id="hours-title" className="text-xl font-semibold tracking-tight">When you listen</h2><p className="text-xs text-muted-foreground mt-1">Minutes by hour of day · most around {label(peak)}</p></figcaption>
    <div className="hour-chart" role="img" aria-label={`Listening peaks around ${label(peak)}`}>
      {hours.map((m, h) => <div key={h} className="hour-col" tabIndex={0} aria-label={`${label(h)}: ${m} minutes`}>
        <span className="hour-bar" style={{height: `${Math.max(m ? 2 : 0, m / max * 100)}%`}} />
        <span className="hour-tip" role="tooltip">{label(h)} · {m} min</span>
      </div>)}
    </div>
    <div className="hour-axis" aria-hidden="true">{[0, 6, 12, 18].map(h => <span key={h} style={{left: `${h / 24 * 100}%`}}>{label(h)}</span>)}</div>
    <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer min-h-9">Show as table</summary>
      <table className="mt-2 w-full max-w-xs"><thead><tr><th className="text-left font-medium">Hour</th><th className="text-right font-medium">Minutes</th></tr></thead><tbody>{hours.map((m, h) => <tr key={h}><td>{label(h)}</td><td className="text-right tabular-nums">{m}</td></tr>)}</tbody></table>
    </details>
  </figure>;
}
