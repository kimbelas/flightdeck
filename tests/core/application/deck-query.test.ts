// The read side of the deck — and the product fact that decides what the UI can offer.
//
// `attachable` is what these are really about. `claude attach` takes background sessions only
// (SPEC §5.2), so every interactive session is permanently read-only in a pane. A deck that got
// this wrong would render an "open pane" button that cannot work, on the majority of rows.
import { describe, expect, it } from 'vitest';
import {
  ENDED_ADOPTABLE,
  INTERACTIVE_NOT_ATTACHABLE,
  NOT_LIVE,
  type SessionRow,
} from '../../../contracts/session-row.ts';
import type { SubscriptionId } from '../../../contracts/session.ts';
import { DeckQuery } from '../../../core/application/deck-query.ts';
import { Session } from '../../../core/domain/session.ts';
import { SessionId } from '../../../core/domain/session-id.ts';
import type { Sweep } from '../../../core/ports/session-source.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeSessionSource } from '../../fakes/fake-session-source.ts';

interface Spec {
  readonly id: string;
  readonly kind: 'interactive' | 'background';
  readonly live: boolean;
  readonly runState?: 'working' | 'blocked' | 'done';
  readonly startedAt?: number;
}

function session(spec: Spec, subscription: SubscriptionId): Session {
  return Session.start(
    {
      id: SessionId.parse(`${spec.id}-0000-0000-0000-000000000000`),
      subscription,
      kind: spec.kind,
      name: spec.id,
      cwd: 'C:\\work',
      startedAt: new Date(spec.startedAt ?? 1000),
    },
    { runState: spec.runState, status: undefined, live: spec.live },
  );
}

function deckOf(sweeps: Map<SubscriptionId, Sweep>, ended: SessionRow[] = []): DeckQuery {
  const source = new FakeSessionSource();
  for (const sweep of sweeps.values()) source.willSweep(sweep);
  // The same instant the inline FixedClock used, so every ordering assertion below is unchanged.
  return new DeckQuery(source, new FakeClock(1_700_000_000_000), { ended });
}

/** An ended interactive row, as `Reconciler` holds one — P6-T7. */
function endedRow(over: Partial<SessionRow> = {}): SessionRow {
  return {
    sessionId: 'eeeeeeee-0000-0000-0000-000000000000',
    shortId: 'eeeeeeee',
    subscription: '365',
    kind: 'interactive',
    name: 'apex',
    cwd: 'C:\\work',
    startedAt: 900,
    live: false,
    runState: undefined,
    status: undefined,
    attachable: false,
    notAttachableBecause: ENDED_ADOPTABLE,
    ...over,
  };
}

function sweepOf(subscription: SubscriptionId, specs: Spec[], failed = false): Sweep {
  return {
    subscription,
    sessions: specs.map((spec) => session(spec, subscription)),
    failed,
    skipped: 0,
  };
}

describe('DeckQuery — attachability', () => {
  it('marks a live background session attachable', async () => {
    const sweeps = new Map<SubscriptionId, Sweep>([
      ['365', sweepOf('365', [{ id: 'aaaaaaaa', kind: 'background', live: true }])],
    ]);

    const { rows } = await deckOf(sweeps).snapshot();

    expect(rows[0]?.attachable).toBe(true);
    expect(rows[0]?.notAttachableBecause).toBeUndefined();
  });

  it('refuses an interactive session, however healthy, and says why', async () => {
    const sweeps = new Map<SubscriptionId, Sweep>([
      ['365', sweepOf('365', [{ id: 'bbbbbbbb', kind: 'interactive', live: true }])],
    ]);

    const { rows } = await deckOf(sweeps).snapshot();

    // The constraint is Claude Code's, not Flightdeck's — SPEC §5.2.
    expect(rows[0]?.attachable).toBe(false);
    expect(rows[0]?.notAttachableBecause).toBe(INTERACTIVE_NOT_ATTACHABLE);
  });

  it('refuses a background session that is not running', async () => {
    const sweeps = new Map<SubscriptionId, Sweep>([
      [
        '365',
        sweepOf('365', [{ id: 'cccccccc', kind: 'background', live: false, runState: 'done' }]),
      ],
    ]);

    const { rows } = await deckOf(sweeps).snapshot();

    expect(rows[0]?.attachable).toBe(false);
    expect(rows[0]?.notAttachableBecause).toBe(NOT_LIVE);
  });
});

describe('DeckQuery — both subscriptions', () => {
  it('merges sessions from both', async () => {
    const sweeps = new Map<SubscriptionId, Sweep>([
      ['365', sweepOf('365', [{ id: 'aaaaaaaa', kind: 'background', live: true }])],
      ['isg', sweepOf('isg', [{ id: 'bbbbbbbb', kind: 'background', live: true }])],
    ]);

    const { rows } = await deckOf(sweeps).snapshot();

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.subscription).sort()).toEqual(['365', 'isg']);
  });

  it('names an unreadable subscription rather than showing it as empty', async () => {
    const sweeps = new Map<SubscriptionId, Sweep>([
      ['365', sweepOf('365', [{ id: 'aaaaaaaa', kind: 'background', live: true }])],
      ['isg', sweepOf('isg', [], true)],
    ]);

    const { rows, unreadable } = await deckOf(sweeps).snapshot();

    expect(unreadable).toEqual(['isg']);
    // The other subscription's sessions still arrive — one failure must not hide the other.
    expect(rows).toHaveLength(1);
  });

  it('keeps serving the readable side when both fail differently', async () => {
    const sweeps = new Map<SubscriptionId, Sweep>([
      ['365', sweepOf('365', [], true)],
      ['isg', sweepOf('isg', [], true)],
    ]);

    const { rows, unreadable } = await deckOf(sweeps).snapshot();

    expect(rows).toHaveLength(0);
    expect([...unreadable].sort()).toEqual(['365', 'isg']);
  });
});

describe('DeckQuery — ordering', () => {
  it('puts a blocked session above everything else', async () => {
    const sweeps = new Map<SubscriptionId, Sweep>([
      [
        '365',
        sweepOf('365', [
          { id: 'aaaaaaaa', kind: 'background', live: true, runState: 'working', startedAt: 9000 },
          { id: 'bbbbbbbb', kind: 'background', live: true, runState: 'blocked', startedAt: 1000 },
        ]),
      ],
    ]);

    const { rows } = await deckOf(sweeps).snapshot();

    // Blocked is the one signal the listing carries that means "needs you" (D29).
    expect(rows[0]?.name).toBe('bbbbbbbb');
  });

  it('puts live sessions above dead ones, then newest first', async () => {
    const sweeps = new Map<SubscriptionId, Sweep>([
      [
        '365',
        sweepOf('365', [
          { id: 'aaaaaaaa', kind: 'background', live: false, startedAt: 9000 },
          { id: 'bbbbbbbb', kind: 'background', live: true, startedAt: 1000 },
          { id: 'cccccccc', kind: 'background', live: true, startedAt: 5000 },
        ]),
      ],
    ]);

    const { rows } = await deckOf(sweeps).snapshot();

    expect(rows.map((row) => row.name)).toEqual(['cccccccc', 'bbbbbbbb', 'aaaaaaaa']);
  });
});

/**
 * The sessions a sweep cannot see — P6-T7, SPEC §4.3.
 *
 * `claude agents --json --all` forgets an interactive session the moment its terminal closes
 * (G.55), which is why the reconciler holds it. `GET /sessions` takes a fresh sweep, so without
 * the merge a refresh would clear the adopt offer and the next stream frame would put it back —
 * a deck disagreeing with itself about a row somebody is looking at.
 */
describe('DeckQuery — ended interactive sessions', () => {
  it('includes one the listing has forgotten', async () => {
    const deck = deckOf(new Map([['365', sweepOf('365', [])]]), [endedRow()]);

    const snapshot = await deck.snapshot();

    expect(snapshot.rows.map((row) => row.shortId)).toEqual(['eeeeeeee']);
    expect(snapshot.rows[0]?.notAttachableBecause).toBe(ENDED_ADOPTABLE);
  });

  // The sweep is the newer answer. Somebody adopted it, it is a background job now, and a
  // remembered row beside it would be the same session twice in two states.
  it('leaves out one the sweep carries, rather than listing it twice', async () => {
    const adopted = { id: 'eeeeeeee', kind: 'background', live: true } as const;
    const deck = deckOf(new Map([['365', sweepOf('365', [adopted])]]), [endedRow()]);

    const snapshot = await deck.snapshot();

    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0]).toMatchObject({ kind: 'background', attachable: true });
  });

  // A session id is only unique within a config directory, so the same uuid under the other
  // account is a different session and must not be matched against this one.
  it('matches on BOTH ids, not on the uuid alone', async () => {
    const other = { id: 'eeeeeeee', kind: 'background', live: true } as const;
    const deck = deckOf(new Map([['isg', sweepOf('isg', [other])]]), [endedRow()]);

    const snapshot = await deck.snapshot();

    expect(snapshot.rows).toHaveLength(2);
  });

  /**
   * A failed sweep had no gone-detection run against it either (`Reconciler`).
   *
   * Adding its remembered rows here would be this class forming an opinion the reconciler
   * declined to form — and the deck already says "could not look" for that subscription, which
   * is a different answer from a session having ended.
   */
  it('says nothing about a subscription whose sweep failed', async () => {
    const deck = deckOf(new Map([['365', sweepOf('365', [], true)]]), [endedRow()]);

    const snapshot = await deck.snapshot();

    expect(snapshot.rows).toEqual([]);
    expect(snapshot.unreadable).toEqual(['365']);
  });

  it('holds none of them by default, so the listing is still the listing', async () => {
    const deck = deckOf(new Map([['365', sweepOf('365', [])]]));

    expect((await deck.snapshot()).rows).toEqual([]);
  });
});
