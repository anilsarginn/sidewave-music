import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerController, type Resolver } from './player';
import type { Parca } from './api';
class FakeAudio extends EventTarget {
  error: {code: number} | null = null;
  src = ''; currentTime = 0; duration = 180; volume = 1; paused = true;
  load = vi.fn(); play = vi.fn(async () => { this.paused = false; });
  pause = vi.fn(() => { this.paused = true; this.dispatchEvent(new Event('pause')); });
  removeAttribute = (name: string) => { if (name === 'src') this.src = ''; };
  getAttribute = () => this.src;
  emit(name: string) { this.dispatchEvent(new Event(name)); }
}
const p = (id: string): Parca => ({id, baslik: `Şarkı ${id}`, kaynak: 'youtube', sure: 180});
let audio: FakeAudio; let player: PlayerController;
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function setup(resolve: Resolver = async track => ({url: `/stream/${track.id}`})) {
  player = new PlayerController(audio as unknown as HTMLAudioElement, resolve, vi.fn(), localStorage);
  return player;
}
beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); audio = new FakeAudio(); });
afterEach(() => { player?.destroy(); vi.useRealTimers(); });
describe('playback lifecycle', () => {
  it('marks playing only after actual playing event, never from play promise', async () => {
    setup().play(p('a')); await settle();
    expect(player.getSnapshot().state).toBe('preparing');
    audio.emit('playing'); expect(player.getSnapshot().state).toBe('playing');
    audio.emit('waiting'); expect(player.getSnapshot().state).toBe('buffering');
    audio.emit('playing'); expect(player.getSnapshot().state).toBe('playing');
  });
  it('cancels old requests and ignores their late resolution', async () => {
    const deferred: ((value: {url: string}) => void)[] = []; const signals: AbortSignal[] = [];
    setup((_, __, signal) => { signals.push(signal); return new Promise(resolve => deferred.push(resolve)); });
    player.play(p('a')); player.play(p('b'));
    expect(signals[0].aborted).toBe(true);
    deferred[1]({url: '/b'}); await settle(); deferred[0]({url: '/a'}); await settle();
    expect(audio.src).toBe('/b'); expect(player.getSnapshot().queue[0].id).toBe('b');
  });
  it('ends unresolved attempts after 15 seconds', async () => {
    setup(() => new Promise(() => {})).play(p('a'));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(player.getSnapshot().error?.code).toBe('START_TIMEOUT');
    expect(player.getSnapshot().state).toBe('error'); expect(audio.src).toBe('');
  });
  it('ends stalls after 15 seconds even after first sound', async () => {
    setup().play(p('a')); await settle(); audio.emit('playing'); audio.emit('waiting');
    await vi.advanceTimersByTimeAsync(15_000);
    expect(player.getSnapshot().error?.code).toBe('STALL_TIMEOUT');
  });
  it('distinguishes browser interaction restrictions', async () => {
    audio.play.mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError'));
    setup().play(p('a')); await settle();
    expect(player.getSnapshot().error?.code).toBe('USER_GESTURE_REQUIRED');
    player.retry(); await settle(); audio.emit('playing'); expect(player.getSnapshot().state).toBe('playing');
  });
  it('pausing while resolving prevents delayed playback', async () => {
    let done!: (value: {url: string}) => void;
    setup(() => new Promise(resolve => { done = resolve; })).play(p('a')); player.pause();
    done({url: '/a'}); await settle();
    expect(audio.play).not.toHaveBeenCalled(); expect(player.getSnapshot().state).toBe('paused');
  });
  it('ignores an old resume rejection after selecting another track', async () => {
    setup().play(p('a')); await settle(); audio.emit('playing'); player.pause();
    let rejectResume!: (reason: unknown) => void;
    audio.play.mockImplementationOnce(() => new Promise((_, reject) => { rejectResume = reject; }));
    player.toggle(); player.play(p('b')); await settle(); audio.emit('playing');
    rejectResume(new DOMException('old promise', 'NotAllowedError')); await settle();
    expect(player.getSnapshot().state).toBe('playing'); expect(player.getSnapshot().queue[0].id).toBe('b'); expect(player.getSnapshot().error).toBeNull();
  });
  it('times out a resume promise even when the media element emits no events', async () => {
    setup().play(p('a')); await settle(); audio.emit('playing'); player.pause();
    audio.play.mockImplementationOnce(() => new Promise(() => {})); player.toggle();
    expect(player.getSnapshot().state).toBe('buffering'); await vi.advanceTimersByTimeAsync(15_000);
    expect(player.getSnapshot().error?.code).toBe('RESUME_TIMEOUT'); expect(player.getSnapshot().state).toBe('error');
  });
  it('retries a broken media URL at most once within the original attempt', async () => {
    const resolver = vi.fn(async () => ({url: '/a'})); setup(resolver).play(p('a')); await settle();
    audio.emit('error'); await settle(); audio.emit('error'); await settle();
    expect(resolver).toHaveBeenCalledTimes(2); expect(player.getSnapshot().state).toBe('error');
  });
  it('falls back once for a local decode failure without restarting the deadline', async () => {
    const resolver = vi.fn(async () => ({url: '/local.m4a', fallbackUrl: '/local?format=mp3'}));
    setup(resolver).play({...p('a'), kaynak: 'kutuphane'}); await settle();
    const queueId = player.getSnapshot().queue[0].queueId;
    await vi.advanceTimersByTimeAsync(10_000); audio.error = {code: 4}; audio.emit('error'); await settle();
    expect(audio.src).toBe('/local?format=mp3'); expect(resolver).toHaveBeenCalledTimes(1);
    expect(player.getSnapshot().queue[0].queueId).toBe(queueId);
    await vi.advanceTimersByTimeAsync(5_000); expect(player.getSnapshot().error?.code).toBe('START_TIMEOUT');
  });
  it('keeps archive metadata canonical while displaying the effective MP3 fallback', async () => {
    const report = vi.fn(); player = new PlayerController(audio as unknown as HTMLAudioElement, async () => ({url: '/local.m4a', fallbackUrl: '/local?format=mp3'}), report);
    player.play({...p('a'), kaynak: 'kutuphane', bicim: 'M4A', bitrate: 2117}); await settle();
    audio.error = {code: 4}; audio.emit('error'); await settle(); audio.emit('playing');
    expect(player.getSnapshot()).toMatchObject({format: 'mp3', bitrate: undefined, notice: ''});
    expect(player.getSnapshot().queue[0]).toMatchObject({bicim: 'M4A', bitrate: 2117});
    const event = report.mock.calls.map(([event]) => event).find(event => event.event === 'first_sound');
    expect(event.parca).toMatchObject({bicim: 'M4A', bitrate: 2117});
  });
  it('does not loop when the local format fallback also fails', async () => {
    setup(async () => ({url: '/local.m4a', fallbackUrl: '/local?format=mp3'})).play({...p('a'), kaynak: 'kutuphane'}); await settle();
    audio.error = {code: 3}; audio.emit('error'); await settle(); audio.emit('error'); await settle();
    expect(player.getSnapshot().state).toBe('error'); expect(audio.play).toHaveBeenCalledTimes(2);
  });
  it('automatically skips failures but stops after three consecutive failures', async () => {
    setup(async track => { if (track.id !== 'a') throw new Error('Unavailable'); return {url: '/a'}; });
    const tracks = ['a', 'b', 'c', 'd', 'e'].map(p); player.play(tracks[0], tracks); await settle(); audio.emit('playing'); audio.emit('ended'); await settle(); await settle(); await settle();
    expect(player.getSnapshot().index).toBe(3); expect(player.getSnapshot().state).toBe('error');
    expect(player.getSnapshot().notice).toContain('Three tracks');
  });
  it('skips an automatic failure even when repeat-one is enabled', async () => {
    setup(async track => { if (track.id === 'b') throw new Error('Unavailable'); return {url: `/stream/${track.id}`}; });
    const tracks = ['a', 'b', 'c'].map(p); player.play(tracks[0], tracks); await settle(); audio.emit('playing');
    player.repeat(); player.repeat(); player.next(1, true, true); await settle(); await settle();
    expect(player.getSnapshot().queue[player.getSnapshot().index].id).toBe('c'); expect(audio.src).toBe('/stream/c');
  });
  it('ends normally at queue end and repeat-one reloads the same entry', async () => {
    setup().play(p('a')); await settle(); audio.emit('playing'); audio.emit('ended');
    expect(player.getSnapshot().state).toBe('ended');
    player.repeat(); player.repeat(); player.retry(); await settle(); audio.emit('ended'); await settle();
    expect(player.getSnapshot().index).toBe(0); expect(audio.src).toBe('/stream/a');
  });
});
describe('persistent queue identity', () => {
  it('distinguishes two occurrences of the same song', async () => {
    const a = p('a'), duplicate = {...a}; setup().play(duplicate, [a, duplicate, p('b')]); await settle();
    const state = player.getSnapshot(); expect(state.index).toBe(1);
    expect(new Set(state.queue.map(p => p.queueId)).size).toBe(3);
    player.shuffle(); player.shuffle(); expect(player.getSnapshot().index).toBe(1);
  });
  it('retains additions and removals when shuffle turns off', async () => {
    const tracks = ['a', 'b', 'c'].map(p); setup().play(tracks[0], tracks); await settle();
    player.shuffle(); player.add(p('d')); const index = player.getSnapshot().queue.findIndex(p => p.id === 'b'); player.remove(index); player.shuffle();
    expect(player.getSnapshot().queue.map(p => p.id)).toEqual(['a', 'c', 'd']); expect(player.getSnapshot().index).toBe(0);
  });
  it('removing the playing entry plays its successor; removing the last stops', async () => {
    const tracks = ['a', 'b'].map(p); setup().play(tracks[0], tracks); await settle(); player.remove(0); await settle();
    expect(audio.src).toBe('/stream/b'); expect(player.getSnapshot().index).toBe(0);
    player.remove(0); expect(player.getSnapshot().state).toBe('idle'); expect(audio.src).toBe('');
  });
  it('removing a paused selection keeps the successor paused', async () => {
    const tracks = ['a', 'b'].map(p); setup().play(tracks[0], tracks); await settle(); player.pause(); audio.play.mockClear(); player.remove(0); await settle();
    expect(player.getSnapshot().state).toBe('paused'); expect(player.getSnapshot().queue[0].id).toBe('b'); expect(audio.play).not.toHaveBeenCalled();
  });
  it('previous on the first item rewinds rather than ending playback', async () => {
    setup().play(p('a')); await settle(); audio.emit('playing'); player.next(-1);
    expect(player.getSnapshot().state).toBe('playing'); expect(player.getSnapshot().index).toBe(0);
  });
  it('moving entries preserves the selected occurrence', async () => {
    const tracks = ['a', 'b', 'c'].map(p); setup().play(tracks[1], tracks); await settle(); const id = player.getSnapshot().queue[1].queueId;
    player.move(1, -1); const s = player.getSnapshot(); expect(s.index).toBe(0); expect(s.queue[s.index].queueId).toBe(id);
  });
  it('restoring an empty device queue stops the previous audio', async () => {
    setup().play(p('a')); await settle(); audio.emit('playing'); player.restore([], -1, 0);
    expect(audio.src).toBe(''); expect(audio.paused).toBe(true); expect(player.getSnapshot()).toMatchObject({queue: [], index: -1, state: 'idle', position: 0});
  });
  it('preserves a stopped index after the last selected entry was removed', async () => {
    const tracks = ['a', 'b'].map(p); setup().play(tracks[1], tracks); await settle(); player.remove(1); player.destroy();
    audio = new FakeAudio(); setup(); expect(player.getSnapshot()).toMatchObject({index: -1, state: 'idle'}); expect(player.getSnapshot().queue).toHaveLength(1);
  });
  it('reconciles missing and duplicate original-order entries without losing queued tracks', () => {
    const a = {...p('a'), queueId: 'a-1'}, b = {...p('b'), queueId: 'b-1'}, c = {...p('c'), queueId: 'c-1'};
    localStorage.setItem('sidewave-player-v1', JSON.stringify({queue: [c, a, b], original: [a, a, {...p('deleted'), queueId: 'deleted'}], index: 0, shuffle: true}));
    setup(); player.shuffle(); const s = player.getSnapshot();
    expect(s.queue.map(p => p.id)).toEqual(['a', 'c', 'b']); expect(s.queue[s.index].id).toBe('c');
  });
  it('restores position and preferences without autoplaying on reopen', async () => {
    setup().play(p('a')); await settle(); audio.emit('playing'); audio.currentTime = 42; audio.emit('timeupdate'); player.volume(37); player.repeat(); player.destroy();
    audio = new FakeAudio(); setup();
    expect(player.getSnapshot()).toMatchObject({state: 'paused', position: 42, volume: 37, repeat: 'tumu'});
    expect(audio.play).not.toHaveBeenCalled(); player.toggle(); await settle(); audio.emit('loadedmetadata'); expect(audio.currentTime).toBe(42);
  });
});

describe('release 1.3 queue recovery and sleep', () => {
  it('undo restores the exact duplicate occurrence without changing the playing entry', async () => {
    const tracks=[p('a'),p('a'),p('b')];setup().play(tracks[0],tracks);await settle();
    const before=player.getSnapshot().queue.map(t=>t.queueId);player.remove(1);player.undoRemove();
    expect(player.getSnapshot().queue.map(t=>t.queueId)).toEqual(before);
    expect(player.getSnapshot().queue[player.getSnapshot().index].queueId).toBe(before[0]);
    player.undoRemove();expect(player.getSnapshot().queue).toHaveLength(3);
  });
  it('end-of-track sleep stops even when repeat and autoplay are enabled', async () => {
    const tracks=[p('a'),p('b')];setup().play(tracks[0],tracks);await settle();audio.emit('playing');
    player.repeat();player.repeat();player.sleep(-1);audio.emit('ended');await settle();
    expect(player.getSnapshot().state).toBe('ended');expect(player.getSnapshot().index).toBe(0);expect(audio.paused).toBe(true);
  });
  it('replacing a sleep timer cancels the old deadline', async () => {
    setup().play(p('a'));await settle();audio.emit('playing');player.sleep(15);player.sleep(30);
    await vi.advanceTimersByTimeAsync(15*60000);expect(audio.paused).toBe(false);
    await vi.advanceTimersByTimeAsync(15*60000);expect(audio.paused).toBe(true);
  });
});
describe('queue shortcuts and render isolation', () => {
  it('plays next right after the current entry, in both shuffled and original order', async () => {
    setup().play(p('a'), [p('a'), p('b'), p('c')]); await settle();
    player.playNext(p('x'));
    expect(player.getSnapshot().queue.map(t => t.id)).toEqual(['a', 'x', 'b', 'c']);
    player.shuffle(); player.shuffle();
    expect(player.getSnapshot().queue.map(t => t.id)).toEqual(['a', 'x', 'b', 'c']);
    player.next(1); expect(player.getSnapshot().queue[player.getSnapshot().index].id).toBe('x');
  });
  it('starts playback when play next is used with an empty queue', async () => {
    setup().playNext(p('solo')); await settle();
    expect(player.getSnapshot()).toMatchObject({index: 0, state: 'preparing'});
  });
  it('shuffle all enables shuffle mode and keeps every track', async () => {
    setup().shuffleAll([p('a'), p('b'), p('c'), p('d')]); await settle();
    const s = player.getSnapshot();
    expect(s.shuffle).toBe(true); expect(s.index).toBe(0);
    expect(s.queue.map(t => t.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  });
  it('mute remembers the previous volume', () => {
    setup(); player.volume(64); player.toggleMute();
    expect(player.getSnapshot().volume).toBe(0); expect(audio.volume).toBe(0);
    player.toggleMute(); expect(player.getSnapshot().volume).toBe(64);
  });
  it('position updates notify progress subscribers only', async () => {
    setup().play(p('a')); await settle(); audio.emit('playing');
    const main = vi.fn(), progress = vi.fn();
    player.subscribe(main); player.subscribeProgress(progress);
    for (const t of [1, 2, 3]) { audio.currentTime = t; audio.emit('timeupdate'); }
    expect(main).not.toHaveBeenCalled(); expect(progress).toHaveBeenCalledTimes(3);
    expect(player.getProgress().position).toBe(3); expect(player.getSnapshot().position).toBe(3);
  });
  it('coalesces storage writes', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    setup(); for (let i = 0; i < 20; i++) player.volume(i);
    expect(spy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(spy).toHaveBeenCalledTimes(1); spy.mockRestore();
  });
});

describe('gapless preload and volume levelling', () => {
  it('buffers the next entry near the end and switches to it without resolving again', async () => {
    const created: FakeAudio[] = []; const resolve = vi.fn(async (track: Parca) => ({url: `/stream/${track.id}`, gain: track.id === 'b' ? 0.5 : undefined}));
    player = new PlayerController(audio as unknown as HTMLAudioElement, resolve, vi.fn(), localStorage, undefined, {createAudio: () => { const a = new FakeAudio(); created.push(a); return a as unknown as HTMLAudioElement; }});
    player.play(p('a'), [p('a'), p('b')]); await settle(); audio.emit('playing');
    audio.currentTime = 100; audio.emit('timeupdate'); await settle();
    expect(created).toHaveLength(0);
    audio.currentTime = 165; audio.emit('timeupdate'); await settle();
    expect(created).toHaveLength(1); expect(created[0].src).toBe('/stream/b'); expect(resolve).toHaveBeenCalledTimes(2);
    created[0].load.mockClear();
    audio.emit('ended'); await settle();
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(created[0].load).not.toHaveBeenCalled();
    expect(created[0].play).toHaveBeenCalled();
    expect(audio.src).toBe('');
    expect(created[0].volume).toBe(0.5);
    created[0].emit('playing'); expect(player.getSnapshot()).toMatchObject({index: 1, state: 'playing'});
  });
  it('drops a preload when the next entry changes', async () => {
    const created: FakeAudio[] = [];
    player = new PlayerController(audio as unknown as HTMLAudioElement, async track => ({url: `/stream/${track.id}`}), vi.fn(), localStorage, undefined, {createAudio: () => { const a = new FakeAudio(); created.push(a); return a as unknown as HTMLAudioElement; }});
    player.play(p('a'), [p('a'), p('b')]); await settle(); audio.emit('playing');
    audio.currentTime = 170; audio.emit('timeupdate'); await settle();
    player.playNext(p('x')); audio.currentTime = 171; audio.emit('timeupdate'); await settle();
    expect(created.map(a => a.src)).toEqual(['', '/stream/x']);
  });
  it('fetches loudness after the first sound when the source did not include it and can be turned off', async () => {
    const loudness = vi.fn(async () => -8);
    player = new PlayerController(audio as unknown as HTMLAudioElement, async track => ({url: `/stream/${track.id}`}), vi.fn(), localStorage, undefined, {loudness});
    player.volume(80); player.play(p('a')); await settle(); audio.emit('playing'); await settle();
    await vi.advanceTimersByTimeAsync(600);
    expect(loudness).toHaveBeenCalledTimes(1);
    expect(audio.volume).toBeCloseTo(0.8 * Math.pow(10, -6 / 20), 5);
    player.toggleNormalize(); await vi.advanceTimersByTimeAsync(600);
    expect(audio.volume).toBeCloseTo(0.8, 5);
  });
});

describe('crossfade', () => {
  it('starts the preloaded next track while the old one fades out, then stops the old one', async () => {
    const created: FakeAudio[] = [];
    player = new PlayerController(audio as unknown as HTMLAudioElement, async track => ({url: `/stream/${track.id}`}), vi.fn(), localStorage, undefined, {createAudio: () => { const a = new FakeAudio(); created.push(a); return a as unknown as HTMLAudioElement; }});
    player.setCrossfade(6); player.play(p('a'), [p('a'), p('b')]); await settle(); audio.emit('playing');
    audio.currentTime = 160; audio.emit('timeupdate'); await settle();
    const next = created.find(a => a.src === '/stream/b')!; expect(next).toBeTruthy();
    audio.currentTime = 175; audio.emit('timeupdate'); await settle();
    expect(player.getSnapshot().index).toBe(1);
    expect(next.play).toHaveBeenCalled();
    expect(audio.paused).toBe(false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(audio.volume).toBeLessThan(0.6); expect(next.volume).toBeGreaterThan(0.4);
    await vi.advanceTimersByTimeAsync(3500);
    expect(audio.paused).toBe(true); expect(audio.src).toBe(''); expect(next.volume).toBeCloseTo(1, 5);
    next.emit('playing'); expect(player.getSnapshot().state).toBe('playing');
  });
  it('pausing during a crossfade silences the fading track too', async () => {
    const created: FakeAudio[] = [];
    player = new PlayerController(audio as unknown as HTMLAudioElement, async track => ({url: `/stream/${track.id}`}), vi.fn(), localStorage, undefined, {createAudio: () => { const a = new FakeAudio(); created.push(a); return a as unknown as HTMLAudioElement; }});
    player.setCrossfade(9); player.play(p('a'), [p('a'), p('b')]); await settle(); audio.emit('playing');
    audio.currentTime = 160; audio.emit('timeupdate'); await settle();
    audio.currentTime = 172; audio.emit('timeupdate'); await settle();
    player.pause(); expect(audio.paused).toBe(true);
  });
});

describe('smart shuffle and clearing the queue', () => {
  it('inserts a recommended song after every three and drops them when shuffle is turned off', async () => {
    setup().smartShuffle(['a', 'b', 'c', 'd', 'e', 'f'].map(p), [p('r1'), p('r2')]); await settle();
    const q = player.getSnapshot().queue;
    expect(q).toHaveLength(8); expect(q[3].oneri).toBe(true); expect(q[7].oneri).toBe(true); expect(player.getSnapshot().shuffle).toBe(true);
    player.shuffle();
    expect(player.getSnapshot().queue.map(t => t.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });
  it('clears upcoming songs and can put them back', async () => {
    setup().play(p('a'), [p('a'), p('b'), p('c')]); await settle();
    const undo = player.clearUpcoming();
    expect(player.getSnapshot().queue.map(t => t.id)).toEqual(['a']);
    undo(); expect(player.getSnapshot().queue.map(t => t.id)).toEqual(['a', 'b', 'c']);
  });
});
