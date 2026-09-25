// The toast in the log's words — D62, closing the gap D58 said out loud.
//
// `daemon.log`'s ending reaches the toast on the row (`endReason`, `retireReason`). What is pinned
// here is that an idle retirement no longer says "finished", and that the one retirement which is
// NOT a completion — `idle-prompt`, taken while the session was blocked on the owner (F.2.15) —
// raises its own needs-you toast even though the session was already "needs you" while it waited.
import { describe, expect, it } from 'vitest';
import type { DraftEvent } from '../../../contracts/fd-event.ts';
import type { SessionRow } from '../../../contracts/session-row.ts';
import { EventHub } from '../../../core/application/event-hub.ts';
import { MuteBook } from '../../../core/application/mute-book.ts';
import { ToastAnnouncer } from '../../../core/application/toast-announcer.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeNotifier } from '../../fakes/fake-notifier.ts';
import { FakeStore } from '../../fakes/fake-store.ts';

function rowOf(over: Partial<SessionRow> = {}): SessionRow {
  return {
    sessionId: '57218c6e-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
    shortId: '57218c6e',
    subscription: 'isg',
    kind: 'background',
    name: 'spike-c',
    cwd: 'C:\\repo',
    startedAt: 1,
    live: true,
    runState: 'working',
    status: 'busy',
    attachable: true,
    notAttachableBecause: undefined,
    endReason: 'unknown',
    retireReason: undefined,
    ...over,
  };
}

function changed(row: SessionRow, type = 'changed'): DraftEvent {
  return {
    at: 1,
    sessionId: row.sessionId,
    subscription: row.subscription,
    source: 'reconcile',
    type,
    payload: row,
  };
}

function build(): { hub: EventHub; notifier: FakeNotifier; logger: FakeLogger } {
  const logger = new FakeLogger();
  const hub = new EventHub(logger);
  const notifier = new FakeNotifier();
  const mutes = new MuteBook({ store: new FakeStore(), clock: new FakeClock(), logger });
  new ToastAnnouncer({ feed: hub, notifier, mutes, logger }).start();
  return { hub, notifier, logger };
}

/** How F.2.15 saw `fd-spike-c` straight after its retirement: `blocked` kept, `pid` gone. */
const RETIRED_WAITING = rowOf({
  live: false,
  runState: 'blocked',
  attachable: false,
  endReason: 'retired',
  retireReason: 'idle-prompt',
});

describe('ToastAnnouncer — a retirement while waiting for you', () => {
  it('is a needs-you toast in its own words, never "finished"', () => {
    const { hub, notifier, logger } = build();

    hub.publish(changed(rowOf(), 'seen'));
    hub.publish(changed(RETIRED_WAITING));

    expect(notifier.last?.title).toBe('Retired while waiting for you');
    expect(logger.last?.details).toEqual({ kind: 'needs-you', subscription: 'isg' });
  });

  // The edge the finer condition exists for: compared on the kind alone, "needs you" followed by
  // "needs you" is no edge, and the toast saying the wait is over would be swallowed.
  it('fires after the needs-you toast of the wait it ends', () => {
    const { hub, notifier } = build();

    hub.publish(changed(rowOf(), 'seen'));
    hub.publish(changed(rowOf({ runState: 'blocked' })));
    hub.publish(changed(RETIRED_WAITING));

    expect(notifier.raised.map((toast) => toast.title)).toEqual([
      'Claude needs you',
      'Retired while waiting for you',
    ]);
  });

  // A sweep that landed before the log was read says nothing (a stopped `blocked` is not an edge);
  // the sweep that reads the reason is the one that speaks, once.
  it('speaks when the reason arrives a sweep late, and only once', () => {
    const { hub, notifier } = build();
    const unexplained = rowOf({ live: false, runState: 'blocked', attachable: false });

    hub.publish(changed(rowOf({ runState: 'blocked' }), 'seen'));
    hub.publish(changed(unexplained));
    hub.publish(changed(RETIRED_WAITING));
    hub.publish(changed(RETIRED_WAITING));

    expect(notifier.raised.map((toast) => toast.title)).toEqual(['Retired while waiting for you']);
  });
});

describe('ToastAnnouncer — the other endings say which they were', () => {
  it.each([
    [{ endReason: 'stopped' }, 'Session stopped'],
    [{ endReason: 'retired', retireReason: 'settled' }, 'Session retired after finishing'],
    [{ endReason: 'retired', retireReason: 'empty-idle' }, 'Session retired before its first turn'],
    [{ endReason: 'retired' }, 'Session retired'],
  ] satisfies [Partial<SessionRow>, string][])('%o is "%s"', (ending, title) => {
    const { hub, notifier } = build();

    hub.publish(changed(rowOf({ runState: 'done' }), 'seen'));
    hub.publish(changed(rowOf({ live: false, runState: 'done', ...ending })));

    expect(notifier.last?.title).toBe(title);
  });

  // The daemon leaves a retired session's `state` as it was (F.2.15), so a settled retirement of
  // a session listed `blocked` is a completion by its ending, not by its run state.
  it('counts a known ending as a completion even when the listing still says blocked', () => {
    const { hub, notifier } = build();

    hub.publish(changed(rowOf(), 'seen'));
    hub.publish(
      changed(
        rowOf({ live: false, runState: 'blocked', endReason: 'retired', retireReason: 'settled' }),
      ),
    );

    expect(notifier.last?.title).toBe('Session retired after finishing');
  });

  // The ending is read a sweep late at worst, and a completion that learns its word afterwards is
  // the same completion: one toast, not two.
  it('does not toast twice when a completion learns which ending it was', () => {
    const { hub, notifier } = build();

    hub.publish(changed(rowOf(), 'seen'));
    hub.publish(changed(rowOf({ live: false, runState: 'done' })));
    hub.publish(changed(rowOf({ live: false, runState: 'done', endReason: 'stopped' })));

    expect(notifier.raised.map((toast) => toast.title)).toEqual(['Session ended']);
  });
});
