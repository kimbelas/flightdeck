// P1-T4. Most of these assert something the reconciler must NOT do.
//
// The three traps in the class header are each a measured finding, and each of them is a way to
// tell the owner that their sessions ended when they did not: a failed sweep read as an empty one, a
// conclusion drawn from a single sweep, and a stopped session mistaken for a departed one. The
// last is settled in the adapter (`--all`); the first two are settled here.
//
// The six fakes the reconciler takes are assembled in reconciler-harness.ts.
import { describe, expect, it } from 'vitest';
import { rig, session, settle, typesOf } from './reconciler-harness.ts';

describe('Reconciler — what it publishes', () => {
  it('announces every session it has not seen before', async () => {
    const { reconciler, source, sink } = rig();
    source.willReturn('365', [session({ id: 'aaaaaaaa' }, '365')]);
    source.willReturn('isg', [session({ id: 'bbbbbbbb' }, 'isg')]);

    await reconciler.reconcile();

    expect(typesOf(sink)).toEqual(['seen', 'seen']);
    expect(sink.published.map((event) => event.subscription).sort()).toEqual(['365', 'isg']);
  });

  it('says nothing at all when nothing changed', async () => {
    const { reconciler, source, sink } = rig();
    source.willReturn('365', [session({ id: 'aaaaaaaa' }, '365')]);

    await reconciler.reconcile();
    await reconciler.reconcile();

    expect(typesOf(sink)).toEqual(['seen']);
  });

  it('announces a session whose state moved', async () => {
    const { reconciler, source, sink } = rig();
    source.willReturn('365', [session({ id: 'aaaaaaaa', runState: 'working' }, '365')]);
    await reconciler.reconcile();

    source.willReturn('365', [session({ id: 'aaaaaaaa', runState: 'blocked' }, '365')]);
    await reconciler.reconcile();

    expect(typesOf(sink)).toEqual(['seen', 'changed']);
  });

  it('carries the row as the payload, so a consumer needs nothing else', async () => {
    const { reconciler, source, sink } = rig();
    source.willReturn('365', [session({ id: 'aaaaaaaa', name: 'nightly' }, '365')]);

    await reconciler.reconcile();

    expect(sink.last?.payload).toMatchObject({ name: 'nightly', attachable: true });
    expect(sink.last?.source).toBe('reconcile');
  });
});

describe('Reconciler — trap 2: nothing permanent from one sweep', () => {
  it('does not announce a session gone the first time it is missing', async () => {
    const { reconciler, source, sink } = rig();
    source.willReturn('365', [session({ id: 'aaaaaaaa' }, '365')]);
    await reconciler.reconcile();

    source.willReturn('365', []);
    await reconciler.reconcile();

    // A record carries `state: working` before it carries `pid` (RESEARCH.md G.2) — one sweep is
    // not evidence that a session ended.
    expect(typesOf(sink)).toEqual(['seen']);
  });

  it('announces it gone on the second consecutive miss', async () => {
    const { reconciler, source, sink } = rig();
    source.willReturn('365', [session({ id: 'aaaaaaaa' }, '365')]);
    await reconciler.reconcile();

    source.willReturn('365', []);
    await reconciler.reconcile();
    await reconciler.reconcile();

    expect(typesOf(sink)).toEqual(['seen', 'gone']);
    expect(reconciler.sessions).toHaveLength(0);
  });

  it('forgets the miss when the session comes back', async () => {
    const { reconciler, source, sink } = rig();
    const present = [session({ id: 'aaaaaaaa' }, '365')];
    source.willReturn('365', present);
    await reconciler.reconcile();

    source.willReturn('365', []);
    await reconciler.reconcile();
    source.willReturn('365', present);
    await reconciler.reconcile();
    source.willReturn('365', []);
    await reconciler.reconcile();

    // Two misses, but not consecutive — the count reset when it reappeared.
    expect(typesOf(sink)).toEqual(['seen']);
  });

  it('counts misses against the session own subscription only', async () => {
    const { reconciler, source, sink } = rig();
    source.willReturn('365', [session({ id: 'aaaaaaaa' }, '365')]);
    source.willReturn('isg', []);
    await reconciler.reconcile();
    await reconciler.reconcile();

    // Two isg sweeps have come back without it, and it is not an isg session.
    expect(typesOf(sink)).toEqual(['seen']);
  });
});

describe('Reconciler — trap 1: a failed sweep is not an empty one', () => {
  it('never retires a session because its subscription could not be read', async () => {
    const { reconciler, source, sink } = rig();
    source.willReturn('365', [session({ id: 'aaaaaaaa' }, '365')]);
    await reconciler.reconcile();

    source.willFail('365');
    await reconciler.reconcile();
    await reconciler.reconcile();
    await reconciler.reconcile();

    expect(typesOf(sink)).toEqual(['seen']);
    expect(reconciler.sessions).toHaveLength(1);
  });

  it('names the unreadable subscription and logs it', async () => {
    const { reconciler, source, logger } = rig();
    source.willFail('isg');

    await reconciler.reconcile();

    expect(reconciler.unreadable).toEqual(['isg']);
    expect(logger.logged('reconcile_unreadable')).toBe(true);
  });

  it('keeps the readable subscription working while the other is broken', async () => {
    const { reconciler, source, sink } = rig();
    source.willFail('isg');
    source.willReturn('365', [session({ id: 'aaaaaaaa' }, '365')]);

    await reconciler.reconcile();

    expect(typesOf(sink)).toEqual(['seen']);
    expect(reconciler.sessions).toHaveLength(1);
  });

  it('stops calling it unreadable once a sweep succeeds', async () => {
    const { reconciler, source } = rig();
    source.willFail('365');
    await reconciler.reconcile();

    source.willReturn('365', []);
    await reconciler.reconcile();

    expect(reconciler.unreadable).toEqual([]);
  });
});

describe('Reconciler — the feeds', () => {
  it('sweeps immediately on start rather than waiting out the first interval', async () => {
    const { reconciler, source } = rig();

    reconciler.start();
    await settle();

    expect(source.sweepCount('365')).toBe(1);
    reconciler.stop();
  });

  it('sweeps again on every tick of the timer', async () => {
    const { reconciler, source, scheduler } = rig();
    reconciler.start();
    await settle();

    scheduler.tick();
    await settle();

    expect(source.sweepCount('365')).toBe(2);
    reconciler.stop();
  });

  it('coalesces a burst of nudges into one early sweep', async () => {
    const { reconciler, source, scheduler, watcher } = rig();
    reconciler.start();
    await settle();

    // What one real file write looks like through ReadDirectoryChangesW (RESEARCH.md E.5).
    watcher.burst();
    scheduler.advance(200);
    await settle();

    expect(source.sweepCount('365')).toBe(2);
    reconciler.stop();
  });

  it('does not sweep until the debounce has actually elapsed', async () => {
    const { reconciler, source, scheduler, watcher } = rig();
    reconciler.start();
    await settle();

    watcher.nudge();
    scheduler.advance(100);
    await settle();

    expect(source.sweepCount('365')).toBe(1);
    reconciler.stop();
  });

  it('starts once however many times it is started', () => {
    const { reconciler, scheduler } = rig();

    reconciler.start();
    reconciler.start();

    expect(scheduler.repeatingCount).toBe(1);
    reconciler.stop();
  });

  it('lets go of both feeds when stopped', async () => {
    const { reconciler, source, scheduler, watcher } = rig();
    reconciler.start();
    await settle();

    reconciler.stop();
    scheduler.tick();
    watcher.nudge();
    scheduler.advance(1000);
    await settle();

    expect(source.sweepCount('365')).toBe(1);
    expect(watcher.watching).toBe(false);
    expect(scheduler.repeatingCount).toBe(0);
  });

  it('stops cleanly when it was never started', () => {
    const { reconciler } = rig();

    expect(() => {
      reconciler.stop();
    }).not.toThrow();
  });
});

describe('Reconciler — one sweep at a time', () => {
  it('coalesces concurrent requests into the one in flight plus a single rerun', async () => {
    const { reconciler, source } = rig();

    await Promise.all([reconciler.reconcile(), reconciler.reconcile(), reconciler.reconcile()]);

    // Three asks, two sweeps: the one that was running, and one more for everything asked during
    // it. Two concurrent sweeps could interleave into a `gone` for a session the other just saw.
    expect(source.sweepCount('365')).toBe(2);
  });

  it('is ready to sweep again once the rerun has finished', async () => {
    const { reconciler, source } = rig();
    await Promise.all([reconciler.reconcile(), reconciler.reconcile()]);

    await reconciler.reconcile();

    expect(source.sweepCount('365')).toBe(3);
  });
});

describe('Reconciler — what it knows', () => {
  it('holds the newest row for each session across both subscriptions', async () => {
    const { reconciler, source } = rig();
    source.willReturn('365', [session({ id: 'aaaaaaaa', runState: 'working' }, '365')]);
    source.willReturn('isg', [session({ id: 'bbbbbbbb' }, 'isg')]);
    await reconciler.reconcile();

    source.willReturn('365', [session({ id: 'aaaaaaaa', runState: 'blocked' }, '365')]);
    await reconciler.reconcile();

    const rows = reconciler.sessions;
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.shortId === 'aaaaaaaa')?.runState).toBe('blocked');
  });

  it('knows an interactive session is not attachable, like the deck does', async () => {
    const { reconciler, source } = rig();
    source.willReturn('365', [session({ id: 'aaaaaaaa', kind: 'interactive' }, '365')]);

    await reconciler.reconcile();

    expect(reconciler.sessions[0]?.attachable).toBe(false);
  });
});

describe('Reconciler — the snapshot the stream replays (P1-T9)', () => {
  it('is empty before the first sweep, rather than a guess', () => {
    const { reconciler } = rig();

    expect(reconciler.snapshot().rows).toEqual([]);
    expect(reconciler.snapshot().unreadable).toEqual([]);
  });

  it('holds every session the sweeps found, in the deck’s order', async () => {
    const { reconciler, source } = rig();
    source.willReturn('365', [
      session({ id: 'aaaaaaaa', runState: 'working' }, '365'),
      session({ id: 'bbbbbbbb', runState: 'blocked' }, '365'),
    ]);
    await reconciler.reconcile();

    // Attention first — the same comparator the deck and DeckQuery use (contracts/session-row.ts).
    expect(reconciler.snapshot().rows.map((row) => row.shortId)).toEqual(['bbbbbbbb', 'aaaaaaaa']);
  });

  it('names the subscription it could not read, which no event ever does', async () => {
    const { reconciler, source } = rig();
    source.willFail('isg');
    await reconciler.reconcile();

    expect(reconciler.snapshot().unreadable).toEqual(['isg']);
  });

  it('drops a session that has gone, so a reconnecting deck does not resurrect it', async () => {
    const { reconciler, source } = rig();
    source.willReturn('365', [session({ id: 'aaaaaaaa' }, '365')]);
    await reconciler.reconcile();

    source.willReturn('365', []);
    await reconciler.reconcile();
    await reconciler.reconcile();

    expect(reconciler.snapshot().rows).toEqual([]);
  });

  it('costs no sweep, which is what makes a replay free', async () => {
    const { reconciler, source } = rig();
    source.willReturn('365', [session({ id: 'aaaaaaaa' }, '365')]);
    await reconciler.reconcile();
    const sweeps = source.swept.length;

    reconciler.snapshot();
    reconciler.snapshot();

    expect(source.swept).toHaveLength(sweeps);
  });
});
