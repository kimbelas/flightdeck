// P1-T9, and CODING-STANDARDS §10.4: the store is tested without React and without a browser.
//
// The fake transport is the whole reason `DeckStore` takes one. Reconnection is the behaviour most
// likely to be quietly wrong — an `EventSource` gives up for good on an HTTP error, which is what
// core being down looks like — and a test that waited two real seconds for each retry is a test
// that gets deleted.
import { describe, expect, it } from 'vitest';
import type { SessionRow } from '../../contracts/session-row.ts';
import {
  DeckStore,
  type EventStreamSource,
  type StreamTransport,
} from '../../app/deck/deck-store.ts';

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

const OTHER: SessionRow = {
  ...ROW,
  sessionId: 'bbbbbbbb-0000-0000-0000-000000000000',
  shortId: 'bbbbbbbb',
  subscription: 'isg',
  startedAt: 500,
};

class FakeEventStream implements EventStreamSource {
  public closed = 0;
  private readonly listeners = new Map<string, (data: string) => void>();

  public on(type: string, listener: (data: string) => void): void {
    this.listeners.set(type, listener);
  }

  public close(): void {
    this.closed += 1;
  }

  /** Delivers one frame, the way the browser would. */
  public deliver(type: string, data: unknown): void {
    this.listeners.get(type)?.(JSON.stringify(data));
  }

  public fail(): void {
    this.listeners.get('error')?.('');
  }
}

class FakeTransport implements StreamTransport {
  public readonly opened: string[] = [];
  public readonly streams: FakeEventStream[] = [];
  private waiting: (() => void) | undefined;

  public get last(): FakeEventStream | undefined {
    return this.streams.at(-1);
  }

  public get isWaiting(): boolean {
    return this.waiting !== undefined;
  }

  public open(url: string): EventStreamSource {
    this.opened.push(url);
    const stream = new FakeEventStream();
    this.streams.push(stream);
    return stream;
  }

  public wait(ms: number, task: () => void): () => void {
    this.waiting = task;
    return () => {
      this.waiting = undefined;
    };
  }

  /** Fires the pending retry, as the browser's timer would. */
  public elapse(): void {
    const task = this.waiting;
    this.waiting = undefined;
    task?.();
  }
}

function rig(): { store: DeckStore; transport: FakeTransport } {
  const transport = new FakeTransport();
  return { store: new DeckStore(transport), transport };
}

function snapshot(rows: readonly SessionRow[], unreadable: readonly string[] = []): unknown {
  return { rows, unreadable, takenAt: 1 };
}

describe('DeckStore — connecting', () => {
  it('opens the deck route, not core directly', () => {
    const { store, transport } = rig();

    store.connect();

    // A page at :4949 cannot reach :4950 at all — a port is part of an origin (RESEARCH.md F.4.2).
    expect(transport.opened).toEqual(['/api/stream']);
  });

  it('opens once, however many times it is asked', () => {
    // StrictMode mounts an effect twice in development; two connections would be two subscriptions.
    const { store, transport } = rig();

    store.connect();
    store.connect();

    expect(transport.opened).toHaveLength(1);
  });

  it('reopens after a disconnect', () => {
    const { store, transport } = rig();
    store.connect();

    store.disconnect();
    store.connect();

    expect(transport.opened).toHaveLength(2);
    expect(transport.streams[0]?.closed).toBe(1);
  });
});

describe('DeckStore — frames', () => {
  it('takes the whole picture from the snapshot', () => {
    const { store, transport } = rig();
    store.connect();

    transport.last?.deliver('snapshot', snapshot([ROW], ['isg']));

    expect(store.snapshot().rows).toEqual([ROW]);
    expect(store.snapshot().unreadable).toEqual(['isg']);
    expect(store.snapshot().coreUp).toBe(true);
    expect(store.snapshot().loading).toBe(false);
  });

  it('replaces a row it already has rather than showing it twice', () => {
    const { store, transport } = rig();
    store.connect();
    transport.last?.deliver('snapshot', snapshot([ROW]));

    transport.last?.deliver('session.upsert', { ...ROW, runState: 'blocked' });

    expect(store.snapshot().rows).toHaveLength(1);
    expect(store.snapshot().rows[0]?.runState).toBe('blocked');
  });

  it('adds a session it has never seen, in the deck\u2019s order', () => {
    const { store, transport } = rig();
    store.connect();
    transport.last?.deliver('snapshot', snapshot([OTHER]));

    transport.last?.deliver('session.upsert', { ...ROW, runState: 'blocked' });

    expect(store.snapshot().rows.map((row) => row.shortId)).toEqual(['aaaaaaaa', 'bbbbbbbb']);
  });

  it('drops the row a gone frame names, and only that one', () => {
    const { store, transport } = rig();
    store.connect();
    transport.last?.deliver('snapshot', snapshot([ROW, OTHER]));

    transport.last?.deliver('session.gone', {
      sessionId: ROW.sessionId,
      subscription: ROW.subscription,
    });

    expect(store.snapshot().rows.map((row) => row.shortId)).toEqual(['bbbbbbbb']);
  });

  it('keeps a row whose id matches under the other subscription', () => {
    // Ids are only unique within a config dir, so the key is both fields.
    const { store, transport } = rig();
    store.connect();
    transport.last?.deliver('snapshot', snapshot([ROW]));

    transport.last?.deliver('session.gone', { sessionId: ROW.sessionId, subscription: 'isg' });

    expect(store.snapshot().rows).toHaveLength(1);
  });

  it('ignores a frame it cannot parse rather than rendering half a row', () => {
    const { store, transport } = rig();
    store.connect();
    transport.last?.deliver('snapshot', snapshot([ROW]));

    transport.last?.deliver('session.upsert', { sessionId: 'not-a-row' });

    expect(store.snapshot().rows).toEqual([ROW]);
  });

  it('tells React about every frame, so the page re-renders', () => {
    const { store, transport } = rig();
    let renders = 0;
    store.subscribe(() => {
      renders += 1;
    });
    store.connect();
    const before = renders;

    transport.last?.deliver('snapshot', snapshot([ROW]));

    expect(renders).toBeGreaterThan(before);
  });
});

describe('DeckStore — losing core', () => {
  it('says so on the page rather than showing a stale list as live', () => {
    const { store, transport } = rig();
    store.connect();
    transport.last?.deliver('snapshot', snapshot([ROW]));

    transport.last?.fail();

    expect(store.snapshot().coreUp).toBe(false);
    expect(store.snapshot().error).toBe('flightdeck-core is not answering.');
    // The rows stay: what core last said is still the best answer anyone has.
    expect(store.snapshot().rows).toEqual([ROW]);
  });

  it('closes the dead connection and opens a new one after the wait', () => {
    const { store, transport } = rig();
    store.connect();

    transport.last?.fail();
    expect(transport.opened).toHaveLength(1);
    expect(transport.isWaiting).toBe(true);

    transport.elapse();

    expect(transport.opened).toHaveLength(2);
    expect(transport.streams[0]?.closed).toBe(1);
  });

  it('is live again when the new connection delivers its snapshot', () => {
    const { store, transport } = rig();
    store.connect();
    transport.last?.fail();
    transport.elapse();

    transport.last?.deliver('snapshot', snapshot([ROW]));

    expect(store.snapshot().coreUp).toBe(true);
    expect(store.snapshot().error).toBeUndefined();
  });

  it('does not retry after a deliberate disconnect', () => {
    const { store, transport } = rig();
    store.connect();
    transport.last?.fail();

    store.disconnect();
    transport.elapse();

    expect(transport.opened).toHaveLength(1);
  });
});
