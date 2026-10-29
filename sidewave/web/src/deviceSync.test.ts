import {describe, expect, it} from 'vitest';
import {DeviceTakeovers} from './deviceSync';
describe('explicit device takeover revisions', () => {
  it('pauses A when B takes over before any heartbeat ever observed A as owner', () => {
    const tracker = new DeviceTakeovers();
    expect(tracker.observe(0, null, 'A')).toBe(false);
    expect(tracker.observe(100, 'B', 'A')).toBe(true);
  });
  it('never reapplies an old revision or regresses from a delayed response', () => {
    const tracker = new DeviceTakeovers();
    expect(tracker.observe(200, 'A', 'A')).toBe(false);
    expect(tracker.observe(100, 'B', 'A')).toBe(false);
    expect(tracker.observe(200, 'B', 'A')).toBe(false);
    expect(tracker.observe(300, 'B', 'A')).toBe(true);
  });
});
