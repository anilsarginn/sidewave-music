// Generated from openapi.json. Run npm run generate:models.
export type ParcaContract = {
  id: string;
  baslik: string;
  kaynak: "kutuphane" | "youtube";
  sanatci?: string | null;
  album?: string | null;
  sure?: number | null;
  kapakId?: string | null;
  kapakUrl?: string | null;
  kapak?: string | null;
  sanatciId?: string | null;
  albumId?: string | null;
  bicim?: string | null;
  bitrate?: number | null;
  parcaNo?: number | null;
  disk?: number | null;
  yil?: number | null;
  favori?: boolean | null;
  entryId?: string | null;
  appId?: string | null;
  reason?: string | null;
  reasonType?: string | null;
};
export type ApiErrorContract = {
  code: string;
  message: string;
  retryable: boolean;
  requestId: string;
};
export type PlaylistContract = {
  id?: string;
  ad?: string;
  parcaSayisi?: number;
  sure?: number;
  parcalar?: Array<ParcaContract>;
};
export type DeviceContract = {
  id?: string;
  name?: string;
  queue?: Array<ParcaContract>;
  index?: number;
  position?: number;
  state?: string;
  updatedAt?: number;
  online?: boolean;
  queueRevision?: number;
  handoffCommandId?: string | null;
};
export type ResolveRequestContract = {
  parca: ParcaContract;
  requestId?: string;
};
export type ResolveResponseContract = {
  url?: string;
  fallbackUrl?: string;
  requestId?: string;
  kaynak?: "kutuphane" | "youtube";
  mimeType?: string;
  expiresAt?: number;
  format?: string;
  bitrate?: number;
  parca?: ParcaContract;
  delivery?: "archive" | "temporary_cache" | "online";
  readiness?: "source_ready" | "complete";
  preparation?: PreparationContract;
};
export type PlaybackEventContract = {
  id?: string;
  occurredAt?: number;
  queue?: Array<ParcaContract>;
  index?: number;
  deviceId?: string;
  requestId?: string;
  event?: "playing" | "started" | "paused" | "ended" | "error" | "buffering" | "skip" | "resume" | "summary" | "progress" | "cancelled" | "source_ready" | "first_bytes";
  trackId?: string;
  source?: string;
  elapsedMs?: number;
  position?: number;
  parca?: ParcaContract;
  delivery?: string;
  appVersion?: string;
  playedMs?: number;
  rebufferMs?: number;
  rebuffers?: number;
};
export type ArchiveCandidateContract = {
  candidateId?: string;
  dosyaAdi?: string;
  bicim?: string;
  bitrate?: number;
  sure?: number;
  kullanici?: string;
};
export type ArchiveJobContract = {
  id?: string;
  trackKey?: string;
  parca?: ParcaContract;
  durum?: "araniyor" | "eslesme_bekliyor" | "indirme_baslatiliyor" | "indiriliyor" | "dogrulaniyor" | "ice_aktariliyor" | "hazir" | "basarisiz" | "bulunamadi";
  mesaj?: string;
  candidates?: Array<ArchiveCandidateContract>;
  localTrack?: ParcaContract;
};
export type ImportRowContract = {
  index?: number;
  baslik?: string;
  sanatci?: string;
  status?: "pending" | "matched" | "ambiguous" | "unmatched" | "error";
  candidates?: Array<ParcaContract>;
  selected?: ParcaContract | null;
};
export type ArtistContract = {
  id: string;
  appId: string;
  ad: string;
  kaynak: "kutuphane" | "youtube";
  takip: boolean;
  biyografi?: string;
  gorselUrl?: string;
  kapakId?: string;
  abone?: string;
  albumler?: Array<AlbumContract>;
  enCokDinlenen?: Array<ParcaContract>;
  benzer?: Array<ArtistReferenceContract>;
  diskografiTam?: boolean;
  stale?: boolean;
  warning?: string;
  updatedAt?: number;
  parcalar?: Array<ParcaContract>;
  parcaBasligi?: string;
  catalogWarning?: string;
};
export type ArtistReferenceContract = {
  id: string;
  ad: string;
  kaynak?: string;
};
export type AlbumContract = {
  id: string;
  appId: string;
  ad: string;
  kaynak: "kutuphane" | "youtube";
  kayitli: boolean;
  sanatci?: string;
  sanatciId?: string;
  yil?: number;
  kapak?: string;
  kapakId?: string;
  parcaSayisi?: number;
  toplamSure?: number;
  tur?: string;
  parcalar?: Array<ParcaContract>;
  stale?: boolean;
  warning?: string;
  updatedAt?: number;
};
export type LibraryContract = {
  sanatcilar: Array<ArtistContract>;
  albumler: Array<AlbumContract>;
};
export type ReleasePageContract = {
  items: Array<AlbumContract>;
  total: number;
  nextOffset: number | null;
  complete: boolean;
  warning?: string;
};
export type SonicAnalysisContract = {
  count: number | null;
  total: number | null;
  model: string;
  version?: string;
  serviceVersion?: string;
};
export type DiscoveryCapabilitiesContract = {
  available: boolean;
  method: string;
  source: string;
  state: string;
  message: string;
  analysis: SonicAnalysisContract | null;
};
export type SonicMatchContract = {
  parca: ParcaContract;
  similarity: number | null;
  method?: string;
};
export type DiscoveryResultContract = {
  state?: string;
  method: string;
  source: string;
  message?: string | null;
  scoreMeaning?: string | null;
  seed?: ParcaContract;
  matches?: Array<SonicMatchContract>;
  parcalar?: Array<ParcaContract>;
  sanatcilar?: Array<ArtistContract>;
  analysis?: DiscoveryAnalysisContract;
};
export type ReleaseFeedContract = {
  items: Array<AlbumContract>;
  warning: string | null;
  followedCount: number;
  coveredArtists: number;
  stale?: boolean;
  updatedAt?: number | null;
  refreshing?: boolean;
};
export type AnalysisJobContract = {
  state: "idle" | "busy" | "submitted" | "waiting" | "unsupported";
  message?: string;
  taskId?: string | null;
  submittedAt?: number;
  trackCount?: number;
  updatedAt?: number;
};
export type SpotifyImportCountsContract = {
  total: number;
  pending: number | null;
  selected: number | null;
  unsupported: number | null;
  ambiguous: number | null;
  unmatched: number | null;
  errors: number | null;
};
export type SpotifyImportCollectionContract = {
  id: string;
  name: string;
  kind: "playlist" | "favorites";
  total: number;
  pending: number | null;
  selected: number | null;
  canBeFavorites?: boolean;
};
export type SpotifyImportedPlaylistContract = {
  id: string;
  name: string;
};
export type SpotifyImportCommitContract = {
  added: number;
  favorites: number;
  playlists: Array<SpotifyImportedPlaylistContract>;
  at: number;
};
export type SpotifyImportJobContract = {
  id: string;
  label: string;
  state: "matching" | "paused" | "ready" | "committed";
  createdAt: number;
  warnings: Array<string>;
  hasLibrary: boolean;
  hasPlaylists: boolean;
  collections: Array<SpotifyImportCollectionContract>;
  counts: SpotifyImportCountsContract;
  lastCommit: SpotifyImportCommitContract | null;
};
export type SpotifyImportRowContract = {
  id: string;
  collectionId: string;
  position: number;
  baslik: string;
  sanatci: string;
  album: string;
  spotifyUri: string;
  sourceKey: string;
  sure: number | null;
  status: "pending" | "matched" | "ambiguous" | "unmatched" | "error" | "unsupported";
  candidates: Array<ParcaContract>;
  selected: ParcaContract | null;
  applied: boolean;
};
export type SpotifyImportPageContract = {
  items: Array<SpotifyImportRowContract>;
  total: number;
  nextOffset: number | null;
};
export type AndroidReleaseContract = {
  packageName: string;
  versionCode: number;
  versionName: string;
  minSdk: number;
  sizeBytes: number;
  sha256: string;
  certificateSha256: string;
  url: string;
  notes: string;
  publishedAt: string;
};
export type PreparationContract = {
  id: string | null;
  state: "accepted" | "warming" | "ready" | "failed" | "cancelled" | "interrupted" | "disabled" | "expired";
  priority?: string;
  delivery?: string;
  updatedAt?: number;
  code?: string | null;
};
export type CacheStatusContract = {
  enabled: boolean;
  capacityBytes: number;
  usedBytes: number;
  maxAgeDays?: number;
  entries: number;
  activeFills?: number;
  queued?: number;
  pinned?: number;
  maxEntryBytes?: number;
  reserveBytes?: number;
};
export type TrackDetailsContract = {
  parca: ParcaContract;
  delivery: string;
  format?: string | null;
  bitrate?: number | null;
  lyrics?: string | null;
  version?: string;
  credits?: Array<ArtistReferenceContract>;
  sources?: Array<Record<string, unknown>>;
};
export type HomeResponseContract = {
  sections: HomeSectionsContract;
};
export type TracksSectionContract = {
  state: "ready" | "stale" | "error";
  data: Array<ParcaContract> | null;
  updatedAt?: number;
  message?: string;
};
export type PlaylistsSectionContract = {
  state: "ready" | "stale" | "error";
  data: Array<PlaylistContract> | null;
  updatedAt?: number;
  message?: string;
};
export type ResumeSectionContract = {
  state: "ready" | "stale" | "error";
  data: DeviceContract | null;
  updatedAt?: number;
  message?: string;
};
export type ReleasesSectionContract = {
  state: "ready" | "stale" | "error";
  data: ReleaseFeedContract | null;
  updatedAt?: number;
  message?: string;
};
export type HomeSectionsContract = {
  resume: ResumeSectionContract;
  recent: TracksSectionContract;
  playlists: PlaylistsSectionContract;
  forYou: TracksSectionContract;
  rediscover: TracksSectionContract;
  followed: ReleasesSectionContract;
};
export type DiscoveryAnalysisContract = {
  id: string;
  state: string;
  completed: number;
  total: number;
  failed: number;
  sampleSeconds?: number;
  scope?: string;
  message: string;
};
export type GlobalAppearanceContract = {
  wallpaperUrl: string | null;
  dim: number;
  transparency: number;
  configured: boolean;
  revision?: string;
};
export type MemberContract = {
  id: string;
  username: string;
  owner?: boolean;
};
export type MemberSessionContract = {
  user: MemberContract | null;
  firstAccount?: boolean;
};
export type MemberCredentialsContract = {
  username: string;
  password: string;
};
export type EditorialCollectionContract = {
  id: string;
  ad: string;
  tur?: string;
  renk?: string;
  aciklama?: string;
  owner: string;
  editable: false;
  parcaSayisi?: number | null;
  parcalar?: Array<ParcaContract>;
  week?: string;
  startsAt?: number;
  refreshAt?: number;
  createdAt?: number;
  updatedAt?: number;
  personalized?: boolean;
  partial?: boolean;
  stale?: boolean;
  message?: string;
  addedCount?: number;
  kapak?: string;
};
export type PhilosopherQuoteContract = {
  id: string;
  text: string;
  author: string;
  work: string;
  source: string;
};
export type HomeIntroResponseContract = {
  kind: "greeting" | "quote";
  period: string;
  greeting?: string;
  quote?: PhilosopherQuoteContract;
};
export type DailyMixContract = {
  id: string;
  ad: string;
  altyazi: string;
  renk: string;
  kapak?: ParcaContract;
  parcaSayisi: number;
  parcalar?: Array<ParcaContract>;
};
export type LoudnessContract = {
  lufs?: number | null;
  gain?: number;
  pending?: boolean;
};
export type SyncedLyricsContract = {
  synced?: Array<LyricLineContract> | null;
  plain?: string | null;
  instrumental?: boolean;
  source?: string | null;
};
export type LyricLineContract = {
  t: number;
  text: string;
};
