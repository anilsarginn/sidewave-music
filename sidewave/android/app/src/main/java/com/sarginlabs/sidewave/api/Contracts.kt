// Generated from openapi.json. Run npm run generate:models.
package com.sarginlabs.sidewave.api

data class ApiError(
    val code: String,
    val message: String,
    val retryable: Boolean,
    val requestId: String,
)

data class Playlist(
    val id: String? = null,
    val ad: String? = null,
    val parcaSayisi: Int? = null,
    val sure: Double? = null,
    val parcalar: List<Parca>? = null,
)

data class Device(
    val id: String? = null,
    val name: String? = null,
    val queue: List<Parca>? = null,
    val index: Int? = null,
    val position: Double? = null,
    val state: String? = null,
    val updatedAt: Double? = null,
    val online: Boolean? = null,
    val queueRevision: Int? = null,
    val handoffCommandId: String? = null,
)

data class ResolveRequest(
    val parca: Parca,
    val requestId: String? = null,
)

data class ResolveResponse(
    val url: String? = null,
    val fallbackUrl: String? = null,
    val requestId: String? = null,
    val kaynak: String? = null,
    val mimeType: String? = null,
    val expiresAt: Double? = null,
    val format: String? = null,
    val bitrate: Double? = null,
    val parca: Parca? = null,
    val delivery: String? = null,
    val readiness: String? = null,
    val preparation: Preparation? = null,
)

data class PlaybackEvent(
    val id: String? = null,
    val occurredAt: Double? = null,
    val queue: List<Parca>? = null,
    val index: Int? = null,
    val deviceId: String? = null,
    val requestId: String? = null,
    val event: String? = null,
    val trackId: String? = null,
    val source: String? = null,
    val elapsedMs: Double? = null,
    val position: Double? = null,
    val parca: Parca? = null,
    val delivery: String? = null,
    val appVersion: String? = null,
    val playedMs: Double? = null,
    val rebufferMs: Double? = null,
    val rebuffers: Double? = null,
)

data class ArchiveCandidate(
    val candidateId: String? = null,
    val dosyaAdi: String? = null,
    val bicim: String? = null,
    val bitrate: Double? = null,
    val sure: Double? = null,
    val kullanici: String? = null,
)

data class ArchiveJob(
    val id: String? = null,
    val trackKey: String? = null,
    val parca: Parca? = null,
    val durum: String? = null,
    val mesaj: String? = null,
    val candidates: List<ArchiveCandidate>? = null,
    val localTrack: Parca? = null,
)

data class ImportRow(
    val index: Int? = null,
    val baslik: String? = null,
    val sanatci: String? = null,
    val status: String? = null,
    val candidates: List<Parca>? = null,
    val selected: Parca? = null,
)

data class Artist(
    val id: String,
    val appId: String,
    val ad: String,
    val kaynak: String,
    val takip: Boolean,
    val biyografi: String? = null,
    val gorselUrl: String? = null,
    val kapakId: String? = null,
    val abone: String? = null,
    val albumler: List<Album>? = null,
    val enCokDinlenen: List<Parca>? = null,
    val benzer: List<ArtistReference>? = null,
    val diskografiTam: Boolean? = null,
    val stale: Boolean? = null,
    val warning: String? = null,
    val updatedAt: Int? = null,
    val parcalar: List<Parca>? = null,
    val parcaBasligi: String? = null,
    val catalogWarning: String? = null,
)

data class ArtistReference(
    val id: String,
    val ad: String,
    val kaynak: String? = null,
)

data class Album(
    val id: String,
    val appId: String,
    val ad: String,
    val kaynak: String,
    val kayitli: Boolean,
    val sanatci: String? = null,
    val sanatciId: String? = null,
    val yil: Int? = null,
    val kapak: String? = null,
    val kapakId: String? = null,
    val parcaSayisi: Int? = null,
    val toplamSure: Int? = null,
    val tur: String? = null,
    val parcalar: List<Parca>? = null,
    val stale: Boolean? = null,
    val warning: String? = null,
    val updatedAt: Int? = null,
)

data class Library(
    val sanatcilar: List<Artist>,
    val albumler: List<Album>,
)

data class ReleasePage(
    val items: List<Album>,
    val total: Int,
    val nextOffset: Int?,
    val complete: Boolean,
    val warning: String? = null,
)

data class SonicAnalysis(
    val count: Int?,
    val total: Int?,
    val model: String,
    val version: String? = null,
    val serviceVersion: String? = null,
)

data class DiscoveryCapabilities(
    val available: Boolean,
    val method: String,
    val source: String,
    val state: String,
    val message: String,
    val analysis: SonicAnalysis?,
)

data class SonicMatch(
    val parca: Parca,
    val similarity: Double?,
    val method: String? = null,
)

data class DiscoveryResult(
    val state: String? = null,
    val method: String,
    val source: String,
    val message: String? = null,
    val scoreMeaning: String? = null,
    val seed: Parca? = null,
    val matches: List<SonicMatch>? = null,
    val parcalar: List<Parca>? = null,
    val sanatcilar: List<Artist>? = null,
    val analysis: DiscoveryAnalysis? = null,
)

data class ReleaseFeed(
    val items: List<Album>,
    val warning: String?,
    val followedCount: Int,
    val coveredArtists: Int,
    val stale: Boolean? = null,
    val updatedAt: Double? = null,
    val refreshing: Boolean? = null,
)

data class AnalysisJob(
    val state: String,
    val message: String? = null,
    val taskId: String? = null,
    val submittedAt: Int? = null,
    val trackCount: Int? = null,
    val updatedAt: Int? = null,
)

data class SpotifyImportCounts(
    val total: Int,
    val pending: Int?,
    val selected: Int?,
    val unsupported: Int?,
    val ambiguous: Int?,
    val unmatched: Int?,
    val errors: Int?,
)

data class SpotifyImportCollection(
    val id: String,
    val name: String,
    val kind: String,
    val total: Int,
    val pending: Int?,
    val selected: Int?,
    val canBeFavorites: Boolean? = null,
)

data class SpotifyImportedPlaylist(
    val id: String,
    val name: String,
)

data class SpotifyImportCommit(
    val added: Int,
    val favorites: Int,
    val playlists: List<SpotifyImportedPlaylist>,
    val at: Int,
)

data class SpotifyImportJob(
    val id: String,
    val label: String,
    val state: String,
    val createdAt: Int,
    val warnings: List<String>,
    val hasLibrary: Boolean,
    val hasPlaylists: Boolean,
    val collections: List<SpotifyImportCollection>,
    val counts: SpotifyImportCounts,
    val lastCommit: SpotifyImportCommit?,
)

data class SpotifyImportRow(
    val id: String,
    val collectionId: String,
    val position: Int,
    val baslik: String,
    val sanatci: String,
    val album: String,
    val spotifyUri: String,
    val sourceKey: String,
    val sure: Double?,
    val status: String,
    val candidates: List<Parca>,
    val selected: Parca?,
    val applied: Boolean,
)

data class SpotifyImportPage(
    val items: List<SpotifyImportRow>,
    val total: Int,
    val nextOffset: Int?,
)

data class AndroidRelease(
    val packageName: String,
    val versionCode: Int,
    val versionName: String,
    val minSdk: Int,
    val sizeBytes: Int,
    val sha256: String,
    val certificateSha256: String,
    val url: String,
    val notes: String,
    val publishedAt: String,
)

data class Preparation(
    val id: String?,
    val state: String,
    val priority: String? = null,
    val delivery: String? = null,
    val updatedAt: Double? = null,
    val code: String? = null,
)

data class CacheStatus(
    val enabled: Boolean,
    val capacityBytes: Double,
    val usedBytes: Double,
    val maxAgeDays: Double? = null,
    val entries: Double,
    val activeFills: Double? = null,
    val queued: Double? = null,
    val pinned: Double? = null,
    val maxEntryBytes: Double? = null,
    val reserveBytes: Double? = null,
)

data class TrackDetails(
    val parca: Parca,
    val delivery: String,
    val format: String? = null,
    val bitrate: Double? = null,
    val lyrics: String? = null,
    val version: String? = null,
    val credits: List<ArtistReference>? = null,
    val sources: List<Map<String, Any?>>? = null,
)

data class HomeResponse(
    val sections: HomeSections,
)

data class TracksSection(
    val state: String,
    val data: List<Parca>?,
    val updatedAt: Double? = null,
    val message: String? = null,
)

data class PlaylistsSection(
    val state: String,
    val data: List<Playlist>?,
    val updatedAt: Double? = null,
    val message: String? = null,
)

data class ResumeSection(
    val state: String,
    val data: Device?,
    val updatedAt: Double? = null,
    val message: String? = null,
)

data class ReleasesSection(
    val state: String,
    val data: ReleaseFeed?,
    val updatedAt: Double? = null,
    val message: String? = null,
)

data class HomeSections(
    val resume: ResumeSection,
    val recent: TracksSection,
    val playlists: PlaylistsSection,
    val forYou: TracksSection,
    val rediscover: TracksSection,
    val followed: ReleasesSection,
)

data class DiscoveryAnalysis(
    val id: String,
    val state: String,
    val completed: Int,
    val total: Int,
    val failed: Int,
    val sampleSeconds: Int? = null,
    val scope: String? = null,
    val message: String,
)

data class GlobalAppearance(
    val wallpaperUrl: String?,
    val dim: Double,
    val transparency: Double,
    val configured: Boolean,
    val revision: String? = null,
)

data class Member(
    val id: String,
    val username: String,
    val owner: Boolean? = null,
)

data class MemberSession(
    val user: Member?,
    val firstAccount: Boolean? = null,
)

data class MemberCredentials(
    val username: String,
    val password: String,
)

data class EditorialCollection(
    val id: String,
    val ad: String,
    val tur: String? = null,
    val renk: String? = null,
    val aciklama: String? = null,
    val owner: String,
    val editable: Boolean,
    val parcaSayisi: Int? = null,
    val parcalar: List<Parca>? = null,
    val week: String? = null,
    val startsAt: Double? = null,
    val refreshAt: Double? = null,
    val createdAt: Double? = null,
    val updatedAt: Double? = null,
    val personalized: Boolean? = null,
    val partial: Boolean? = null,
    val stale: Boolean? = null,
    val message: String? = null,
    val addedCount: Int? = null,
    val kapak: String? = null,
)

data class PhilosopherQuote(
    val id: String,
    val text: String,
    val author: String,
    val work: String,
    val source: String,
)

data class HomeIntroResponse(
    val kind: String,
    val period: String,
    val greeting: String? = null,
    val quote: PhilosopherQuote? = null,
)

data class DailyMix(
    val id: String,
    val ad: String,
    val altyazi: String,
    val renk: String,
    val kapak: Parca? = null,
    val parcaSayisi: Int,
    val parcalar: List<Parca>? = null,
)

data class Loudness(
    val lufs: Double? = null,
    val gain: Double? = null,
    val pending: Boolean? = null,
)

data class SyncedLyrics(
    val synced: List<LyricLine>? = null,
    val plain: String? = null,
    val instrumental: Boolean? = null,
    val source: String? = null,
)

data class LyricLine(
    val t: Double,
    val text: String,
)
