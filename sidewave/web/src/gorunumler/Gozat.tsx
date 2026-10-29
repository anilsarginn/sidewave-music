import { useEffect, useState } from "react";
import { Heart, Radio, Search, X } from "lucide-react";
import { api, kapakSrc, type Collection, type Mix } from "../api";

/** Search landing page: recent searches and colourful cards to browse by mood, genre and mix. */
export function GozatGorunum({ recent, onSearch, onRemoveRecent, onCollection, onWeekly, onLiked, onMix }: {
  recent: string[]; onSearch: (q: string) => void; onRemoveRecent: (q: string) => void;
  onCollection: (id: string) => void; onWeekly: () => void; onLiked: () => void; onMix: (id: string) => void;
}) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [mixes, setMixes] = useState<Mix[]>([]);
  useEffect(() => {
    let active = true;
    api.collections().then(d => { if (active) setCollections(d.listeler || []); }).catch(() => { /* Cards are optional. */ });
    api.mixes().then(d => { if (active) setMixes(d.mixes || []); }).catch(() => { /* Cards are optional. */ });
    return () => { active = false; };
  }, []);
  const cards: {key: string; title: string; color: string; icon?: React.ReactNode; image?: string; open: () => void}[] = [
    {key: "weekly", title: "Discover Weekly", color: "#477d95", icon: <Radio size={34} />, open: onWeekly},
    {key: "liked", title: "Liked Songs", color: "#5b3fd1", icon: <Heart size={34} className="fill-current" />, open: onLiked},
    ...mixes.map(m => ({key: m.id, title: m.ad, color: m.renk, image: m.kapak ? kapakSrc(m.kapak, 300) || undefined : undefined, open: () => onMix(m.id)})),
    ...collections.map(c => ({key: c.id, title: c.tur || c.ad, color: c.renk || "#1e3264", image: c.kapak, open: () => onCollection(c.id)})),
  ];
  return <section className="browse-page" aria-labelledby="browse-title">
    {recent.length > 0 && <div className="mb-9">
      <h2 className="text-xl font-semibold tracking-tight mb-3">Recent searches</h2>
      <div className="flex flex-wrap gap-2">{recent.map(q => <span key={q} className="recent-chip"><button onClick={() => onSearch(q)}><Search size={14} />{q}</button><button aria-label={`Remove ${q}`} onClick={() => onRemoveRecent(q)}><X size={14} /></button></span>)}</div>
    </div>}
    <h1 id="browse-title" className="text-xl font-semibold tracking-tight mb-4">Browse all</h1>
    <div className="browse-grid">{cards.map(card => <button key={card.key} className="browse-card" style={{"--browse-color": card.color} as React.CSSProperties} onClick={card.open}>
      <span className="browse-card-title">{card.title}</span>
      {card.image ? <img src={card.image} alt="" loading="lazy" className="browse-card-art" /> : card.icon && <span className="browse-card-icon" aria-hidden="true">{card.icon}</span>}
    </button>)}</div>
  </section>;
}
