import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useMember } from './bilesenler/Membership';
import { api, ApiError, kapakSrc, type Device } from './api';
import { PlayerController, uid } from './player';
import {DeviceTakeovers} from './deviceSync';
import {flushEvents, reportEvent} from './telemetry';
export type { Tekrar } from './player';
const deviceId = () => { try { let id = localStorage.getItem('sidewave-device'); if (!id) { id = uid(); localStorage.setItem('sidewave-device', id); } return id; } catch { return uid(); } };
export function useCalar() {
  const member = useMember();
  const id = useRef(deviceId());
  const controller = useRef<PlayerController | null>(null);
  if (!controller.current) {
    let storage: Pick<Storage,'getItem'|'setItem'> | undefined;
    const prefix='sidewave-account-'+(member?.user.id||'legacy')+':';
    try { const browserStorage=localStorage;storage={getItem:key=>browserStorage.getItem(prefix+key),setItem:(key,value)=>browserStorage.setItem(prefix+key,value)}; } catch { /* Playback also works without persistence. */ }
    controller.current = new PlayerController(new Audio(), api.resolve, event => reportEvent(event, id.current), storage, async track => (await api.radyo(track)).parcalar, {createAudio: () => new Audio(), loudness: async track => (await api.loudness(track)).lufs});
  }
  const player = controller.current;
  const state = useSyncExternalStore(player.subscribe, player.getSnapshot);
  const track = state.queue[state.index] || null;
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceError, setDeviceError] = useState('');
  const takeovers = useRef(new DeviceTakeovers());
  const syncPromise = useRef<Promise<void> | null>(null);
  const revision = useRef<number | undefined>(undefined);
  const takingOver = useRef(false);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      // A focused track row or menu handles its own keys (Space on a row starts that song).
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'].includes(target?.tagName) || target?.isContentEditable) return;
      if (target?.closest?.('a, [role=button], [role=menuitem], [role=option], [role=tab], dialog[open]')) return;
      const s = player.getSnapshot(), seekBy = (delta: number) => { if (s.duration) player.seek(Math.max(0, Math.min(s.duration, player.getProgress().position + delta)) / s.duration * 100); };
      if (event.code === 'Space') { event.preventDefault(); player.toggle(); }
      else if (event.key === 'ArrowRight' && !event.shiftKey) { event.preventDefault(); seekBy(5); }
      else if (event.key === 'ArrowLeft' && !event.shiftKey) { event.preventDefault(); seekBy(-5); }
      else if (event.shiftKey && event.key === 'ArrowUp') { event.preventDefault(); player.volume(s.volume + 5); }
      else if (event.shiftKey && event.key === 'ArrowDown') { event.preventDefault(); player.volume(s.volume - 5); }
      else if (event.shiftKey && (event.key === 'N' || event.key === 'ArrowRight')) { event.preventDefault(); player.next(1); }
      else if (event.shiftKey && (event.key === 'P' || event.key === 'ArrowLeft')) { event.preventDefault(); player.next(-1); }
      else if (!event.shiftKey && event.key.toLowerCase() === 'm') { event.preventDefault(); player.toggleMute(); }
    };
    const save = () => player.save();
    window.addEventListener('keydown', keyboard); window.addEventListener('pagehide', save);
    return () => { window.removeEventListener('keydown', keyboard); window.removeEventListener('pagehide', save); player.pause(); };
  }, [player]);
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const cover = track && kapakSrc(track, 512);
    const artwork = track ? [96, 256, 512].map(size => kapakSrc(track, size)).filter((src): src is string => !!src).map((src, i) => ({src: new URL(src, location.href).href, sizes: `${[96, 256, 512][i]}x${[96, 256, 512][i]}`})) : [];
    navigator.mediaSession.metadata = track ? new MediaMetadata({title: track.baslik, artist: track.sanatci, album: track.album || 'Sidewave', artwork: cover ? artwork : []}) : null;
    const seekTo = (seconds: number) => player.seek(Math.max(0, seconds) / (player.getSnapshot().duration || 1) * 100);
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [['play', () => { if (player.getSnapshot().state !== 'playing') player.toggle(); }], ['pause', () => player.pause()], ['nexttrack', () => player.next(1)], ['previoustrack', () => player.next(-1)], ['seekto', e => seekTo(e.seekTime || 0)], ['seekbackward', e => seekTo(player.getProgress().position - (e.seekOffset || 10))], ['seekforward', e => seekTo(player.getProgress().position + (e.seekOffset || 10))]];
    handlers.forEach(([action, handler]) => { try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* Optional browser action. */ } });
    return () => handlers.forEach(([action]) => { try { navigator.mediaSession.setActionHandler(action, null); } catch { /* Optional browser action. */ } });
  }, [track?.queueId, player]);
  useEffect(() => {
    // Lock screens and headphones show progress only when the position state is published.
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    let last = 0;
    const publish = (force = false) => {
      const {position, duration} = player.getProgress();
      if (!duration || !Number.isFinite(duration) || (!force && Date.now() - last < 5000)) return;
      last = Date.now();
      try { navigator.mediaSession.setPositionState({duration, position: Math.min(position, duration), playbackRate: 1}); } catch { /* Optional browser feature. */ }
    };
    publish(true);
    const unsubscribe = player.subscribeProgress(() => publish());
    return () => { unsubscribe(); };
  }, [player, state.state, track?.queueId]);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (stopped) return;
      const sync = async () => {
        if (takingOver.current) return;
        void flushEvents();
        try {
          const d = await api.devices(); if (stopped) return;
          if (takeovers.current.observe(d.takeoverAt, d.activeDeviceId, id.current)) player.pause();
          setDevices(d.devices); setDeviceError('');
          const s = player.getSnapshot();
          const saved=await api.heartbeat(id.current, {queueRevision:revision.current,name: /Android|iPhone/i.test(navigator.userAgent) ? "Mobile browser" : "Web player", queue: s.queue, index: s.index, position: player.getProgress().position, state: s.state});revision.current=saved.queueRevision;
        } catch (e) {
          if (stopped) return;
          // Another tab with this device ID advanced the queue revision. Rejoin from the server's
          // current revision on the next heartbeat instead of failing every five seconds.
          if (e instanceof ApiError && e.code === "DEVICE_CONFLICT") { revision.current = undefined; return; }
          setDeviceError("Could not connect this device.");
        }
      };
      const promise = sync(); syncPromise.current = promise;
      // A hidden, silent tab only needs an occasional heartbeat.
      void promise.finally(() => { if (syncPromise.current === promise) syncPromise.current = null; if (!stopped) timer = setTimeout(tick, document.hidden && player.getSnapshot().state !== 'playing' ? 30000 : 5000); });
    };
    tick();
    const visible = () => { if (!document.hidden && !syncPromise.current) { clearTimeout(timer); tick(); } };
    document.addEventListener('visibilitychange', visible);
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', visible); };
  }, [player]);
  useEffect(() => {
    if (state.state !== 'playing' || state.repeat==='tek') return;
    const next = state.queue[state.index + 1] || (state.repeat==='tumu'?state.queue[0]:null);
    if (!next || next.kaynak!=='youtube' || next.id===track?.id) return;
    const controller=new AbortController();let subscription:string|null=null;
    const timer=setTimeout(()=>{void (async()=>{
      try {
        let result=await api.prepare(next,controller.signal);subscription=result.id;
        while(subscription && ['accepted','warming'].includes(result.state) && !controller.signal.aborted) {
          await new Promise<void>(resolve=>{const delay=setTimeout(resolve,2000);controller.signal.addEventListener('abort',()=>{clearTimeout(delay);resolve()},{once:true});});
          if(!controller.signal.aborted)result=await api.preparation(subscription,controller.signal);
        }
      } catch { /* Readiness is optional; direct playback remains available. */ }
      finally {if(subscription)void api.cancelPreparation(subscription).catch(()=>{});}
    })();},250);
    return ()=>{clearTimeout(timer);controller.abort();};
  }, [state.state, state.index, state.repeat, state.queue[state.index + 1]?.queueId]);
  const takeover = async () => {
    if (takingOver.current) return;
    takingOver.current = true;
    try {
      // Finish an older heartbeat before copying a new device queue into this one.
      await syncPromise.current;
      const d = await api.takeover(id.current);
      revision.current=d.queueRevision;player.restore(d.queue, d.index, d.position); setDeviceError('');
    } catch (e) { setDeviceError((e as Error).message); }
    finally { takingOver.current = false; }
  };
  return {
    kuyruk: state.queue, indeks: state.index, calan: track, oynuyor: state.state === 'playing',
    progress: {subscribe: player.subscribeProgress, get: player.getProgress},
    ses: state.volume, karistir: state.shuffle, tekrar: state.repeat, durum: state.state, hata: state.error, uyari: state.notice, otomatik: state.autoplay,
    cal: player.play, atla: player.next, atlaIndekse: player.select, kuyruktanCikar: player.remove, kuyrugaEkle: player.add, siradakiOlarak: player.playNext, karistirCal: player.shuffleAll, tasi: player.move,
    sessiz: player.toggleMute, uyariKapat: player.clearNotice, akilliKaristir: player.smartShuffle, kuyruguTemizle: player.clearUpcoming, dengele: state.normalize, dengeleDegistir: player.toggleNormalize, gecis: state.crossfade, gecisAyarla: player.setCrossfade,
    oynatDurdur: player.toggle, sar: player.seek, setSes: player.volume, karistirDegistir: player.shuffle, tekrarDegistir: player.repeat,
    kaldirmayiGeriAl:player.undoRemove, uyku:player.sleep, uykuSonu:state.sleepAtEnd, uykuZamani:state.sleepUntil,
    parcaGuncelle: player.updateTrack, yenidenDene: player.retry, otomatikDegistir: player.autoplay, devices, deviceId: id.current, deviceError, takeover,
  };
}
export type Calar = ReturnType<typeof useCalar>;
/** Subscribes only the component that shows the position, not the whole app. */
export function useProgress(calar: Pick<Calar, 'progress'>) { return useSyncExternalStore(calar.progress.subscribe, calar.progress.get); }
