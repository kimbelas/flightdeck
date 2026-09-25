// `sameRow` is what decides whether a `changed` event is published, so what it ignores matters
// as much as what it compares. Too eager and the deck redraws on every sweep; too blunt and a
// session that started needing you looks unchanged.
import { describe, expect, it } from 'vitest';
import type { SubscriptionId } from '../../../contracts/session.ts';
import { sameRow, toSessionRow, withEnding } from '../../../core/application/session-rows.ts';
import { Session } from '../../../core/domain/session.ts';
import { SessionId } from '../../../core/domain/session-id.ts';

interface Spec {
  readonly kind?: 'interactive' | 'background';
  readonly live?: boolean;
  readonly runState?: 'working' | 'blocked' | 'done';
  readonly name?: string;
  readonly cwd?: string;
  readonly startedAt?: number;
}

function rowOf(spec: Spec, subscription: SubscriptionId = '365'): ReturnType<typeof toSessionRow> {
  return toSessionRow(
    Session.start(
      {
        id: SessionId.parse('aaaaaaaa-0000-0000-0000-000000000000'),
        subscription,
        kind: spec.kind ?? 'background',
        name: spec.name ?? 'nightly',
        cwd: spec.cwd ?? 'C:\\work',
        startedAt: new Date(spec.startedAt ?? 1000),
      },
      { runState: spec.runState, status: undefined, live: spec.live ?? true },
    ),
  );
}

describe('toSessionRow', () => {
  it('carries the short id as the uuid first segment', () => {
    expect(rowOf({}).shortId).toBe('aaaaaaaa');
  });

  it('offers a pane on a live background session', () => {
    const row = rowOf({});

    expect(row.attachable).toBe(true);
    expect(row.notAttachableBecause).toBeUndefined();
  });

  it('refuses one on an interactive session and says why', () => {
    const row = rowOf({ kind: 'interactive' });

    expect(row.attachable).toBe(false);
    expect(row.notAttachableBecause).toContain('Only background sessions');
  });

  it('refuses one on a background session that is not running', () => {
    expect(rowOf({ live: false }).attachable).toBe(false);
  });
});

describe('sameRow', () => {
  it('is true for two observations of an unchanged session', () => {
    expect(sameRow(rowOf({}), rowOf({}))).toBe(true);
  });

  it('notices the run state moving, which is the attention signal', () => {
    expect(sameRow(rowOf({ runState: 'working' }), rowOf({ runState: 'blocked' }))).toBe(false);
  });

  it('notices a session going not-live', () => {
    expect(sameRow(rowOf({ live: true }), rowOf({ live: false }))).toBe(false);
  });

  it('notices a rename', () => {
    expect(sameRow(rowOf({ name: 'a' }), rowOf({ name: 'b' }))).toBe(false);
  });

  it('notices the cwd moving, which is a different project on the same session', () => {
    expect(sameRow(rowOf({ cwd: 'C:\\one' }), rowOf({ cwd: 'C:\\two' }))).toBe(false);
  });

  it('ignores startedAt, which cannot change and is not worth an event', () => {
    expect(sameRow(rowOf({ startedAt: 1000 }), rowOf({ startedAt: 1000 }))).toBe(true);
  });

  // D62: a reason read a sweep late is news — it is what turns "done" into "retired" on the deck.
  it('notices the ending being learned, and the retirement word changing', () => {
    const stopped = rowOf({ live: false, runState: 'done' });

    expect(sameRow(stopped, { ...stopped, endReason: 'retired' })).toBe(false);
    expect(
      sameRow(
        { ...stopped, endReason: 'retired', retireReason: 'settled' },
        { ...stopped, endReason: 'retired', retireReason: 'idle-prompt' },
      ),
    ).toBe(false);
  });
});

describe('withEnding', () => {
  const stopped = rowOf({ live: false, runState: 'blocked' });

  it('names a retirement with the daemon’s word for it', () => {
    const row = withEnding(stopped, {
      shortId: 'aaaaaaaa',
      at: 1,
      reason: 'retired',
      retireReason: 'idle-prompt',
      idleMinutes: 60,
      lowMemory: false,
    });

    expect(row).toEqual({ ...stopped, endReason: 'retired', retireReason: 'idle-prompt' });
  });

  it('carries no retirement word beside a stop or a finish', () => {
    const row = withEnding(
      { ...stopped, retireReason: 'settled' },
      { shortId: 'aaaaaaaa', at: 1, reason: 'stopped' },
    );

    expect(row).toMatchObject({ endReason: 'stopped', retireReason: undefined });
  });

  it('starts every row it builds from the listing as unknown', () => {
    expect(stopped).toMatchObject({ endReason: 'unknown', retireReason: undefined });
  });
});
