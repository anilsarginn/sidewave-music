import {api} from './api';
import {uid, type PlayerEvent} from './player';
type PendingEvent = PlayerEvent & {id: string; deviceId: string; occurredAt: number; code?: string};
let pending: PendingEvent[] = [];
try { const saved = JSON.parse(localStorage.getItem('sidewave-events-v1') || '[]'); if (Array.isArray(saved)) pending = saved.slice(-1000); } catch { /* Storage is optional. */ }
let flushing = false;
const save = () => { try { localStorage.setItem('sidewave-events-v1', JSON.stringify(pending)); } catch { /* Playback is independent from history persistence. */ } };
export async function flushEvents() {
  if (flushing) return;
  flushing = true;
  try { while (pending.length) { await api.event(pending[0]); pending.shift(); save(); } } catch { /* Retry after the next heartbeat or reconnect. */ } finally { flushing = false; }
}
export function reportEvent(event: PlayerEvent, deviceId: string) {
  const mapped = event.event === 'attempt' ? 'started' : event.event === 'first_sound' ? 'playing' : /^[A-Z_]+$/.test(event.event) ? 'error' : event.event;
  if (!['started', 'playing', 'paused', 'ended', 'error', 'buffering', 'skip', 'resume', 'progress', 'summary', 'cancelled'].includes(mapped)) return;
  pending.push({...event, id: uid(), occurredAt: Date.now(), event: mapped, deviceId, code: mapped === 'error' ? event.event : undefined});
  pending = pending.slice(-1000); save(); void flushEvents();
}

export function resetAccountEvents(){ pending=[];save(); }
