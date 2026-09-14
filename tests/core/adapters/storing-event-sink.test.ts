// The seam between an `EventSink` that must not throw and a `Store` that does — P1-T8.
import { describe, expect, it } from 'vitest';
import type { DraftEvent } from '../../../contracts/fd-event.ts';
import { StoringEventSink } from '../../../core/adapters/storing-event-sink.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeStore } from '../../fakes/fake-store.ts';

const SESSION = '11111111-2222-4333-a444-555555555555';

function event(over: Partial<DraftEvent> = {}): DraftEvent {
  return {
    at: 1000,
    sessionId: SESSION,
    subscription: '365',
    source: 'hook',
    type: 'Stop',
    payload: { hook_event_name: 'Stop' },
    ...over,
  };
}

function vitals(payload: unknown): DraftEvent {
  return event({ source: 'statusline', type: 'vitals', payload });
}

function build(): { sink: StoringEventSink; store: FakeStore; logger: FakeLogger } {
  const store = new FakeStore();
  const logger = new FakeLogger();
  return { sink: new StoringEventSink(store, logger), store, logger };
}

describe('StoringEventSink', () => {
  it('appends what it is given', () => {
    const { sink, store } = build();

    sink.publish(event());

    expect(store.allEvents).toHaveLength(1);
    expect(sink.stored).toBe(1);
  });

  it('never throws when the store does, and does not stop accepting', () => {
    const { sink, store } = build();
    store.breakWrites();

    expect(() => {
      sink.publish(event());
    }).not.toThrow();
    sink.publish(event());

    // A sweep must not die because the disk filled, and a hook must not 500 because an ACL
    // changed — `EventSink.publish` returns void and never throws, by contract.
    expect(sink.dropped).toBe(2);
    expect(sink.stored).toBe(0);
  });

  it('logs a broken store once, not once per event', () => {
    const { sink, store, logger } = build();
    store.breakWrites();

    for (let index = 0; index < 50; index += 1) sink.publish(event());

    // A broken store breaks on every event; an error line per hook turns a full disk into a
    // bigger full disk. The counter carries the rest.
    expect(logger.at('error')).toHaveLength(1);
    expect(sink.dropped).toBe(50);
  });

  it('keeps the payload out of the error line', () => {
    const { sink, store, logger } = build();
    store.breakWrites();

    sink.publish(event({ payload: { last_assistant_message: 'something private' } }));

    // The payload is the field most likely to carry model text (SEC-UI-2), and this line goes to
    // a file that is kept (SEC-DATA-2).
    expect(JSON.stringify(logger.at('error'))).not.toContain('something private');
  });
});

describe('StoringEventSink — the snapshot it writes alongside', () => {
  it('turns a vitals event into a snapshot row as well as an event row', () => {
    const { sink, store } = build();

    sink.publish(
      vitals({ sessionId: SESSION, usedPercentage: 20, costUsd: 1.5, modelId: 'claude-opus-5' }),
    );

    expect(store.allEvents).toHaveLength(1);
    expect(store.allSnapshots).toHaveLength(1);
    expect(store.allSnapshots[0]?.usedPercentage).toBe(20);
    expect(sink.snapshots).toBe(1);
  });

  it('writes no snapshot for an event from any other feed', () => {
    const { sink, store } = build();

    sink.publish(event());
    sink.publish(event({ source: 'reconcile', type: 'seen' }));

    // Feed 2 is the only one that carries vitals; a snapshot from a hook would be invented data.
    expect(store.allSnapshots).toEqual([]);
    expect(sink.snapshots).toBe(0);
  });

  it('writes no snapshot when the payload is not one, rather than a row of nulls', () => {
    const { sink, store } = build();

    for (const payload of [undefined, null, 42, 'text', [], {}, { sessionId: 7 }]) {
      sink.publish(vitals(payload));
    }

    expect(store.allEvents).toHaveLength(7);
    expect(store.allSnapshots).toEqual([]);
  });

  it('takes the time from the event, so a replayed row keeps its own instant', () => {
    const { sink, store } = build();

    sink.publish({ ...vitals({ sessionId: SESSION }), at: 12_345 });

    expect(store.allSnapshots[0]?.at).toBe(12_345);
  });
});
