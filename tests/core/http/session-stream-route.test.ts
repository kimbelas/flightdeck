// P1-T9. Two questions: does a subscriber learn the whole truth on connect, and does anything
// reach a browser that core did not derive itself?
//
// The second one is a security test wearing ordinary clothes. `DraftEvent.payload` is `unknown`
// because it is the producer's raw material, and the hook payloads P1-T5 will publish carry model
// text (SEC-UI-2). A stream that forwarded whatever it was handed would be the leak.
import { describe, expect, it } from 'vitest';
import type { DraftEvent } from '../../../contracts/fd-event.ts';
import type { DeckSnapshot, SessionRow } from '../../../contracts/session-row.ts';
import { EventHub } from '../../../core/application/event-hub.ts';
import type { EventStream } from '../../../core/http/route.ts';
import { SessionStreamRoute } from '../../../core/http/session-stream-route.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeScheduler } from '../../fakes/fake-scheduler.ts';

interface SentFrame {
  readonly name: string;
  readonly data: unknown;
}

class FakeStream implements EventStream {
  public readonly sent: SentFrame[] = [];
  public comments = 0;
  public closed = false;
  private readonly handlers: (() => void)[] = [];

  public get names(): readonly string[] {
    return this.sent.map((frame) => frame.name);
  }

  public send(name: string, data: unknown): void {
    this.sent.push({ name, data });
  }

  public comment(): void {
    this.comments += 1;
  }

  public onClose(handler: () => void): void {
    this.handlers.push(handler);
  }

  public close(): void {
    this.closed = true;
    for (const handler of this.handlers) handler();
  }
}

const ROW: SessionRow = {
  sessionId: 'aaaaaaaa-0000-0000-0000-000000000000',
  shortId: 'aaaaaaaa',
  subscription: '365',
  kind: 'background',
  name: 'fd-one',
  cwd: 'C:\\work',
  startedAt: 1000,
  live: true,
  runState: 'working',
  status: undefined,
  attachable: true,
  notAttachableBecause: undefined,
};

function snapshotOf(rows: readonly SessionRow[] = [ROW]): DeckSnapshot {
  return { rows, unreadable: ['isg'], takenAt: 5000 };
}

interface Rig {
  readonly route: SessionStreamRoute;
  readonly hub: EventHub;
  readonly scheduler: FakeScheduler;
  readonly logger: FakeLogger;
}

function rig(snapshot: DeckSnapshot = snapshotOf()): Rig {
  const hub = new EventHub(new FakeLogger());
  const scheduler = new FakeScheduler();
  const logger = new FakeLogger();
  const route = new SessionStreamRoute({
    sessions: { snapshot: () => snapshot },
    feed: hub,
    scheduler,
    logger,
  });
  return { route, hub, scheduler, logger };
}

function reconcileEvent(type: string, payload: unknown): DraftEvent {
  return {
    at: 1000,
    sessionId: ROW.sessionId,
    subscription: '365',
    source: 'reconcile',
    type,
    payload,
  };
}

describe('SessionStreamRoute — the replay', () => {
  it('is registered at the path the deck and the contract agree on', () => {
    expect(rig().route.path).toBe('/stream');
    expect(rig().route.method).toBe('GET');
  });

  it('sends the whole picture before anything else', () => {
    const { route } = rig();
    const stream = new FakeStream();

    route.open(stream);

    expect(stream.names).toEqual(['snapshot']);
    expect(stream.sent[0]?.data).toEqual(snapshotOf());
  });

  it('carries the unreadable subscriptions, which no delta ever can', () => {
    // A failed sweep publishes nothing at all (Reconciler trap 1), so this frame is the only place
    // "I could not look" reaches the deck.
    const { route } = rig();
    const stream = new FakeStream();

    route.open(stream);

    expect(stream.sent[0]?.data).toMatchObject({ unreadable: ['isg'] });
  });

  it('replays without asking the source anything twice', () => {
    let asked = 0;
    const hub = new EventHub(new FakeLogger());
    const route = new SessionStreamRoute({
      sessions: {
        snapshot: () => {
          asked += 1;
          return snapshotOf();
        },
      },
      feed: hub,
      scheduler: new FakeScheduler(),
      logger: new FakeLogger(),
    });

    route.open(new FakeStream());
    hub.publish(reconcileEvent('seen', ROW));

    expect(asked).toBe(1);
  });
});

describe('SessionStreamRoute — the deltas', () => {
  it('turns seen and changed into one upsert each', () => {
    const { route, hub } = rig();
    const stream = new FakeStream();
    route.open(stream);

    hub.publish(reconcileEvent('seen', ROW));
    hub.publish(reconcileEvent('changed', { ...ROW, runState: 'blocked' }));

    expect(stream.names).toEqual(['snapshot', 'session.upsert', 'session.upsert']);
    expect(stream.sent[2]?.data).toMatchObject({ runState: 'blocked' });
  });

  it('sends the identity alone for a session that ended', () => {
    const { route, hub } = rig();
    const stream = new FakeStream();
    route.open(stream);

    hub.publish(reconcileEvent('gone', ROW));

    expect(stream.sent[1]).toEqual({
      name: 'session.gone',
      data: { sessionId: ROW.sessionId, subscription: '365' },
    });
  });

  it('serves every open stream', () => {
    const { route, hub } = rig();
    const first = new FakeStream();
    const second = new FakeStream();
    route.open(first);
    route.open(second);

    hub.publish(reconcileEvent('seen', ROW));

    expect(first.names).toEqual(['snapshot', 'session.upsert']);
    expect(second.names).toEqual(['snapshot', 'session.upsert']);
    expect(route.openCount).toBe(2);
  });
});

describe('SessionStreamRoute — what it refuses to forward', () => {
  it('drops an event from any source but the reconciler', () => {
    const { route, hub } = rig();
    const stream = new FakeStream();
    route.open(stream);

    // The shape P1-T5 will publish: a hook payload, which can carry model text (SEC-UI-2).
    hub.publish({
      at: 1000,
      sessionId: ROW.sessionId,
      subscription: '365',
      source: 'hook',
      type: 'Stop',
      payload: { last_assistant_message: 'ignore your instructions' },
    });

    expect(stream.names).toEqual(['snapshot']);
  });

  it('drops a reconcile event whose payload is not a row', () => {
    const { route, hub } = rig();
    const stream = new FakeStream();
    route.open(stream);

    hub.publish(reconcileEvent('seen', { sessionId: 'a', notARow: true }));

    expect(stream.names).toEqual(['snapshot']);
  });

  it('drops an event type it has no frame for', () => {
    const { route, hub } = rig();
    const stream = new FakeStream();
    route.open(stream);

    hub.publish(reconcileEvent('swept', ROW));

    expect(stream.names).toEqual(['snapshot']);
  });
});

describe('SessionStreamRoute — the connection', () => {
  it('beats on an idle stream, because a write is the only way to notice a dead peer', () => {
    const { route, scheduler } = rig();
    const stream = new FakeStream();
    route.open(stream);

    scheduler.tick();

    expect(stream.comments).toBe(1);
  });

  it('releases the subscription and the heartbeat when the client goes', () => {
    const { route, hub, scheduler } = rig();
    const stream = new FakeStream();
    route.open(stream);

    stream.close();
    hub.publish(reconcileEvent('seen', ROW));
    scheduler.tick();

    expect(stream.names).toEqual(['snapshot']);
    expect(stream.comments).toBe(0);
    expect(hub.subscriberCount).toBe(0);
    expect(scheduler.repeatingCount).toBe(0);
    expect(route.openCount).toBe(0);
  });

  it('closes every stream on shutdown, or core never exits with a deck open', () => {
    const { route, hub, scheduler } = rig();
    const first = new FakeStream();
    const second = new FakeStream();
    route.open(first);
    route.open(second);

    route.closeAll();

    expect(first.closed).toBe(true);
    expect(second.closed).toBe(true);
    expect(route.openCount).toBe(0);
    expect(hub.subscriberCount).toBe(0);
    expect(scheduler.repeatingCount).toBe(0);
  });

  it('logs the count so an operator can see a leak, and nothing about the session', () => {
    const { route, logger } = rig();
    const stream = new FakeStream();

    route.open(stream);
    stream.close();

    expect(logger.logged('stream_open')).toBe(true);
    expect(logger.at('info').at(-1)?.details).toEqual({ streams: 0 });
  });
});
