// An interactive session that vanishes has ENDED — P6-T7, SPEC §4.3, RESEARCH.md G.55.
//
// The reconciler's own file settles the three traps it must not fall into; this settles the
// asymmetry P6-T7 added on top of them, which is measured rather than assumed. `--all` keeps a
// background job listed forever with `state: done` and no `pid`, so it can only leave the listing
// by being `rm`-ed; an interactive session is dropped the instant its terminal closes.
//
// So: the same disappearance means two different things, and reading either one as the other is a
// way to lie to the owner. A background session announced as "ended, adopt it?" would be offering
// to resurrect a conversation that was deliberately deleted. An interactive session announced
// `gone` is SPEC §4.3's migration path silently not happening.
import { describe, expect, it } from 'vitest';
import { rig, session, typesOf } from './reconciler-harness.ts';

const THIRTY_MINUTES = 30 * 60_000;

/** Two sweeps with the session absent — `gone` and `ended` both take two (trap 2). */
async function vanish(reconciler: { reconcile: () => Promise<void> }): Promise<void> {
  await reconciler.reconcile();
  await reconciler.reconcile();
}

describe('Reconciler — an interactive session that exits', () => {
  it('is kept as an ENDED row rather than announced gone', async () => {
    const { reconciler, source, sink } = rig();
    source.willReturn('365', [session({ id: 'aaaaaaaa', kind: 'interactive' }, '365')]);
    await reconciler.reconcile();

    source.willReturn('365', []);
    await vanish(reconciler);

    expect(typesOf(sink)).toEqual(['seen', 'changed']);
    expect(reconciler.sessions).toHaveLength(1);
  });

  // Three claims the last reading made that stop being true the moment the terminal closes. The
  // reason is the one that would otherwise be actively misleading: "already bound to its own
  // terminal" describes a window that is not there any more.
  it('stops claiming the session is live, busy, or bound to a terminal', async () => {
    const { reconciler, source, sink } = rig();
    source.willReturn('365', [
      session({ id: 'aaaaaaaa', kind: 'interactive', runState: 'working' }, '365'),
    ]);
    await reconciler.reconcile();

    source.willReturn('365', []);
    await vanish(reconciler);

    expect(sink.last?.payload).toMatchObject({
      live: false,
      runState: undefined,
      status: undefined,
      attachable: false,
    });
    expect(sink.last?.payload).toHaveProperty(
      'notAttachableBecause',
      expect.stringContaining('Adopt'),
    );
  });

  it('keeps the folder it was running in, which is where an adoption has to start', async () => {
    const { reconciler, source } = rig();
    const spec = { id: 'aaaaaaaa', kind: 'interactive', cwd: 'C:\\repo\\ticket-41' } as const;
    source.willReturn('365', [session(spec, '365')]);
    await reconciler.reconcile();

    source.willReturn('365', []);
    await vanish(reconciler);

    expect(reconciler.rowFor('365', 'aaaaaaaa-0000-0000-0000-000000000000')?.cwd).toBe(
      'C:\\repo\\ticket-41',
    );
  });

  // Trap 2 still applies. One missing sweep concludes nothing, here as anywhere else.
  it('says nothing the first time it is missing', async () => {
    const { reconciler, source, sink } = rig();
    source.willReturn('365', [session({ id: 'aaaaaaaa', kind: 'interactive' }, '365')]);
    await reconciler.reconcile();

    source.willReturn('365', []);
    await reconciler.reconcile();

    expect(typesOf(sink)).toEqual(['seen']);
  });

  // It is absent on every sweep after the first, by definition. A row that re-announced its own
  // ending every ten seconds would be a `changed` event a minute for a session doing nothing.
  it('says it once, not on every sweep afterwards', async () => {
    const { reconciler, source, sink } = rig();
    source.willReturn('365', [session({ id: 'aaaaaaaa', kind: 'interactive' }, '365')]);
    await reconciler.reconcile();

    source.willReturn('365', []);
    await vanish(reconciler);
    await reconciler.reconcile();
    await reconciler.reconcile();

    expect(typesOf(sink)).toEqual(['seen', 'changed']);
  });
});

describe('Reconciler — the other half of the asymmetry', () => {
  // A background job leaves the listing only by being `rm`-ed, and offering to adopt one would be
  // offering to resurrect a conversation somebody deliberately deleted.
  it('announces a background session gone, as it always has', async () => {
    const { reconciler, source, sink } = rig();
    source.willReturn('365', [session({ id: 'aaaaaaaa' }, '365')]);
    await reconciler.reconcile();

    source.willReturn('365', []);
    await vanish(reconciler);

    expect(typesOf(sink)).toEqual(['seen', 'gone']);
    expect(reconciler.sessions).toHaveLength(0);
  });
});

describe('Reconciler — how long the offer lasts', () => {
  it('drops the row once the window has passed', async () => {
    const { reconciler, source, sink, clock } = rig();
    source.willReturn('365', [session({ id: 'aaaaaaaa', kind: 'interactive' }, '365')]);
    await reconciler.reconcile();
    source.willReturn('365', []);
    await vanish(reconciler);

    clock.advance(THIRTY_MINUTES);
    await reconciler.reconcile();

    expect(typesOf(sink)).toEqual(['seen', 'changed', 'gone']);
    expect(reconciler.sessions).toHaveLength(0);
  });

  it('keeps offering it until then', async () => {
    const { reconciler, source, sink, clock } = rig();
    source.willReturn('365', [session({ id: 'aaaaaaaa', kind: 'interactive' }, '365')]);
    await reconciler.reconcile();
    source.willReturn('365', []);
    await vanish(reconciler);

    clock.advance(THIRTY_MINUTES - 1000);
    await reconciler.reconcile();

    expect(typesOf(sink)).toEqual(['seen', 'changed']);
    expect(reconciler.ended).toHaveLength(1);
  });

  // `VitalsRegistry`'s reason: a map that only ever grows is the kind of thing nobody notices
  // until it matters, and a window bounds the ordinary day but not a script opening terminals.
  it('holds a bounded number of them', async () => {
    const { reconciler, source } = rig();
    const many = Array.from({ length: 30 }, (unused, index) =>
      session({ id: `aaaaaa${String(index).padStart(2, '0')}`, kind: 'interactive' }, '365'),
    );
    source.willReturn('365', many);
    await reconciler.reconcile();

    source.willReturn('365', []);
    await vanish(reconciler);

    expect(reconciler.ended.length).toBeLessThanOrEqual(20);
  });
});

describe('Reconciler — when the offer is taken', () => {
  // An adopted session comes back under its OWN id as a background job (G.55). The offer is the
  // one thing on the row that must not survive the thing it was offering.
  it('stops offering a session that has come back as a background job', async () => {
    const { reconciler, source, sink } = rig();
    source.willReturn('365', [session({ id: 'aaaaaaaa', kind: 'interactive' }, '365')]);
    await reconciler.reconcile();
    source.willReturn('365', []);
    await vanish(reconciler);

    source.willReturn('365', [session({ id: 'aaaaaaaa', kind: 'background' }, '365')]);
    await reconciler.reconcile();

    expect(reconciler.ended).toEqual([]);
    expect(sink.last?.payload).toMatchObject({ kind: 'background', live: true, attachable: true });
  });

  // The clock restarts with it. A session adopted at 29 minutes and closed again a minute later
  // must get its own full window, not the minute left over from the last one.
  it('gives a session that ends a second time a fresh window', async () => {
    const { reconciler, source, sink, clock } = rig();
    source.willReturn('365', [session({ id: 'aaaaaaaa', kind: 'interactive' }, '365')]);
    await reconciler.reconcile();
    source.willReturn('365', []);
    await vanish(reconciler);

    clock.advance(THIRTY_MINUTES - 1000);
    source.willReturn('365', [session({ id: 'aaaaaaaa', kind: 'interactive' }, '365')]);
    await reconciler.reconcile();
    source.willReturn('365', []);
    await vanish(reconciler);
    clock.advance(2000);
    await reconciler.reconcile();

    expect(typesOf(sink).filter((type) => type === 'gone')).toEqual([]);
    expect(reconciler.ended).toHaveLength(1);
  });
});

describe('Reconciler — rowFor', () => {
  it('answers about a session it has seen', async () => {
    const { reconciler, source } = rig();
    source.willReturn('365', [session({ id: 'aaaaaaaa' }, '365')]);
    await reconciler.reconcile();

    const row = reconciler.rowFor('365', 'aaaaaaaa-0000-0000-0000-000000000000');

    expect(row?.shortId).toBe('aaaaaaaa');
  });

  // A session id is only unique within a config directory (`sessionKey`), so answering about the
  // other account's session of that id would hand an adoption the wrong folder and the wrong CLI.
  it('refuses to answer about the other subscription', async () => {
    const { reconciler, source } = rig();
    source.willReturn('365', [session({ id: 'aaaaaaaa' }, '365')]);
    await reconciler.reconcile();

    expect(reconciler.rowFor('isg', 'aaaaaaaa-0000-0000-0000-000000000000')).toBeUndefined();
  });

  it('answers nothing about a session it has never seen', () => {
    const { reconciler } = rig();

    expect(reconciler.rowFor('365', 'aaaaaaaa-0000-0000-0000-000000000000')).toBeUndefined();
  });
});
