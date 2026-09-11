// The contract worth asserting is the one a producer relies on: publishing never throws.
//
// P1-T5 acks a hook in under 5 ms with the work queued behind it (RESEARCH.md F.1). A sink that
// threw would put that failure inside the receiver, and a sweep that threw because a browser
// disconnected would take the reconciler down with it.
import { describe, expect, it } from 'vitest';
import type { DraftEvent } from '../../contracts/fd-event.ts';
import { FakeEventSink } from './fake-event-sink.ts';

const event: DraftEvent = {
  at: 1000,
  sessionId: 'a',
  subscription: '365',
  source: 'hook',
  type: 'Stop',
  payload: {},
};

describe('FakeEventSink', () => {
  it('records what was published, in order', () => {
    const sink = new FakeEventSink();

    sink.publish(event);
    sink.publish({ ...event, type: 'SessionStart' });

    expect(sink.published.map((published) => published.type)).toEqual(['Stop', 'SessionStart']);
    expect(sink.last?.type).toBe('SessionStart');
  });

  it('swallows a failure rather than raising it at the producer', () => {
    const sink = new FakeEventSink();
    sink.failNext = true;

    expect(() => {
      sink.publish(event);
    }).not.toThrow();
    expect(sink.published).toHaveLength(0);
    expect(sink.swallowed).toBe(1);
  });

  it('fails once, not for ever', () => {
    const sink = new FakeEventSink();
    sink.failNext = true;

    sink.publish(event);
    sink.publish(event);

    expect(sink.published).toHaveLength(1);
  });

  it('selects by type', () => {
    const sink = new FakeEventSink();
    sink.publish(event);
    sink.publish({ ...event, type: 'SessionStart' });
    sink.publish(event);

    expect(sink.ofType('Stop')).toHaveLength(2);
  });
});
