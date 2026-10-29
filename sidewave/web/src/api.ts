/* Paylasilan tipler ve API sarmalayicilari. */
import type { ParcaContract, SpotifyImportJobContract, SpotifyImportPageContract, MemberContract, EditorialCollectionContract, HomeIntroResponseContract } from "./generated/models";

export type Parca = Partial<ParcaContract> & {
  id: string;
  entryId?: string;
  /** Inserted by Smart Shuffle; shown as 'Recommended' in the queue. */
  oneri?: boolean;
  appId?: string;
  baslik: string;
  sanatci?: string;
  album?: string | null;
  sure?: number | null;
  parcaNo?: number;
  disk?: number;
  yil?: number;
  bicim?: string;
  bitrate?: number;
  kapakId?: string;
  kapak?: string;
  kapakUrl?: string;
  sanatciId?: string;
  albumId?: string;
  favori?: boolean;
  kaynak?: "kutuphane" | "youtube";
  gerekce?: string;
};

export type Album = {
  id: string; appId?: string; kayitli?: boolean; warning?: string; ad: string; sanatci?: string; sanatciId?: string;
  yil?: number; parcaSayisi?: number; kapak?: string; kaynak?: "kutuphane" | "youtube"; tur?: "album" | "single";
};

export type AlbumDetay = Album & {
  kapakId?: string; toplamSure?: number; favori?: boolean; parcalar: Parca[];
};

export type SanatciDetay = {
  id?: string; appId?: string; takip?: boolean; warning?: string; diskografiTam?: boolean; ad: string; abone?: string; biyografi?: string | null;
  gorselUrl?: string | null; kapakId?: string;
  albumler: Album[]; enCokDinlenen: Parca[]; parcalar?: Parca[]; parcaBasligi?: string; catalogWarning?: string;
  benzer?: { id: string; ad: string }[];
  kaynak?: "kutuphane" | "youtube";
};

export type SonicResult={analysis?:{id:string;state:string;completed:number;total:number;failed:number;message:string};state?:string;message?:string|null;method?:string;parcalar?:Parca[];matches?:{parca:Parca;similarity:number|null;method?:string}[];sanatcilar?:{id:string;appId?:string;ad:string}[]};
export type Liste = { id: string; ad: string; parcaSayisi?: number; sure?: number; kapaklar?: Partial<Parca>[]; olusturuldu?: number; token?: string; mode?: "view" | "edit"; owner?: string };
export type SpotifyHistorySummary = {plays: number; hours: number; identified: number; first: number | null; last: number | null; topArtists: {artist: string; hours: number; plays: number}[]};
export type SpotifyHistoryResult = {added: number; addedHours: number; identified: number; unidentifiedTracks: number; onRepeat: number; terms: number; needsNames: boolean; total: {plays: number; hours: number; identified: number}};
export type Mix = { id: string; ad: string; altyazi: string; renk: string; kapak?: Parca; parcaSayisi: number; parcalar?: Parca[] };
export type AppearanceState = { wallpaperUrl: string | null; dim: number; transparency: number; configured: boolean; revision?: string };
export type Indirme = {
  id: string; dosyaAdi: string; durum: string;
  bitti: boolean; hatali: boolean; yuzde: number; message?: string;
};
export type TrendSanatci = {
  ad: string; browseId?: string; abone?: string;
  sira?: number; trend?: string; kapak?: string;
};

/* ------------------------------------------------------------- yardimcilar */

export const sureBicim = (sn?: number | null) => {
  if (sn == null) return "—";
  const d = Math.floor(sn / 60);
  const s = Math.floor(sn % 60);
  return `${d}:${String(s).padStart(2, "0")}`;
};

export function uzunSure(sn?: number | null) {
  if (!sn) return "";
  const sa = Math.floor(sn / 3600);
  const dk = Math.round((sn % 3600) / 60);
  return sa ? `${sa} hr ${dk} min` : `${dk} min`;
}

/** Kutuphane kapagi Navidrome'dan, YouTube kapagi proxy uzerinden. */
export function kapakSrc(p: Partial<Parca & Album & { gorselUrl?: string }>, boyut = 300): string | null {
  if (p.kapakId) return `/api/cover/${encodeURIComponent(p.kapakId)}?size=${boyut}`;
  const uzak = (p as any).kapakUrl || (p as any).kapak || (p as any).gorselUrl;
  if (uzak) {
    let artwork = uzak;
    try {
      const url = new URL(uzak);
      // Ask the image service for the displayed size instead of enlarging a
      // search-result thumbnail. Keep the recording, crop and format intact.
      if (/(^|\.)(googleusercontent|ggpht)\.com$/.test(url.hostname)) {
        const size = Number.isFinite(boyut) ? Math.max(64, Math.min(1200, Math.round(boyut))) : 300;
        url.pathname = url.pathname.replace(/=w\d+-h\d+(?=-|$)/, `=w${size}-h${size}`).replace(/=s\d+(?=-|$)/, `=s${size}`);
        artwork = url.href;
      }
    } catch { /* Preserve metadata URLs for the image proxy to validate. */ }
    return "/api/yt/kapak?u=" + encodeURIComponent(artwork);
  }
  // Imported/history tracks can have a valid recording ID without artwork metadata.
  if (p.kaynak === "youtube" && p.id && /^[A-Za-z0-9_-]{11}$/.test(p.id)) {
    return "/api/yt/kapak?u=" + encodeURIComponent(`https://i.ytimg.com/vi/${p.id}/hqdefault.jpg`);
  }
  if ((p as any).id && (p as any).kaynak !== "youtube") {
    return `/api/cover/${encodeURIComponent((p as any).id)}?size=${boyut}`;
  }
  return null;
}

export function akisUrl(p: Parca): string {
  return p.kaynak === "kutuphane"
    ? `/api/stream/${encodeURIComponent(p.id)}`
    : `/api/yt/akis/${encodeURIComponent(p.id)}`;
}

/* ------------------------------------------------------------------ istek */

export class ApiError extends Error {
  constructor(message: string, public code: string, public retryable: boolean, public requestId?: string) { super(message); }
}
let authenticatedMemberId: string | null = null;
const intentSeen = new Map<string, number>();
export function setAuthenticatedMember(id: string | null) { authenticatedMemberId = id; }
async function request<T>(u: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if(authenticatedMemberId && !u.startsWith("/api/auth/")) headers.set("X-Sidewave-Member",authenticatedMemberId);
  const response = await fetch(u, {...options,headers});
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if(body.code==="SESSION_CHANGED") window.dispatchEvent(new Event("sidewave-account-changed"));
    if(response.status===401 && !u.startsWith("/api/auth/")) window.dispatchEvent(new Event("sidewave-session-expired"));
    const e = body.error || body;
    throw new ApiError(e.message || e.hata || (response.status >= 500 ? "Could not connect. Please try again." : "Something went wrong."), e.code || `HTTP_${response.status}`, e.retryable ?? response.status >= 500, e.requestId);
  }
  return body;
}
const jget = <T>(u: string, signal?: AbortSignal) => request<T>(u, {signal});
const jpost = <T>(u: string, govde?: unknown, method = "POST", signal?: AbortSignal) => request<T>(u, {method, signal, headers: {"Content-Type": "application/json"}, body: govde === undefined ? undefined : JSON.stringify(govde)});
export type ImportPreview = {rows: ImportRow[]; duplicates: number; jobId?: string; pending?: boolean; completed?: number; total?: number};
export type ImportRow = {index: number; baslik: string; sanatci?: string; status: string; candidates: Parca[]; selected: Parca | null};
export type SpotifyImportJob = SpotifyImportJobContract;
export type SpotifyImportPage = SpotifyImportPageContract;
export type ArchiveJob = {id: string; durum: string; mesaj?: string; parca: Parca; candidates?: {candidateId: string; dosyaAdi: string; bicim?: string; bitrate?: number; sure?: number; kullanici?: string}[]};
export type Device = {queueRevision?: number; handoffCommandId?: string; id: string; name: string; queue: Parca[]; index: number; position: number; state: string; updatedAt?: string | number; online?: boolean};

export type Member = MemberContract;
export type Collection = Omit<EditorialCollectionContract,"parcalar"> & {parcalar?:Parca[]};
export type HomeIntro = HomeIntroResponseContract;
export const api = {
  homeIntro: (visitId:string) => jpost<HomeIntro>("/api/v1/home/intro",{visitId}),
  me: () => jget<{user:Member|null;firstAccount?:boolean}>("/api/auth/me"),
  authenticate: (mode:'login'|'signup',username:string,password:string) => jpost<{user:Member}>("/api/auth/"+mode,{username,password}),
  logout: () => jpost<{ok:boolean}>("/api/auth/logout",{}),
  collections: () => jget<{listeler:Collection[]}>("/api/v1/collections"),
  collection: (id:string) => jget<Collection>("/api/v1/collections/"+encodeURIComponent(id)),
  weekly: () => jget<Collection>("/api/v1/discovery/weekly"),
  appearance: () => jget<AppearanceState>("/api/v1/appearance"),
  saveAppearance: (settings: {dim: number; transparency: number}) => jpost<AppearanceState>("/api/v1/appearance", settings, "PATCH"),
  uploadWallpaper: (blob: Blob, settings: {dim: number; transparency: number}) => request<AppearanceState>(`/api/v1/appearance/wallpaper?${new URLSearchParams({dim:String(settings.dim),transparency:String(settings.transparency)})}`, {method:"PUT", headers:{"Content-Type":"image/jpeg"}, body:blob}),
  removeWallpaper: () => request<AppearanceState>("/api/v1/appearance/wallpaper", {method:"DELETE"}),
  spotifyJobs: () => jget<{jobs:SpotifyImportJob[]}>("/api/v1/import/spotify/jobs"),
  spotifyJob: (id:string) => jget<SpotifyImportJob>(`/api/v1/import/spotify/jobs/${encodeURIComponent(id)}`),
  spotifyHistory: () => jget<SpotifyHistorySummary>("/api/v1/import/spotify/history"),
  spotifyHistoryUpload: (file: File) => request<SpotifyHistoryResult>("/api/v1/import/spotify/history", {method: "POST", headers: {"Content-Type": "application/zip"}, body: file}),
  spotifyUpload: (file:File,label:string) => request<SpotifyImportJob>(`/api/v1/import/spotify/upload?${new URLSearchParams({label,fileName:file.name})}`,{method:'POST',headers:{'Content-Type':file.name.toLowerCase().endsWith('.zip')?'application/zip':file.name.toLowerCase().endsWith('.csv')?'text/csv':'application/json'},body:file}),
  spotifyFavoritesFile: (id:string,collectionId:string|null) => jpost<SpotifyImportJob>(`/api/v1/import/spotify/jobs/${encodeURIComponent(id)}/favorites-file`,{collectionId},'PATCH'),
  spotifyRows: (id:string,collectionId:string,filter:string,offset:number) => jget<SpotifyImportPage>(`/api/v1/import/spotify/jobs/${encodeURIComponent(id)}/rows?${new URLSearchParams({collectionId,filter,offset:String(offset)})}`),
  spotifyPause: (id:string) => jpost<SpotifyImportJob>(`/api/v1/import/spotify/jobs/${encodeURIComponent(id)}/pause`),
  spotifyResume: (id:string,retry:boolean) => jpost<SpotifyImportJob>(`/api/v1/import/spotify/jobs/${encodeURIComponent(id)}/resume`,{retry}),
  spotifyResearch: (id:string,rowId:string,query:string) => jpost<SpotifyImportJob>(`/api/v1/import/spotify/jobs/${id}/rows/${rowId}/search`,{query}),
  spotifySelect: (id:string,rowId:string,candidate:string|null) => jpost<SpotifyImportJob>(`/api/v1/import/spotify/jobs/${encodeURIComponent(id)}/rows/${encodeURIComponent(rowId)}`,{candidate},'PATCH'),
  spotifyCommit: (id:string) => jpost<SpotifyImportJob>(`/api/v1/import/spotify/jobs/${encodeURIComponent(id)}/commit`),
  sonicRefresh: () => jpost<{state:string;message?:string}>("/api/v1/discovery/analysis"),
  sonicCapabilities: (signal?:AbortSignal) => jget<{available:boolean;message:string;analysis?:{count:number|null;total:number|null;model:string}|null}>("/api/v1/discovery/capabilities",signal),
  sonicRetry: (id:string) => jpost<SonicResult>(`/api/v1/discovery/sessions/${encodeURIComponent(id)}/retry`,{}),
  sonicSession: (id:string,mix:boolean,signal:AbortSignal) => jget<SonicResult>(`/api/v1/discovery/sessions/${encodeURIComponent(id)}?mix=${mix}`,signal),
  sonicTracks: (parca:Parca,mix:boolean,signal:AbortSignal) => jpost<SonicResult>(`/api/v1/discovery/${mix?'instant-mix':'similar-tracks'}`,{parca},"POST",signal),
  sonicPath: (start:Parca,end:Parca,signal:AbortSignal) => jpost<SonicResult>("/api/v1/discovery/path",{start,end},"POST",signal),
  sonicArtists: (id:string,signal:AbortSignal) => jget<SonicResult>(`/api/v1/discovery/artists/${encodeURIComponent(id)}`,signal),
  takipYayimlari: () => jget<{items:Album[];warning?:string|null}>("/api/v1/library/releases"),
  kutuphane: () => jget<{sanatcilar: SanatciDetay[]; albumler: Album[]}>("/api/v1/library"),
  sanatciYayimlari: (id: string, type: string, offset = 0, expand = false) => jget<{items: Album[]; total: number; nextOffset: number | null; complete: boolean}>(`/api/v1/artists/${encodeURIComponent(id)}/releases?type=${type}&offset=${offset}&limit=100&expand=${expand}`),
  sanatciTakip: (id: string, takip: boolean) => jpost<SanatciDetay>(`/api/v1/artists/${encodeURIComponent(id)}/follow`, {takip}, "PUT"),
  albumKaydet: (id: string, kayitli: boolean) => jpost<AlbumDetay>(`/api/v1/albums/${encodeURIComponent(id)}/save`, {kayitli}, "PUT"),
  durum: () => jget<any>("/api/status"),
  kesfet: () => jget<{ albumler: Album[]; trendSanatcilar: TrendSanatci[]; trendParcalar: Parca[] }>("/api/kesfet"),
  oneriler: () => jget<{ parcalar: Parca[] }>("/api/v1/recommendations"),
  oneriGizle: (parca: Parca, scope: "track" | "artist" = "track") => jpost("/api/v1/recommendations/dismiss", {parca, scope}),
  oneriGeriAl: (parca: Parca, scope: "track" | "artist" = "track") => jpost("/api/v1/recommendations/dismiss", {parca, scope}, "DELETE"),
  gecmis: () => jget<{parcalar: Parca[]}>("/api/v1/history"),
  radyo: (parca: Parca) => jpost<{parcalar: Parca[]}>("/api/v1/radio", {parca}),
  ara: (q: string, signal?: AbortSignal) => jget<{ parcalar: Parca[]; albumler?: Album[]; sanatcilar?: {id: string; ad: string; kaynak?: "kutuphane" | "youtube"}[]; hata?: string | string[] | Record<string, string> }>("/api/ara?q=" + encodeURIComponent(q), signal),
  album: (id: string) => jget<AlbumDetay>(`/api/library/album/${encodeURIComponent(id)}`),
  ytAlbum: (id: string) => jget<AlbumDetay>(`/api/yt/album/${encodeURIComponent(id)}`),
  sanatcilar: () => jget<{ sanatcilar: (Album & { albumSayisi: number })[] }>("/api/library/artists"),
  sanatci: (id: string) => jget<SanatciDetay>(`/api/library/artist/${encodeURIComponent(id)}`),
  ytSanatci: (browseId: string) => jget<SanatciDetay>(`/api/yt/sanatci/${encodeURIComponent(browseId)}`),
  favoriler: () => jget<{ parcalar: Parca[]; albumler: Album[] }>("/api/favoriler"),
  favoriYap: (parca: Parca, favori: boolean) => jpost("/api/favori", { parca, favori }),
  listeler: () => jget<{ listeler: Liste[]; begeniSayisi?: number }>("/api/listeler"),
  listeOnerileri: (id: string, offset = 0) => jget<{ parcalar: Parca[] }>(`/api/v1/playlists/${encodeURIComponent(id)}/recommendations?offset=${offset}`),
  trackShare: (parca: Parca) => jpost<{token: string; url: string}>("/api/v1/tracks/share", {parca}),
  sharedTrack: (token: string) => jget<{parca: Parca; sharedBy: string | null}>(`/api/v1/tracks/shared/${encodeURIComponent(token)}`),
  stats: (range: "4w" | "6m" | "all") => jget<{range: string; minutes: number; plays: number; artists: number; first: number | null; sources: {sidewave: number; spotify: number}; hours: number[];
    topArtists: {artist: string; minutes: number; plays: number; tracks: number; kapak: Parca | null}[]; topTracks: {track: Parca; plays: number; minutes: number; playable: boolean}[]}>(`/api/v1/stats?range=${range}`),
  mixes: () => jget<{ day: string; mixes: Mix[] }>("/api/v1/mixes"),
  mix: (id: string) => jget<Mix & { parcalar: Parca[] }>(`/api/v1/mixes/${encodeURIComponent(id)}`),
  liste: (id: string) => jget<Liste & { parcalar: Parca[] }>(`/api/liste/${encodeURIComponent(id)}`),
  listeOlustur: (ad: string) => jpost<{ id: string }>("/api/liste", { ad }),
  listeGuncelle: (id: string, update: {ad?: string; entryIds?: string[]}) => jpost(`/api/liste/${encodeURIComponent(id)}`, update, "PATCH"),
  // Followed collaborative playlists appear as "share:<token>" and add through their link.
  listeyeEkle: (id: string, parcalar: Parca[]) => id.startsWith("share:") ? jpost(`/api/v1/shared/${encodeURIComponent(id.slice(6))}/tracks`, {parcalar}) : jpost(`/api/liste/${encodeURIComponent(id)}/ekle`, {parcalar}),
  shareCreate: (id: string, mode: "view" | "edit") => jpost<{token: string; mode: string; url: string}>(`/api/v1/playlists/${encodeURIComponent(id)}/share`, {mode}),
  shareLinks: (id: string) => jget<{links: {token: string; mode: "view" | "edit"; url: string}[]}>(`/api/v1/playlists/${encodeURIComponent(id)}/share`),
  shareRevoke: (id: string, mode: "view" | "edit") => jpost(`/api/v1/playlists/${encodeURIComponent(id)}/share`, {mode}, "DELETE"),
  shared: (token: string) => jget<Liste & {parcalar: Parca[]; token: string; mode: "view" | "edit"; owner: string; mine: boolean; following: boolean}>(`/api/v1/shared/${encodeURIComponent(token)}`),
  sharedRemove: (token: string, entryId: string) => jpost(`/api/v1/shared/${encodeURIComponent(token)}/tracks`, {entryId}, "DELETE"),
  sharedSave: (token: string) => jpost<{id: string}>(`/api/v1/shared/${encodeURIComponent(token)}/save`),
  sharedFollow: (token: string, following: boolean) => jpost<{following: boolean}>(`/api/v1/shared/${encodeURIComponent(token)}/follow`, {following}, "PUT"),
  sharedFollowed: () => jget<{listeler: (Liste & {token: string; mode: "view" | "edit"; owner: string})[]}>("/api/v1/shared"),
  listedenCikar: (id: string, entryId: string) => jpost(`/api/liste/${encodeURIComponent(id)}/cikar`, {entryId}),
  listeSil: (id: string) => jpost(`/api/liste/${encodeURIComponent(id)}`, undefined, "DELETE"),
  indirmeler: () => jget<{ indirmeler: Indirme[] }>("/api/indirmeler"),
  arsiveEkle: (parca: Parca) => jpost<{ isId: string }>("/api/arsive-ekle", {parca, baslik: parca.baslik, sanatci: parca.sanatci}),
  archiveJobs: () => jget<{jobs: ArchiveJob[]}>("/api/v1/archive/jobs"),
  archiveSelect: (id: string, candidateId: string) => jpost(`/api/v1/archive/jobs/${encodeURIComponent(id)}/select`, {candidateId}),
  arsivDurum: (isId: string) => jget<{durum: string; message?: string}>("/api/arsive-ekle/" + encodeURIComponent(isId)),
  resolve: (parca: Parca, requestId: string, signal: AbortSignal) => request<{gain?: number; lufs?: number; delivery?: string; readiness?: string; url: string; requestId: string; kaynak: string; mimeType?: string; expiresAt?: number; fallbackUrl?: string; format?: string; bitrate?: number; parca?: Parca}>("/api/v1/playback/resolve", {method: "POST", signal, headers: {"Content-Type": "application/json", "X-Request-Id": requestId}, body: JSON.stringify({parca, requestId})}),
  prepare: (parca: Parca, signal: AbortSignal) => request<{id: string | null; state: string}>("/api/v1/playback/prepare", {method:"POST",signal,headers:{"Content-Type":"application/json"},body:JSON.stringify({parca,priority:"next"})}),
  preparation: (id: string, signal: AbortSignal) => request<{id: string; state: string}>(`/api/v1/playback/preparations/${encodeURIComponent(id)}`, {signal}),
  cancelPreparation: (id: string) => jpost(`/api/v1/playback/preparations/${encodeURIComponent(id)}`,undefined,"DELETE"),
  cache: () => jget<{enabled:boolean;capacityBytes:number;usedBytes:number;entries:number;activeFills:number}>("/api/v1/cache"),
  configureCache: (body: unknown) => jpost("/api/v1/cache",body,"PATCH"),
  clearCache: () => jpost("/api/v1/cache/unused",undefined,"DELETE"),
  trackDetail: (id: string) => jget<{parca:Parca;delivery:string;format:string|null;bitrate:number|null;lyrics:string|null;credits:{ad?:string}[]}>(`/api/v1/tracks/${encodeURIComponent(id)}`),
  home: () => jget<{sections:Record<string,{state:string;data:unknown;updatedAt?:number;message?:string}>}>("/api/v1/home"),
  prefetch: (parcalar: Parca[]) => jpost("/api/v1/playback/prefetch", {parcalar}),
  lyrics: (appId: string) => jget<{synced: {t: number; text: string}[] | null; plain: string | null; instrumental: boolean; source: string | null}>(`/api/v1/tracks/${encodeURIComponent(appId)}/lyrics`),
  loudness: (parca: Parca) => jget<{lufs: number | null; gain: number}>(`/api/v1/playback/loudness?${new URLSearchParams({kaynak: parca.kaynak || "kutuphane", id: parca.id})}`),
  /** Hover/focus intent: warms only the source URL of one online track, deduplicated client-side too. */
  prefetchIntent: (parca: Parca) => {
    if (parca.kaynak !== "youtube" || !parca.id) return;
    const now = Date.now();
    if (now - (intentSeen.get(parca.id) || 0) < 600_000) return;
    intentSeen.set(parca.id, now); if (intentSeen.size > 500) intentSeen.delete(intentSeen.keys().next().value!);
    void jpost("/api/v1/playback/prefetch", {parcalar: [parca], mode: "intent"}).catch(() => {});
  },
  event: (body: unknown) => jpost("/api/v1/events", body),
  devices: () => jget<{devices: Device[]; activeDeviceId: string | null; takeoverAt?: number}>("/api/v1/devices"),
  heartbeat: (id: string, body: unknown) => jpost<Device>(`/api/v1/devices/${encodeURIComponent(id)}`, body, "PUT"),
  takeover: (id: string) => jpost<Device>(`/api/v1/devices/${encodeURIComponent(id)}/takeover`,{commandId:crypto.randomUUID()}),
  importPreview: (text: string, format?: string) => jpost<ImportPreview>("/api/v1/import/preview", {text, format}),
  importStatus: (jobId: string) => jget<ImportPreview>(`/api/v1/import/preview/${encodeURIComponent(jobId)}`),
  importCancel: (jobId: string) => jpost(`/api/v1/import/preview/${encodeURIComponent(jobId)}`, undefined, "DELETE"),
  importCommit: (name: string, parcalar: Parca[]) => jpost<{id: string}>("/api/v1/import/commit", {name, parcalar}),
};
