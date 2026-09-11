// What this fake exists to make testable is the FAILED sweep.
//
// Two config dirs are two `claude` invocations (RESEARCH.md B.2) and one being broken must not
// lose the other. `failed` is also not `sessions: []` — "unreadable" and "nothing running" are
// different answers and the deck shows them differently (contracts/session-row.ts `unreadable`).
import { describe, expect, it } from 'vitest';
import { FakeSessionSource } from './fake-session-source.ts';

describe('FakeSessionSource', () => {
  it('answers an unprogrammed subscription with an empty, successful sweep', async () => {
    const source = new FakeSessionSource();

    const sweep = await source.sweep('365');

    expect(sweep).toEqual({ subscription: '365', sessions: [], failed: false, skipped: 0 });
  });

  it('distinguishes a failed sweep from an empty one', async () => {
    const source = new FakeSessionSource();
    source.willFail('isg');

    const [broken, fine] = [await source.sweep('isg'), await source.sweep('365')];

    expect(broken.failed).toBe(true);
    expect(fine.failed).toBe(false);
  });

  it('keeps each subscription answering for itself', async () => {
    const source = new FakeSessionSource();
    source.willFail('isg');
    source.willSkip('365', 2);

    expect((await source.sweep('365')).skipped).toBe(2);
    expect((await source.sweep('365')).failed).toBe(false);
  });

  it('records who was swept and how often, for the reconciler timer', async () => {
    const source = new FakeSessionSource();

    await source.sweep('365');
    await source.sweep('365');
    await source.sweep('isg');

    expect(source.sweepCount('365')).toBe(2);
    expect(source.swept).toEqual(['365', '365', 'isg']);
  });
});
