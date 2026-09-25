// The `quota` frame, which is the whole of the header's feed — P2-T3.
//
// Its own file rather than another block in deck-store.test.ts, which was already at its line
// limit — and it is a different question anyway. That file asks what a delta does to the session
// table; this one asks what a frame that is WHOLE-STATE does, which is the thing quota is and a row
// is not.
import { describe, expect, it } from 'vitest';
import type { SessionRow } from '../../contracts/session-row.ts';
import {
  DeckStore,
  type EventStreamSource,
  type StreamTransport,
} from '../../app/deck/deck-store.ts';
import { FakeDeckApi } from '../fakes/fake-deck-api.ts';

const ROW: SessionRow = {
  sessionId: 'aaaaaaaa-0000-0000-0000-000000000000',
  shortId: 'aaaaaaaa',
  subscription: '365',
  kind: 'background',
  name: 'alpha',
  cwd: 'C:\\work',
  startedAt: 1000,
  live: true,
  runState: 'working',
  status: undefined,
  attachable: true,
  notAttachableBecause: undefined,
  endReason: 'unknown',
  retireReason: undefined,
};

/** One connection, reduced to "what did the store subscribe to, and what can be handed to it". */
class FakeEventStream implements EventStreamSource {
  private readonly listeners = new Map<string, (data: string) => void>();

  public on(type: string, listener: (data: string) => void): void {
    this.listeners.set(type, listener);
  }

  public close(): void {
    // Nothing to release; nothing in this file reconnects.
  }

  public deliver(type: string, data: unknown): void {
    this.listeners.get(type)?.(JSON.stringify(data));
  }
}

class FakeTransport implements StreamTransport {
  public readonly streams: FakeEventStream[] = [];

  public get last(): FakeEventStream | undefined {
    return this.streams.at(-1);
  }

  public open(): EventStreamSource {
    const stream = new FakeEventStream();
    this.streams.push(stream);
    return stream;
  }

  public wait(): () => void {
    return () => {
      // No retry is exercised here; reconnection is deck-store.test.ts's subject.
    };
  }
}

function rig(): { store: DeckStore; transport: FakeTransport } {
  const transport = new FakeTransport();
  return { store: new DeckStore(transport, new FakeDeckApi()), transport };
}

function snapshot(rows: readonly SessionRow[]): unknown {
  return { rows, unreadable: [], takenAt: 1 };
}

function quotaFrame(fiveHourPercentage: number): unknown {
  return {
    at: 1_789_000_100_000,
    subscriptions: [
      {
        subscription: 'isg',
        at: 1_789_000_090_000,
        fiveHour: { usedPercentage: fiveHourPercentage, resetsAt: 1_789_007_300_000, at: 1 },
        sevenDay: { usedPercentage: 61, resetsAt: 1_789_400_000_000, at: 1 },
        claudeVersion: '2.1.7',
        spendUsd: 4.2,
        spendingSessions: 3,
      },
    ],
  };
}

describe('DeckStore — the quota frame', () => {
  it('holds nothing until the first frame arrives', () => {
    // `undefined`, not an empty summary: the header draws two blocks from what core sent, and
    // inventing a shape here would be inventing gauges at 0 % for an account nobody has heard from.
    const { store } = rig();
    store.connect();

    expect(store.snapshot().quota).toBeUndefined();
  });

  it('takes both subscriptions off the replay', () => {
    const { store, transport } = rig();
    store.connect();

    transport.last?.deliver('quota', quotaFrame(23));

    expect(store.snapshot().quota?.subscriptions[0]?.fiveHour.usedPercentage).toBe(23);
    expect(store.snapshot().coreUp).toBe(true);
  });

  it('replaces the whole summary rather than merging into it', () => {
    // Quota is whole-state: core decides which of a subscription's sessions represents it, so half
    // of an older summary beside half of a newer one is a reading that was never taken.
    const { store, transport } = rig();
    store.connect();
    transport.last?.deliver('quota', quotaFrame(23));

    transport.last?.deliver('quota', quotaFrame(88));

    expect(store.snapshot().quota?.subscriptions[0]?.fiveHour.usedPercentage).toBe(88);
  });

  it('drops a frame it cannot parse and keeps the gauges it had', () => {
    const { store, transport } = rig();
    store.connect();
    transport.last?.deliver('quota', quotaFrame(23));

    transport.last?.deliver('quota', { subscriptions: 'both' });

    expect(store.snapshot().quota?.subscriptions[0]?.fiveHour.usedPercentage).toBe(23);
  });

  it('leaves the rows alone — it is the header`s frame, not the table`s', () => {
    const { store, transport } = rig();
    store.connect();
    transport.last?.deliver('snapshot', snapshot([ROW]));

    transport.last?.deliver('quota', quotaFrame(23));

    expect(store.snapshot().rows).toEqual([ROW]);
  });
});
