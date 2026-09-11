// P1-T9. Four lines of class, and one property worth pinning: the log and the stream are
// independent, so neither can cost the other an event.
import { describe, expect, it } from 'vitest';
import type { DraftEvent } from '../../../contracts/fd-event.ts';
import { FanOutEventSink } from '../../../core/adapters/fan-out-event-sink.ts';
import type { EventSink } from '../../../core/ports/event-sink.ts';
import { FakeEventSink } from '../../fakes/fake-event-sink.ts';

const EVENT: DraftEvent = {
  at: 1000,
  sessionId: 'aaaaaaaa-0000-0000-0000-000000000000',
  subscription: 'isg',
  source: 'reconcile',
  type: 'seen',
  payload: undefined,
};

/** A sink that breaks the port's "never throws" promise, which is the case worth testing. */
class BrokenSink implements EventSink {
  public publish(): void {
    throw new Error('sink is broken');
  }
}

describe('FanOutEventSink', () => {
  it('publishes to every sink', () => {
    const first = new FakeEventSink();
    const second = new FakeEventSink();

    new FanOutEventSink([first, second]).publish(EVENT);

    expect(first.published).toEqual([EVENT]);
    expect(second.published).toEqual([EVENT]);
  });

  it('keeps going when a sink throws, and does not re-throw at the producer', () => {
    const survivor = new FakeEventSink();
    const sink = new FanOutEventSink([new BrokenSink(), survivor]);

    expect(() => {
      sink.publish(EVENT);
    }).not.toThrow();
    expect(survivor.published).toEqual([EVENT]);
  });

  it('is a no-op with no sinks, rather than something to guard against at the call site', () => {
    expect(() => {
      new FanOutEventSink([]).publish(EVENT);
    }).not.toThrow();
  });
});
