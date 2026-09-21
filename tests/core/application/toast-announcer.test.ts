// Which things are worth interrupting the owner for — P6-T3, D16.
//
// The rules under test are all EDGES, so every case here is two events and an assertion about the
// second. The three that matter most are the ones that say NOTHING: a boot that re-observes a
// blocked session, a sweep that re-observes it again ten seconds later, and a session that was
// muted. Each is a toast the owner would have called a bug.
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

const SESSION_ID = '337975f9-1a2b-4c3d-8e4f-5a6b7c8d9e0f';

function rowOf(over: Partial<SessionRow> = {}): SessionRow {
  return {
    sessionId: SESSION_ID,
    shortId: '337975f9',
    subscription: '365',
    kind: 'background',
    name: 'alpha',
    cwd: 'C:\\repo',
    startedAt: 1,
    live: true,
    runState: 'working',
    status: 'busy',
    attachable: true,
    notAttachableBecause: undefined,
    ...over,
  };
}

function eventOf(type: string, row: SessionRow): DraftEvent {
  return {
    at: 1,
    sessionId: row.sessionId,
    subscription: row.subscription,
    source: 'reconcile',
    type,
    payload: row,
  };
}

interface Built {
  readonly hub: EventHub;
  readonly notifier: FakeNotifier;
  readonly mutes: MuteBook;
  readonly announcer: ToastAnnouncer;
  readonly logger: FakeLogger;
}

function build(): Built {
  const logger = new FakeLogger();
  const hub = new EventHub(logger);
  const notifier = new FakeNotifier();
  const mutes = new MuteBook({ store: new FakeStore(), clock: new FakeClock(), logger });
  const announcer = new ToastAnnouncer({ feed: hub, notifier, mutes, logger });
  announcer.start();
  return { hub, notifier, mutes, announcer, logger };
}

describe('ToastAnnouncer — the three kinds', () => {
  it('toasts when a session starts waiting on the owner', () => {
    const { hub, notifier } = build();

    hub.publish(eventOf('seen', rowOf()));
    hub.publish(eventOf('changed', rowOf({ runState: 'blocked' })));

    expect(notifier.last?.title).toBe('Claude needs you');
    expect(notifier.last?.body).toBe('alpha');
    expect(notifier.last?.sessionId).toBe(SESSION_ID);
  });

  it('toasts when a session finishes', () => {
    const { hub, notifier } = build();

    hub.publish(eventOf('seen', rowOf()));
    hub.publish(eventOf('changed', rowOf({ live: false, runState: 'done' })));

    expect(notifier.last?.title).toBe('Session finished');
  });

  it('toasts when a session fails, and calls it failed rather than finished', () => {
    const { hub, notifier } = build();

    hub.publish(eventOf('seen', rowOf()));
    hub.publish(eventOf('changed', rowOf({ live: false, runState: 'failed' })));

    expect(notifier.last?.title).toBe('Session failed');
  });

  it('falls back to the short id for a session nobody named', () => {
    const { hub, notifier } = build();

    hub.publish(eventOf('seen', rowOf({ name: undefined })));
    hub.publish(eventOf('changed', rowOf({ name: undefined, runState: 'blocked' })));

    expect(notifier.last?.body).toBe('337975f9');
  });

  // A session name is the owner's own text and reaches an argv. `execFile` makes it an argument
  // rather than shell input, and it is still stripped — `titleOf` in the terminal adapter's reason.
  it('strips control characters out of a name before it reaches a process argument', () => {
    const { hub, notifier } = build();
    const named = { name: 'al\u0000pha\nbeta' };

    hub.publish(eventOf('seen', rowOf(named)));
    hub.publish(eventOf('changed', rowOf({ ...named, runState: 'blocked' })));

    expect(notifier.last?.body).toBe('al pha beta');
  });

  // `needsAttention` is `live && blocked`, exported from contracts so the toast and the deck's
  // sort order are one sentence. A session that ENDED while blocked is not waiting on anybody —
  // G.24 put a five-day-dead session at the top of a real deck for want of this.
  it('does not call a session that ended while blocked a session that needs you', () => {
    const { hub, notifier } = build();

    hub.publish(eventOf('seen', rowOf({ runState: 'working' })));
    hub.publish(eventOf('changed', rowOf({ live: false, runState: 'blocked' })));

    expect(notifier.raised).toEqual([]);
  });

  // Interactive records carry no `state` at all (contracts/session.ts), so no rule can match.
  it('says nothing about an interactive session, which has no run state to move', () => {
    const { hub, notifier } = build();
    const interactive = rowOf({ kind: 'interactive', runState: undefined });

    hub.publish(eventOf('seen', interactive));
    hub.publish(eventOf('changed', { ...interactive, live: false }));

    expect(notifier.raised).toEqual([]);
  });
});

describe('ToastAnnouncer — the edges', () => {
  // The trap this rule exists for: on boot the reconciler publishes `seen` for EVERY session it
  // finds, so a core restarted beside three blocked sessions would open with three toasts.
  it('says nothing the first time it sees a session, however blocked it already is', () => {
    const { hub, notifier } = build();

    hub.publish(eventOf('seen', rowOf({ runState: 'blocked' })));

    expect(notifier.raised).toEqual([]);
  });

  // Two guards stand here and only one of them is reachable through the reconciler, which is why
  // this case is written out: `seen` is published when the reconciler has never held the session,
  // so "unknown to me" and "type is seen" agree today. They would stop agreeing the moment a
  // second producer published a `seen` for a session already on the deck, and the header's rule is
  // that only `changed` raises anything. A sabotage that dropped the type check survived the rest
  // of this file.
  it('never raises anything on a `seen`, even for a session it already knows', () => {
    const { hub, notifier } = build();

    hub.publish(eventOf('seen', rowOf()));
    hub.publish(eventOf('seen', rowOf({ runState: 'blocked' })));

    expect(notifier.raised).toEqual([]);
  });

  it('does not toast again while the session stays blocked, sweep after sweep', () => {
    const { hub, notifier } = build();

    hub.publish(eventOf('seen', rowOf()));
    hub.publish(eventOf('changed', rowOf({ runState: 'blocked' })));
    hub.publish(eventOf('changed', rowOf({ runState: 'blocked', status: 'waiting' })));
    hub.publish(eventOf('changed', rowOf({ runState: 'blocked', status: 'idle' })));

    expect(notifier.raised.length).toBe(1);
  });

  it('toasts again once the condition has left and come back', () => {
    const { hub, notifier } = build();

    hub.publish(eventOf('seen', rowOf()));
    hub.publish(eventOf('changed', rowOf({ runState: 'blocked' })));
    hub.publish(eventOf('changed', rowOf({ runState: 'working' })));
    hub.publish(eventOf('changed', rowOf({ runState: 'blocked' })));

    expect(notifier.raised.length).toBe(2);
  });

  // `gone` means the record left `agents --json --all` entirely — deleted, not finished (F.2.2).
  it('does not read a record being deleted as a session finishing', () => {
    const { hub, notifier } = build();

    hub.publish(eventOf('seen', rowOf()));
    hub.publish(eventOf('gone', rowOf({ live: false, runState: 'done' })));

    expect(notifier.raised).toEqual([]);
  });

  it('forgets a session it is told is gone, so a reused id starts from silence', () => {
    const { hub, notifier } = build();

    hub.publish(eventOf('seen', rowOf()));
    hub.publish(eventOf('gone', rowOf()));
    hub.publish(eventOf('changed', rowOf({ runState: 'blocked' })));

    expect(notifier.raised).toEqual([]);
  });
});

describe('ToastAnnouncer — what it refuses to react to', () => {
  it('ignores an event from any other producer, however much it looks like a row', () => {
    const { hub, notifier } = build();

    hub.publish({ ...eventOf('seen', rowOf()), source: 'hook' });
    hub.publish({ ...eventOf('changed', rowOf({ runState: 'blocked' })), source: 'hook' });

    expect(notifier.raised).toEqual([]);
  });

  it('ignores a payload that is not a row, rather than guessing at one', () => {
    const { hub, notifier } = build();

    hub.publish({ ...eventOf('changed', rowOf()), payload: { sessionId: SESSION_ID } });

    expect(notifier.raised).toEqual([]);
  });

  it('stays silent about a muted session, and speaks again once it is unmuted', () => {
    const { hub, notifier, mutes } = build();
    mutes.set({ sessionId: SESSION_ID, subscription: '365' }, true);

    hub.publish(eventOf('seen', rowOf()));
    hub.publish(eventOf('changed', rowOf({ runState: 'blocked' })));
    expect(notifier.raised).toEqual([]);

    mutes.set({ sessionId: SESSION_ID, subscription: '365' }, false);
    hub.publish(eventOf('changed', rowOf({ runState: 'working' })));
    hub.publish(eventOf('changed', rowOf({ runState: 'blocked' })));

    expect(notifier.raised.length).toBe(1);
  });

  // A mute is keyed on `sessionKey`, because a session id is unique only within a config dir.
  it('does not let a mute on one subscription silence the same uuid on the other', () => {
    const { hub, notifier, mutes } = build();
    mutes.set({ sessionId: SESSION_ID, subscription: 'isg' }, true);

    hub.publish(eventOf('seen', rowOf()));
    hub.publish(eventOf('changed', rowOf({ runState: 'blocked' })));

    expect(notifier.raised.length).toBe(1);
  });

  it('stops listening when it is stopped, so shutdown does not leave a subscriber', () => {
    const { hub, notifier, announcer } = build();
    hub.publish(eventOf('seen', rowOf()));

    announcer.stop();
    hub.publish(eventOf('changed', rowOf({ runState: 'blocked' })));

    expect(hub.subscriberCount).toBe(0);
    expect(notifier.raised).toEqual([]);
  });

  it('starts once however often it is started — two listeners would be two toasts', () => {
    const { hub, notifier, announcer } = build();
    announcer.start();

    hub.publish(eventOf('seen', rowOf()));
    hub.publish(eventOf('changed', rowOf({ runState: 'blocked' })));

    expect(hub.subscriberCount).toBe(1);
    expect(notifier.raised.length).toBe(1);
  });

  // The port says a toast is a courtesy. A notifier that threw must not take the event away from
  // the store and the browser, which are the other listeners on the same hub.
  it('lets the event reach everyone else even when the toast could not be raised', () => {
    const { hub, notifier, logger } = build();
    const seenByOthers: DraftEvent[] = [];
    hub.subscribe((event) => seenByOthers.push(event));
    notifier.failNext = true;

    hub.publish(eventOf('seen', rowOf()));
    hub.publish(eventOf('changed', rowOf({ runState: 'blocked' })));

    expect(notifier.raised).toEqual([]);
    expect(seenByOthers.length).toBe(2);
    // It still decided to, which is the half an operator asking "why nothing" needs to see.
    expect(logger.logged('toast_raised')).toBe(true);
  });

  /**
   * The line is what survives the toast — six seconds on screen and then the Action Center.
   *
   * The session NAME is deliberately not in it. A name is the owner's own text and can be a prompt
   * fragment; this file ends up in a bug report and in a fixture capture (SEC-DATA-2).
   */
  it('leaves a line saying which edge fired, and no model or owner text in it', () => {
    const { hub, logger } = build();

    hub.publish(eventOf('seen', rowOf()));
    hub.publish(eventOf('changed', rowOf({ runState: 'blocked' })));

    expect(logger.last).toEqual({
      level: 'info',
      event: 'toast_raised',
      details: { kind: 'needs-you', subscription: '365' },
    });
  });

  it('says nothing in the log about a session it was told to be quiet about', () => {
    const { hub, logger, mutes } = build();
    mutes.set({ sessionId: SESSION_ID, subscription: '365' }, true);

    hub.publish(eventOf('seen', rowOf()));
    hub.publish(eventOf('changed', rowOf({ runState: 'blocked' })));

    expect(logger.logged('toast_raised')).toBe(false);
  });
});
