import type { Parca } from './api';

export type Tekrar = 'kapali' | 'tumu' | 'tek';
export type PlayerState = 'idle' | 'preparing' | 'buffering' | 'playing' | 'paused' | 'ended' | 'error';
export type QueueEntry = Parca & { queueId: string };
export type PlaybackError = { code: string; message: string; retryable: boolean };
export type PlayerSnapshot = {
  queue: QueueEntry[]; original: QueueEntry[]; index: number; state: PlayerState;
  position: number; duration: number; volume: number; shuffle: boolean; repeat: Tekrar;
  delivery?:string; sleepUntil?:number; sleepAtEnd?:boolean; error: PlaybackError | null; notice: string; autoplay: boolean; format?: string; bitrate?: number;
  normalize: boolean; crossfade: number;
};
export type Resolver = (track: Parca, requestId: string, signal: AbortSignal) => Promise<{ gain?: number; delivery?:string; url: string; fallbackUrl?: string; format?: string; bitrate?: number; parca?: Parca }>;
export type PlayerEvent = {reason?: string; delivery?:string; appVersion?:string; playedMs?:number; requestId: string; event: string; trackId: string; source: string; elapsedMs: number; position: number; parca: Parca; queue?: QueueEntry[]; index?: number };
const START_TIMEOUT = 15_000;
export const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const empty = (): PlayerSnapshot => ({queue: [], original: [], index: -1, state: 'idle', position: 0, duration: 0, volume: 100, shuffle: false, repeat: 'kapali', error: null, notice: '', autoplay: false, normalize: true, crossfade: 0});
const PRELOAD_BEFORE_END = 20;
type Preload = {queueId: string; requestId: string; abort: AbortController; audio?: HTMLAudioElement; result?: Awaited<ReturnType<Resolver>>; failed?: boolean};
export type PlayerOptions = {createAudio?: () => HTMLAudioElement; loudness?: (track: Parca) => Promise<number | null>};
const entry = (p: Parca): QueueEntry => ({...p, queueId: uid()});
const shuffled = (items: QueueEntry[], current: QueueEntry | undefined) => {
  const rest = items.filter(p => p.queueId !== current?.queueId);
  for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
  return current ? [current, ...rest] : rest;
};

/** One audio element, one cancellable attempt, and one deadline per selected entry. */
export class PlayerController {
  private snapshot = empty();
  private listeners = new Set<() => void>();
  private abort?: AbortController;
  private deadline?: ReturnType<typeof setTimeout>;
  private unsubscribeAudio = () => {};
  private generation = 0;
  private requestId = '';
  private startedAt = 0;
  private retryCount = 0;
  private fallbackUrl?: string;
  private failures = 0;
  private autoAttempt = false;
  private firstSound = false;
  private progressed = false;
  private playedMs = 0;
  private summaryTrack?: Parca;
  private summaryTrace="";
  private lastProgressTime = 0;
  private removed?: {item: QueueEntry; index:number; originalIndex:number};
  private sleepTimer?: ReturnType<typeof setTimeout>;
  private wanted = false;
  private resumeAt = 0;
  private lastSaved = 0;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private radioGeneration = 0;
  private unmutedVolume = 100;
  // Position changes several times a second; it has its own subscription so that the whole
  // interface does not re-render while a song plays.
  private progress = {position: 0, duration: 0};
  private progressListeners = new Set<() => void>();
  // Gapless: the next entry is resolved and buffered in a second element shortly before the end.
  private preload?: Preload;
  // Volume levelling multiplier for the current track (1 = unchanged).
  private gain = 1;
  private gainRamp?: ReturnType<typeof setInterval>;
  // Crossfade: the finishing element keeps playing (fading out) while the next one fades in.
  private fadingOut?: {audio: HTMLAudioElement; timer: ReturnType<typeof setInterval>};
  private fadeInMs = 0;
  constructor(
    private audio: HTMLAudioElement,
    private resolve: Resolver,
    private report: (event: PlayerEvent) => void = () => {},
    private storage?: Pick<Storage, 'getItem' | 'setItem'>,
    private radio?: (track: Parca) => Promise<Parca[]>,
    private options: PlayerOptions = {},
  ) {
    try {
      const data = JSON.parse(storage?.getItem('sidewave-player-v1') || 'null');
      if (data && Array.isArray(data.queue) && data.queue.every((p: QueueEntry) => p.id && p.queueId && typeof p.baslik === 'string')) {
        const byId = new Map<string, QueueEntry>(data.queue.map((p: QueueEntry) => [p.queueId, p]));
        const seen = new Set<string>();
        const original: QueueEntry[] = [];
        for (const saved of [...(Array.isArray(data.original) ? data.original : []), ...data.queue] as QueueEntry[]) {
          if (byId.has(saved.queueId) && !seen.has(saved.queueId)) { original.push(byId.get(saved.queueId)!); seen.add(saved.queueId); }
        }
        const index = Number.isInteger(data.index) && data.index >= -1 && data.index < data.queue.length ? data.index : data.queue.length ? 0 : -1;
        this.snapshot = {...empty(), queue: data.queue, original, index, position: index < 0 ? 0 : Math.max(0, Number(data.position) || 0), duration: index < 0 ? 0 : Math.max(0, Number(data.duration) || 0), volume: Number.isFinite(Number(data.volume)) ? Math.min(100, Math.max(0, Number(data.volume))) : 100, normalize: data.normalize !== false, crossfade: [0, 3, 6, 9, 12].includes(Number(data.crossfade)) ? Number(data.crossfade) : 0, shuffle: !!data.shuffle, repeat: ['kapali', 'tumu', 'tek'].includes(data.repeat) ? data.repeat : 'kapali', autoplay: !!data.autoplay, state: index >= 0 ? 'paused' : 'idle'};
      }
    } catch { /* Private browsing or old persistence must not prevent playback. */ }
    this.audio.volume = this.snapshot.volume / 100;
    this.unmutedVolume = this.snapshot.volume || 100;
    this.progress = {position: this.snapshot.position, duration: this.snapshot.duration};
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getProgress = () => this.progress;
  subscribeProgress = (listener: () => void) => { this.progressListeners.add(listener); return () => this.progressListeners.delete(listener); };
  private setProgress(position: number, duration: number) {
    if (position === this.progress.position && duration === this.progress.duration) return;
    this.progress = {position, duration};
    // Imperative readers (heartbeat, persistence) see the live position without a render.
    this.snapshot.position = position; this.snapshot.duration = duration;
    this.progressListeners.forEach(f => f());
  }
  private update(patch: Partial<PlayerSnapshot>) {
    this.snapshot = {...this.snapshot, ...patch};
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      navigator.mediaSession.playbackState = this.snapshot.state === 'playing' ? 'playing' : ['idle', 'ended'].includes(this.snapshot.state) ? 'none' : 'paused';
    }
    if ('position' in patch || 'duration' in patch) this.setProgress(this.snapshot.position, this.snapshot.duration);
    this.listeners.forEach(f => f());
    // Serialising a long queue on every change blocks the main thread; coalesce writes.
    clearTimeout(this.saveTimer); this.saveTimer = setTimeout(this.save, 800);
  }
  save = () => { clearTimeout(this.saveTimer); this.lastSaved = Date.now(); try { this.storage?.setItem('sidewave-player-v1', JSON.stringify(this.snapshot)); } catch { /* Storage quota is independent of playback. */ } };
  private track() { return this.snapshot.queue[this.snapshot.index]; }
  private event(event: string, extra: Partial<PlayerEvent> = {}) {
    const track = this.track();
    if(event==='summary'&&this.summaryTrack){this.report({event,requestId:this.summaryTrace,trackId:this.summaryTrack.id,source:this.summaryTrack.kaynak||'kutuphane',elapsedMs:Math.round(performance.now()-this.startedAt),position:0,parca:this.summaryTrack,playedMs:this.playedMs,appVersion:'web-2.9.0'});this.playedMs=0;return;}
    if (track) this.report({delivery:this.snapshot.delivery,appVersion:'web-2.9.0',playedMs:this.playedMs,requestId: this.requestId, event, trackId: track.id, source: track.kaynak || 'kutuphane', elapsedMs: Math.round(performance.now() - this.startedAt), position: this.audio.currentTime || this.snapshot.position, parca: track, ...(['first_sound', 'paused', 'ended', 'skip'].includes(event) ? {queue: this.snapshot.queue, index: this.snapshot.index} : {}), ...extra});
  }
  private stopAttempt() {
    this.generation++;
    this.abort?.abort(); this.abort = undefined;
    clearTimeout(this.deadline); this.deadline = undefined;
    this.unsubscribeAudio(); this.unsubscribeAudio = () => {};
    this.audio.pause();
    this.audio.removeAttribute('src'); this.audio.load();
  }
  private applyVolume(ramp = false) {
    clearInterval(this.gainRamp);
    const target = this.snapshot.volume / 100 * (this.snapshot.normalize ? this.gain : 1);
    if (!ramp || !Number.isFinite(this.audio.volume)) { this.audio.volume = target; return; }
    // A late loudness value fades in over half a second instead of jumping.
    const from = this.audio.volume, steps = 10; let step = 0;
    this.gainRamp = setInterval(() => { step++; this.audio.volume = from + (target - from) * step / steps; if (step >= steps) clearInterval(this.gainRamp); }, 50);
  }
  private stopFade() {
    const fading = this.fadingOut; this.fadingOut = undefined;
    if (!fading) return;
    clearInterval(fading.timer); fading.audio.pause(); fading.audio.removeAttribute('src'); fading.audio.load();
  }
  private startCrossfade() {
    const old = this.audio, ms = this.snapshot.crossfade * 1000;
    this.event('summary'); this.playedMs = 0; this.event('ended');
    // The old element is detached from player state and fades out on its own; load() then works on a
    // throwaway element and switches to the preloaded next track, which fades in.
    this.unsubscribeAudio(); this.unsubscribeAudio = () => {};
    this.stopFade();
    const from = old.volume, steps = Math.max(1, Math.round(ms / 100)); let step = 0;
    const timer = setInterval(() => { step++; old.volume = Math.max(0, from * (1 - step / steps)); if (step >= steps) this.stopFade(); }, 100);
    this.fadingOut = {audio: old, timer};
    this.audio = this.options.createAudio!();
    this.fadeInMs = ms;
    this.next(1, true);
  }
  private clearPreload() {
    const preload = this.preload; this.preload = undefined;
    if (!preload) return;
    preload.abort.abort();
    if (preload.audio) { preload.audio.removeAttribute('src'); preload.audio.load(); }
  }
  private nextEntry() {
    const {queue, index, repeat} = this.snapshot;
    if (repeat === 'tek') return undefined;
    return queue[index + 1] || (repeat === 'tumu' && queue.length > 1 ? queue[0] : undefined);
  }
  private maybePreload() {
    if (!this.options.createAudio || this.snapshot.state !== 'playing' || this.snapshot.sleepAtEnd) return;
    const {position, duration} = this.progress;
    if (!duration || duration - position > PRELOAD_BEFORE_END + this.snapshot.crossfade) return;
    const next = this.nextEntry();
    if (!next) { this.clearPreload(); return; }
    if (this.preload?.queueId === next.queueId) return;
    this.clearPreload();
    const preload: Preload = {queueId: next.queueId, requestId: uid(), abort: new AbortController()};
    this.preload = preload;
    this.resolve(next, preload.requestId, preload.abort.signal).then(result => {
      if (this.preload !== preload) return;
      const audio = this.options.createAudio!();
      audio.preload = 'auto'; audio.src = result.url; audio.load();
      preload.audio = audio; preload.result = result;
    }).catch(() => { if (this.preload === preload) preload.failed = true; });
  }
  private async load(automatic: boolean, position = 0, retry = false, fallbackUrl?: string) {
    const track = this.track();
    if (!track) return;
    if(!retry && this.playedMs>0)this.event('summary');
    const ready = !retry && !fallbackUrl && position === 0 && this.preload?.queueId === track.queueId && this.preload.audio && this.preload.result ? this.preload : undefined;
    if (ready) this.preload = undefined; else this.clearPreload();
    this.stopAttempt();
    if (ready) this.audio = ready.audio!;
    const generation = this.generation;
    this.wanted = true;
    this.autoAttempt = automatic;
    this.resumeAt = position;
    if (!retry) { this.fallbackUrl = undefined; this.retryCount = 0; this.firstSound = false; this.progressed=false; this.playedMs=0; this.lastProgressTime=performance.now(); this.requestId = ready?.requestId || uid(); this.startedAt = performance.now(); this.gain = 1; }
    this.abort = new AbortController();
    this.update({state: 'preparing', error: null, position, duration: track.sure || 0, format: track.bicim, bitrate: track.bitrate});
    const remaining = START_TIMEOUT - (performance.now() - this.startedAt);
    this.deadline = setTimeout(() => this.fail({code: 'START_TIMEOUT', message: "The song did not start within 15 seconds. Check your connection and try again.", retryable: true}, generation), Math.max(1, remaining));
    this.event(retry ? 'retry' : 'attempt');
    try {
      const result: Awaited<ReturnType<Resolver>> = ready?.result ?? (fallbackUrl ? {url: fallbackUrl, format: "mp3"} : await this.resolve(track, this.requestId, this.abort.signal));
      const {url} = result;
      if (generation !== this.generation || !this.wanted) return;
      const gainKnown = Number.isFinite(result.gain);
      if (gainKnown) this.gain = Math.min(1, Math.max(0.05, result.gain!));
      this.applyVolume();
      if (ready && this.fadeInMs) {
        const target = this.audio.volume, steps = Math.max(1, Math.round(this.fadeInMs / 100)); let step = 0;
        this.audio.volume = 0; clearInterval(this.gainRamp);
        this.gainRamp = setInterval(() => { step++; this.audio.volume = target * step / steps; if (step >= steps) clearInterval(this.gainRamp); }, 100);
      }
      this.fadeInMs = 0;
      if (result.parca || result.format || result.bitrate) {
        const refreshed = {...track, ...(result.parca || {}), queueId: track.queueId};
        this.update({queue: this.snapshot.queue.map(p => p.queueId === track.queueId ? refreshed : p), original: this.snapshot.original.map(p => p.queueId === track.queueId ? refreshed : p), format: result.format || refreshed.bicim, bitrate: fallbackUrl ? undefined : result.bitrate ?? refreshed.bitrate});
      }
      this.summaryTrack=track;this.summaryTrace=this.requestId;this.update({delivery:result.delivery||'online'});
      this.fallbackUrl = result.fallbackUrl;
      this.event('resolved');
      if (!ready) this.audio.src = url;
      const handlers: [string, EventListener][] = [];
      const on = (name: string, f: () => void) => {
        const handler: EventListener = () => { if (generation === this.generation) f(); };
        handlers.push([name, handler]); this.audio.addEventListener(name, handler);
      };
      this.unsubscribeAudio = () => handlers.forEach(([name, handler]) => this.audio.removeEventListener(name, handler));
      on('playing', () => {
        if (!this.wanted) { this.audio.pause(); return; }
        if (!gainKnown && !this.firstSound && this.options.loudness && this.snapshot.normalize) void this.options.loudness(track).then(lufs => {
          if (generation !== this.generation || lufs === null || !Number.isFinite(lufs)) return;
          this.gain = Math.min(1, Math.max(0.05, Math.pow(10, (-14 - lufs) / 20))); this.applyVolume(true);
        }).catch(() => {});
        clearTimeout(this.deadline); this.deadline = undefined;
        this.failures = 0;
        this.update({state: 'playing', error: null, ...(fallbackUrl ? {notice: ''} : {})});
        if (!this.firstSound) { this.firstSound = true; this.event('first_sound'); }
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
      });
      on('waiting', () => this.buffer(generation));
      on('stalled', () => this.buffer(generation));
      on('pause', () => { if (this.snapshot.state !== 'error' && this.snapshot.state !== 'ended') this.update({state: 'paused'}); });
      on('loadedmetadata', () => {
        const duration = Number.isFinite(this.audio.duration) ? this.audio.duration : this.snapshot.duration;
        this.update({duration});
        if (this.resumeAt > 0) { this.audio.currentTime = Math.min(this.resumeAt, Math.max(0, duration - 0.1)); this.resumeAt = 0; }
      });
      on('timeupdate', () => {
        const now=performance.now();
        if(this.snapshot.state==='playing')this.playedMs+=Math.min(1000,Math.max(0,now-this.lastProgressTime));
        this.lastProgressTime=now;
        if(!this.progressed && this.audio.currentTime>this.resumeAt+.025 && this.snapshot.state==='playing'){this.progressed=true;this.event('progress');}

        this.setProgress(this.audio.currentTime, Number.isFinite(this.audio.duration) ? this.audio.duration : this.snapshot.duration);
        if (Date.now() - this.lastSaved > 5000) this.save();
        this.maybePreload();
        const remaining = this.progress.duration - this.progress.position, preload = this.preload;
        if (this.snapshot.crossfade > 0 && this.snapshot.state === 'playing' && remaining > 0.3 && remaining <= this.snapshot.crossfade && preload?.audio && preload.result && preload.queueId === this.nextEntry()?.queueId) this.startCrossfade();
      });
      on('ended', () => {
        this.event('summary');this.playedMs=0;
        if(this.snapshot.sleepAtEnd){this.pause();this.update({sleepAtEnd:false,state:'ended'});return;}
 this.event('ended'); this.next(1, true); });
      on('error', () => this.mediaFailure(generation));
      if (ready) {
        // The preloaded element already has metadata; its events fired before these listeners.
        if (this.audio.readyState >= 1 && Number.isFinite(this.audio.duration)) this.update({duration: this.audio.duration});
      } else this.audio.load();
      await this.audio.play();
    } catch (error) {
      if (generation !== this.generation) return;
      const e = error as Error & {code?: string; retryable?: boolean};
      if (e.name === 'AbortError') return;
      this.fail({code: e.name === 'NotAllowedError' ? 'USER_GESTURE_REQUIRED' : e.code || 'SOURCE_ERROR', message: e.name === 'NotAllowedError' ? "Your browser needs a tap to play audio. Press Play." : e.message || "This song’s source could not be reached.", retryable: e.name === 'NotAllowedError' || e.retryable !== false}, generation);
    }
  }
  private buffer(generation: number) {
    if (!this.wanted || this.snapshot.state === 'error') return;
    this.update({state: 'buffering'}); this.event('buffering');
    if (this.firstSound && !this.deadline) this.deadline = setTimeout(() => this.fail({code: 'STALL_TIMEOUT', message: "Connection lost. Please try again.", retryable: true}, generation), START_TIMEOUT);
  }
  private mediaFailure(generation: number) {
    if (generation !== this.generation) return;
    if (this.retryCount < 1 && performance.now() - this.startedAt < START_TIMEOUT - 500) {
      this.retryCount++;
      const decodeFailure = [3, 4].includes(this.audio.error?.code || 0);
      const fallback = decodeFailure && this.track()?.kaynak === 'kutuphane' ? this.fallbackUrl : undefined;
      if (fallback) this.update({notice: "Preparing a compatible audio format for your browser."});
      void this.load(this.autoAttempt, this.audio.currentTime || this.snapshot.position, true, fallback); return;
    }
    this.fail({code: 'MEDIA_ERROR', message: "The audio source could not be opened, or its format is unsupported.", retryable: true}, generation);
  }
  private fail(error: PlaybackError, generation: number) {
    if (generation !== this.generation) return;
    this.event(error.code); this.failures++;
    const automatic = this.autoAttempt;
    this.wanted = false; this.stopAttempt();
    this.update({state: 'error', error});
    if (automatic && this.failures < 3 && this.snapshot.index < this.snapshot.queue.length - 1) {
      this.update({notice: `${this.track()?.baslik}: ${error.message} Trying the next track.`});
      this.next(1, true, true);
    } else if (automatic && this.failures >= 3) this.update({notice: "Three tracks could not be opened. Playback stopped."});
  }
  setCrossfade = (seconds: number) => this.update({crossfade: [0, 3, 6, 9, 12].includes(seconds) ? seconds : 0});
  play = (track: Parca, list: Parca[] = [track]) => {
    this.stopFade();
    if(['preparing','buffering'].includes(this.snapshot.state)&&!this.firstSound)this.event('cancelled');
    this.radioGeneration++;
    this.failures = 0;
    const original = list.map(entry);
    const selectedIndex = Math.max(0, list.indexOf(track) >= 0 ? list.indexOf(track) : list.findIndex(p => p.id === track.id && p.kaynak === track.kaynak));
    const queue = this.snapshot.shuffle ? shuffled(original, original[selectedIndex]) : original;
    this.update({original, queue, index: this.snapshot.shuffle ? 0 : selectedIndex, notice: ''});
    void this.load(false);
  };
  select = (index: number) => { if (!this.snapshot.queue[index]) return; this.stopFade(); if(['preparing','buffering'].includes(this.snapshot.state)&&!this.firstSound)this.event('cancelled');this.radioGeneration++; this.failures = 0; this.update({index, notice: ''}); void this.load(false); };
  next = (direction: number, automatic = false, skipRepeatOne = false) => {
    const {queue, index, repeat} = this.snapshot;
    if (!queue.length) return;
    if (!automatic && this.snapshot.position > 3 && direction < 0) { this.seek(0); return; }
    if(!automatic && ['preparing','buffering'].includes(this.snapshot.state)&&!this.firstSound)this.event('cancelled');
    // Only a song that was heard (at least a second) and left early is a skip.
    if (!automatic && this.snapshot.state === 'playing' && this.snapshot.position >= 1 && this.snapshot.position < 30) this.event('skip', {reason: 'next'});
    let next = automatic && !skipRepeatOne && repeat === 'tek' ? index : index + direction;
    if (repeat === 'tumu') next = (next + queue.length) % queue.length;
    if (next < 0) { this.seek(0); return; }
    if (next >= queue.length) {
      this.wanted = false; this.stopAttempt(); this.update({state: 'ended'});
      if (automatic && this.snapshot.autoplay && this.radio && this.track()) {
        const token = ++this.radioGeneration;
        const current = this.track()!;
        void this.radio(current).then(tracks => {
          if (token !== this.radioGeneration || this.snapshot.state !== 'ended') return;
          const previous = new Set(queue.map(p => `${p.kaynak}:${p.id}`));
          const additions = tracks.filter(p => !previous.has(`${p.kaynak}:${p.id}`)).map(entry);
          if (additions.length) { this.update({queue: [...queue, ...additions], original: [...this.snapshot.original, ...additions], index: queue.length}); void this.load(true); }
        }).catch(() => this.update({notice: "Radio could not be loaded."}));
      }
      return;
    }
    if (!automatic) this.failures = 0;
    this.update({index: next}); void this.load(automatic);
  };
  toggle = () => {
    if (!this.track()) return;
    if (this.wanted && ['preparing', 'buffering', 'playing'].includes(this.snapshot.state)) {
      this.stopFade(); this.wanted = false; clearTimeout(this.deadline); this.deadline = undefined;
      if (this.snapshot.state === 'preparing') this.stopAttempt(); else this.audio.pause();
      this.update({state: 'paused'}); this.event('paused');
    } else if (this.audio.getAttribute('src') && !['error', 'ended'].includes(this.snapshot.state)) {
      this.wanted = true;
      const generation = this.generation;
      this.update({state: 'buffering', error: null});
      clearTimeout(this.deadline);
      this.deadline = setTimeout(() => this.fail({code: 'RESUME_TIMEOUT', message: "Playback could not continue. Please try again.", retryable: true}, generation), START_TIMEOUT);
      this.event('resume');
      this.audio.play().catch(e => {
        if (generation !== this.generation || !this.wanted || e.name === 'AbortError') return;
        this.fail({code: e.name === 'NotAllowedError' ? 'USER_GESTURE_REQUIRED' : 'MEDIA_ERROR', message: e.name === 'NotAllowedError' ? "Tap again to play." : "The audio source could not be opened.", retryable: true}, generation);
      });
    } else { this.failures = 0; void this.load(false, this.snapshot.state === 'ended' ? 0 : this.snapshot.position); }
  };
  pause = () => { this.stopFade(); this.wanted = false; clearTimeout(this.deadline); this.deadline = undefined; if (this.snapshot.state === 'preparing') this.stopAttempt(); else this.audio.pause(); if (this.track()) this.update({state: 'paused'}); };
  retry = () => { this.failures = 0; this.update({notice: ''}); void this.load(false, this.snapshot.position); };
  seek = (percent: number) => { const position = Math.max(0, Math.min(this.snapshot.duration, percent / 100 * this.snapshot.duration)); if (this.audio.getAttribute('src')) this.audio.currentTime = position; this.update({position}); };
  volume = (volume: number) => { volume = Math.min(100, Math.max(0, volume)); this.update({volume}); this.applyVolume(); };
  toggleNormalize = () => { this.update({normalize: !this.snapshot.normalize}); this.applyVolume(true); };
  repeat = () => this.update({repeat: this.snapshot.repeat === 'kapali' ? 'tumu' : this.snapshot.repeat === 'tumu' ? 'tek' : 'kapali'});
  autoplay = () => this.update({autoplay: !this.snapshot.autoplay});
  shuffle = () => {
    const current = this.track();
    const queue = this.snapshot.shuffle ? [...this.snapshot.original] : shuffled(this.snapshot.queue, current);
    this.update({shuffle: !this.snapshot.shuffle, queue, index: queue.findIndex(p => p.queueId === current?.queueId)});
  };
  updateTrack = (track: Parca) => {
    const update = (p: QueueEntry) => (track.appId && p.appId === track.appId) || (p.id === track.id && p.kaynak === track.kaynak) ? {...p, favori: track.favori} : p;
    this.update({queue: this.snapshot.queue.map(update), original: this.snapshot.original.map(update)});
  };
  add = (track: Parca) => { const p = entry(track); this.update({queue: [...this.snapshot.queue, p], original: [...this.snapshot.original, p]}); };
  playNext = (track: Parca) => {
    const current = this.track();
    if (!current) { this.play(track); return; }
    const p = entry(track), queue = [...this.snapshot.queue], original = [...this.snapshot.original];
    queue.splice(this.snapshot.index + 1, 0, p);
    original.splice(original.findIndex(x => x.queueId === current.queueId) + 1, 0, p);
    this.update({queue, original});
  };
  /** Page "Shuffle" buttons turn on shuffle mode, so Next keeps shuffling and turning it off restores order. */
  shuffleAll = (list: Parca[]) => {
    if (!list.length) return;
    if (!this.snapshot.shuffle) this.update({shuffle: true});
    this.play(list[Math.floor(Math.random() * list.length)], list);
  };
  toggleMute = () => {
    if (this.snapshot.volume > 0) { this.unmutedVolume = this.snapshot.volume; this.volume(0); }
    else this.volume(this.unmutedVolume || 70);
  };
  clearNotice = () => this.update({notice: ''});
  /** Smart Shuffle: the list shuffled with a recommended song after every three; turning shuffle off removes them. */
  smartShuffle = (tracks: Parca[], recommended: Parca[]) => {
    if (!tracks.length) return;
    this.stopFade(); this.radioGeneration++; this.failures = 0;
    const entries = tracks.map(entry), extra = recommended.map(p => entry({...p, oneri: true})), queue: QueueEntry[] = [];
    shuffled(entries, undefined).forEach((p, i) => { queue.push(p); if (i % 3 === 2 && extra.length) queue.push(extra.shift()!); });
    this.update({shuffle: true, original: entries, queue, index: 0, notice: ''});
    void this.load(false);
  };
  /** Removes everything after the current song; returns what was removed so it can be put back. */
  clearUpcoming = () => {
    const {queue, original, index} = this.snapshot, removed = queue.slice(index + 1);
    if (!removed.length) return () => {};
    const ids = new Set(removed.map(p => p.queueId));
    this.update({queue: queue.slice(0, index + 1), original: original.filter(p => !ids.has(p.queueId))});
    return () => { if (this.snapshot.queue.some(p => ids.has(p.queueId))) return; this.update({queue: [...this.snapshot.queue, ...removed], original: [...this.snapshot.original, ...removed]}); };
  };
  remove = (index: number) => {
    const removed = this.snapshot.queue[index]; if (!removed) return;
    this.removed={item:removed,index,originalIndex:this.snapshot.original.findIndex(p=>p.queueId===removed.queueId)};
    const current = this.track();
    const wasActive = this.wanted;
    const queue = this.snapshot.queue.filter(p => p.queueId !== removed.queueId);
    const original = this.snapshot.original.filter(p => p.queueId !== removed.queueId);
    const currentRemoved = current?.queueId === removed.queueId;
    const nextIndex = currentRemoved ? (index < queue.length ? index : -1) : queue.findIndex(p => p.queueId === current?.queueId);
    this.update({queue, original, index: nextIndex});
    if (currentRemoved) {
      this.stopAttempt();
      if (nextIndex >= 0 && wasActive) void this.load(false); else if (nextIndex >= 0) { this.wanted = false; this.update({state: 'paused', position: 0, duration: queue[nextIndex].sure || 0, error: null}); } else { this.wanted = false; this.update({state: 'idle', position: 0, duration: 0, error: null}); }
    }
  };
  undoRemove = () => {
    if(!this.removed)return;const {item,index,originalIndex}=this.removed;this.removed=undefined;
    if(this.snapshot.queue.some(p=>p.queueId===item.queueId))return;
    const current=this.track(),queue=[...this.snapshot.queue],original=[...this.snapshot.original];
    queue.splice(Math.min(index,queue.length),0,item);original.splice(Math.max(0,Math.min(originalIndex,original.length)),0,item);
    this.update({queue,original,index:current?queue.findIndex(p=>p.queueId===current.queueId):-1});
  };
  sleep = (minutes:number) => {
    clearTimeout(this.sleepTimer);this.update({sleepUntil:minutes>0?Date.now()+minutes*60000:undefined,sleepAtEnd:minutes===-1});
    if(minutes>0)this.sleepTimer=setTimeout(()=>{this.pause();this.update({sleepUntil:undefined})},minutes*60000);
  };
  move = (index: number, direction: number) => {
    const target = index + direction;
    if (target < 0 || target >= this.snapshot.queue.length) return;
    const current = this.track(); const queue = [...this.snapshot.queue];
    queue.splice(target,0,queue.splice(index,1)[0]);
    this.update({queue, original: this.snapshot.shuffle ? this.snapshot.original : queue, index: queue.findIndex(p => p.queueId === current?.queueId)});
  };
  restore = (queue: Parca[], index: number, position: number) => {
    this.stopFade();
    this.radioGeneration++;
    this.wanted = false; this.stopAttempt(); this.failures = 0;
    const original = queue.map(entry);
    const selected = !original.length || index === -1 ? -1 : Math.min(original.length - 1, Math.max(0, Number.isFinite(index) ? Math.floor(index) : 0));
    this.update({queue: original, original, index: selected, shuffle: false, state: selected < 0 ? 'idle' : 'paused', position: 0, duration: 0, error: null, notice: '', format: undefined, bitrate: undefined});
    if (selected >= 0) void this.load(false, Math.max(0, position || 0));
  };
  destroy = () => { clearTimeout(this.sleepTimer); clearTimeout(this.saveTimer); clearInterval(this.gainRamp); this.clearPreload(); this.stopFade();this.radioGeneration++; this.save(); this.stopAttempt(); this.listeners.clear(); };
}
