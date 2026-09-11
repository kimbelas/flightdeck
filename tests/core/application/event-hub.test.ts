// P1-T9. The hub's whole job is that a producer cannot be hurt by its audience, so most of these
// assert what a badly behaved subscriber must NOT be able to do.
import { describe, expect, it } from 'vitest';
import type { DraftEvent } from '../../../contracts/fd-event.ts';
import { EventHub } from '../../../core/application/event-hub.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';

function event(type: string): DraftEvent {
  return {
    at: 1000,
    sessionId: 'aaaaaaaa-0000-0000-0000-000000000000',
    subscription: '365',
    source: 'reconcile',
    type,
    payload: { any: 'thing' },
  };
}

describe('EventHub', () => {
  it('gives every subscriber every event, in publication order', () => {
    const hub = new EventHub(new FakeLogger());
    const first: string[] = [];
    const second: string[] = [];
    hub.subscribe((published) => first.push(published.type));
    hub.subscribe((published) => second.push(published.type));

    hub.publish(event('seen'));
    hub.publish(event('gone'));

    expect(first).toEqual(['seen', 'gone']);
    expect(second).toEqual(['seen', 'gone']);
  });

  it('delivers nothing to a cancelled subscriber', () => {
    const hub = new EventHub(new FakeLogger());
    const seen: string[] = [];
    const subscription = hub.subscribe((published) => seen.push(published.type));

    subscription.cancel();
    hub.publish(event('seen'));

    expect(seen).toEqual([]);
    expect(hub.subscriberCount).toBe(0);
  });

  it('survives a subscriber cancelling itself mid-publish', () => {
    // What a stream closing during a frame does. Without the copy in `publish` this mutates the
    // set under the loop, and the subscriber after it silently misses the event.
    const hub = new EventHub(new FakeLogger());
    const seen: string[] = [];
    const first = hub.subscribe(() => {
      first.cancel();
    });
    hub.subscribe((published) => seen.push(published.type));

    hub.publish(event('seen'));

    expect(seen).toEqual(['seen']);
    expect(hub.subscriberCount).toBe(1);
  });

  it('never lets a throwing subscriber reach the producer', () => {
    const hub = new EventHub(new FakeLogger());
    hub.subscribe(() => {
      throw new Error('the browser went away');
    });

    // The port's contract: a sweep must not die because a subscriber did (core/ports/event-sink.ts).
    expect(() => {
      hub.publish(event('seen'));
    }).not.toThrow();
  });

  it('still serves the other subscribers when one throws, and says so once', () => {
    const logger = new FakeLogger();
    const hub = new EventHub(logger);
    const seen: string[] = [];
    hub.subscribe(() => {
      throw new Error('first');
    });
    hub.subscribe((published) => seen.push(published.type));
    hub.subscribe(() => {
      throw new Error('third');
    });

    hub.publish(event('seen'));

    expect(seen).toEqual(['seen']);
    expect(logger.at('warn')).toHaveLength(1);
    expect(logger.last?.details).toMatchObject({ listeners: 2 });
  });

  it('says nothing when every subscriber behaved', () => {
    const logger = new FakeLogger();
    const hub = new EventHub(logger);
    hub.subscribe(() => undefined);

    hub.publish(event('seen'));

    expect(logger.lines).toEqual([]);
  });
});
