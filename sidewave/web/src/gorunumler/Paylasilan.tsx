import { useEffect, useRef, useState } from "react";
import { Check, Copy, Link2, Loader2, Play, Plus, Share2, Shuffle, Users, X } from "lucide-react";
import { api, uzunSure, type Liste, type Parca } from "../api";
import { ListeKapagi, ParcaTablosu, SayfaHero } from "../bilesenler/Ortak";
import { usePlayerActions } from "../PlayerActions";
import { useToast } from "../bilesenler/Toast";

const cover = (tracks: Parca[]) => { const out: Partial<Parca>[] = [], seen = new Set<string>(); for (const t of tracks) { const k = t.albumId || t.kapakId || t.kapakUrl || t.id; if (!seen.has(k)) { seen.add(k); out.push(t); } if (out.length === 4) break; } return out; };

/** A playlist someone shared with you: listen, follow, save a copy, and (with an edit link) add or remove songs. */
export function PaylasilanGorunum({ token, calan, onCal, onSanatciId, onAlbumId, onFavori, listeler, onListeYenile, onOwn, onSaved }: {
  token: string; calan: Parca | null; onCal: (p: Parca, l: Parca[]) => void; onSanatciId: (id: string) => void; onAlbumId: (id: string) => void;
  onFavori: (p: Parca) => void; listeler: Liste[]; onListeYenile: () => void; onOwn: (id: string) => void; onSaved: (id: string) => void;
}) {
  const actions = usePlayerActions(), toast = useToast();
  const [d, setD] = useState<Awaited<ReturnType<typeof api.shared>> | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [version, setVersion] = useState(0);
  useEffect(() => { let active = true; api.shared(token).then(r => { if (!active) return; if (r.mine) onOwn(r.id); else setD(r); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [token, version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div role={error ? "alert" : "status"} className="empty-state">{error ? <><Link2 size={32} /><h2>This link isn’t available</h2><p>{error}</p></> : <><Loader2 size={28} className="animate-spin" /><h2>Opening shared playlist…</h2></>}</div>;
  const p = d.parcalar, total = p.reduce((n, t) => n + (t.sure || 0), 0), edit = d.mode === "edit";
  async function follow() { setBusy(true); try { const r = await api.sharedFollow(token, !d!.following); setD(x => x && {...x, following: r.following}); onListeYenile(); toast(r.following ? "Added to Your Library." : "Removed from Your Library."); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function save() { setBusy(true); try { const r = await api.sharedSave(token); onListeYenile(); toast("Saved a copy to Your Library.", {label: "Open", onClick: () => onSaved(r.id)}); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function remove(index: number) { const entry = p[index]?.entryId; if (!entry) return; try { await api.sharedRemove(token, entry); setVersion(n => n + 1); onListeYenile(); } catch (e) { setError((e as Error).message); } }
  return <>
    <SayfaHero ust={edit ? "Collaborative playlist" : "Shared playlist"} baslik={d.ad} kapak={<ListeKapagi liste={{kapaklar: cover(p)}} boyut={512} className="w-full h-full" />}
      alt={<span>by {d.owner} · {p.length} tracks{total ? ` · ${uzunSure(total)}` : ""}{edit ? " · you can add songs from any song’s menu once it’s in Your Library" : ""}</span>}
      eylemler={<>
        {p.length > 0 && <button onClick={() => onCal(p[0], p)} className="min-h-12 px-6 rounded-full bg-primary text-primary-foreground font-semibold inline-flex items-center gap-2"><Play size={18} className="fill-current" /> Play</button>}
        {p.length > 1 && <button onClick={() => actions?.shuffleAll(p)} className="min-h-12 px-5 rounded-full border border-border font-medium inline-flex items-center gap-2 hover:bg-white/5"><Shuffle size={17} /> Shuffle</button>}
        <button disabled={busy} onClick={() => void follow()} aria-pressed={d.following} className={`min-h-12 px-5 rounded-full border border-border font-medium inline-flex items-center gap-2 hover:bg-white/5 ${d.following ? "text-primary" : ""}`}>{d.following ? <Check size={17} /> : <Plus size={17} />}{d.following ? "In Your Library" : "Add to Your Library"}</button>
        <button disabled={busy || !p.length} onClick={() => void save()} className="min-h-12 px-5 rounded-full border border-border font-medium inline-flex items-center gap-2 hover:bg-white/5"><Copy size={16} /> Save a copy</button>
      </>} />
    {error && <p role="alert" className="notice notice-error mb-5">{error}</p>}
    {p.length ? <section className="music-section" aria-label="Shared playlist tracks"><ParcaTablosu parcalar={p} calan={calan} onCal={onCal}
      onSanatci={t => t.sanatciId && onSanatciId(`${t.kaynak === "youtube" ? "yt:" : ""}${t.sanatciId}`)} onAlbum={t => t.albumId && onAlbumId(`${t.kaynak === "youtube" ? "yt:" : ""}${t.albumId}`)}
      onFavori={onFavori} listeler={listeler} onListeYenile={onListeYenile} onCikar={edit ? remove : undefined} /></section>
      : <div className="empty-state"><Users size={30} /><h2>No songs yet</h2><p>{edit ? "Add this playlist to Your Library, then add songs from any song’s menu." : "Songs added by the owner will appear here."}</p></div>}
  </>;
}

/** Owner's share dialog: one link to listen, one to collaborate; each can be copied or turned off. */
export function PaylasDialog({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null), toast = useToast();
  const [links, setLinks] = useState<{view?: string; edit?: string}>({}), [busy, setBusy] = useState<string | null>(null), [error, setError] = useState("");
  useEffect(() => { const el = ref.current!; el.showModal(); api.shareLinks(id).then(r => setLinks(Object.fromEntries(r.links.map(l => [l.mode, l.url])))).catch(e => setError(e.message)); return () => el.close(); }, [id]);
  async function create(mode: "view" | "edit") { setBusy(mode); setError(""); try { const r = await api.shareCreate(id, mode); setLinks(x => ({...x, [mode]: r.url})); await copy(r.url); } catch (e) { setError((e as Error).message); } finally { setBusy(null); } }
  async function revoke(mode: "view" | "edit") { setBusy(mode); try { await api.shareRevoke(id, mode); setLinks(x => ({...x, [mode]: undefined})); toast("Link turned off."); } catch (e) { setError((e as Error).message); } finally { setBusy(null); } }
  async function copy(url: string) {
    if (navigator.share && matchMedia("(pointer:coarse)").matches) { try { await navigator.share({title: name, url}); return; } catch { /* Fall back to copying. */ } }
    try { await navigator.clipboard.writeText(url); toast("Link copied."); } catch { setError("Copy the link: " + url); }
  }
  const row = (mode: "view" | "edit", title: string, text: string) => <div className="rounded-xl border border-border p-4">
    <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">{mode === "view" ? <Link2 size={18} /> : <Users size={18} />}</span>
      <div className="min-w-0 flex-1"><p className="font-semibold text-sm">{title}</p><p className="text-xs text-muted-foreground mt-1 leading-5">{text}</p>{links[mode] && <p className="mt-2 truncate text-xs text-muted-foreground">{links[mode]}</p>}</div></div>
    <div className="mt-3 flex flex-wrap gap-2 justify-end">
      {links[mode] ? <><button onClick={() => void revoke(mode)} disabled={busy !== null} className="min-h-10 px-4 rounded-full text-sm text-muted-foreground hover:text-destructive">Turn off</button><button onClick={() => void copy(links[mode]!)} className="min-h-10 px-4 rounded-full border border-border text-sm font-medium inline-flex items-center gap-2"><Copy size={15} />Copy link</button></>
        : <button onClick={() => void create(mode)} disabled={busy !== null} className="min-h-10 px-4 rounded-full bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2">{busy === mode ? <Loader2 size={15} className="animate-spin" /> : <Share2 size={15} />}Create link</button>}
    </div>
  </div>;
  return <dialog ref={ref} aria-label="Share playlist" onCancel={e => { e.preventDefault(); onClose(); }} className="music-dialog m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-border bg-popover p-6 text-foreground shadow-2xl backdrop:bg-black/75">
    <div className="flex items-start justify-between gap-4 mb-4"><div><h2 className="text-xl font-semibold tracking-tight">Share “{name}”</h2><p className="text-sm text-muted-foreground mt-1">People need a Sidewave account to open these links.</p></div><button aria-label="Close" onClick={onClose} className="utility-button -mr-2 -mt-2 text-muted-foreground"><X size={20} /></button></div>
    <div className="space-y-3">
      {row("view", "Anyone with the link can listen", "They can play it, add it to their library and save a copy. Your changes show up for them.")}
      {row("edit", "Collaborators can add songs", "They can add and remove songs. Share this link only with people you trust.")}
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-destructive break-words">{error}</p>}
  </dialog>;
}
