// The `quota` half of `GET /stream` — P2-T3.
//
// Split from session-stream-route.test.ts, which was at its line limit, and it earns the split: the
// two replays fail in different ways, and the third test below is a security assertion wearing
// ordinary clothes rather than a behavioural one.
import { describe, expect, it } from 'vitest';
import type { DraftEvent } from '../../../contracts/fd-event.ts';
import { VITALS_EVENT } from '../../../core/application/statusline-queue.ts';
import { FakeStream, quotaOf, rig, ROW } from './session-stream-harness.ts';

/** What `StatuslineQueue` publishes, payload and all — including the path that must not travel. */
function vitalsEvent(): DraftEvent {
  return {
    at: 1000,
    sessionId: ROW.sessionId,
    subscription: 'isg',
    source: 'statusline',
    type: VITALS_EVENT,
    payload: {
      session_id: ROW.sessionId,
      transcript_path: 'C:\\Users\\someone\\.claude-isg\\projects\\p\\t.jsonl',
    },
  };
}

describe('SessionStreamRoute — quota', () => {
  it('replays the gauges on connect, so an idle machine is not two empty bars', () => {
    // The whole reason the header is on the stream. The statusLine posts per render, so a machine
    // with nothing running publishes nothing at all — a deck that waited for an event would show
    // empty gauges until somebody started work, and then blame core.
    const { route, quota } = rig();
    const stream = new FakeStream();

    route.open(stream);

    expect(stream.sent[1]).toEqual({ name: 'quota', data: quotaOf() });
    expect(quota.asked).toBe(1);
  });

  it('sends a fresh summary when the vitals move', () => {
    const { route, hub, quota } = rig();
    const stream = new FakeStream();
    route.open(stream);

    hub.publish(vitalsEvent());

    expect(stream.names).toEqual(['snapshot', 'quota', 'quota']);
    expect(quota.asked).toBe(2);
  });

  it('asks QuotaReport rather than relaying what the event carried', () => {
    // Two bugs in one assertion. The event's payload is a whole `StatuslineReport`, which carries
    // `transcript_path` — the account name and the project folder (SEC-DATA-2). And quota is a
    // property of a SUBSCRIPTION while the event is about one session, so relaying it would hand
    // the deck one of ten readings and leave it to guess which represents the account.
    const { route, hub } = rig();
    const stream = new FakeStream();
    route.open(stream);

    hub.publish(vitalsEvent());

    const sent = JSON.stringify(stream.sent);
    expect(sent).not.toContain('.claude-isg');
    expect(sent).not.toContain('transcript_path');
    expect(stream.sent[2]?.data).toEqual(quotaOf());
  });

  it('serves every open stream the same answer', () => {
    const { route, hub } = rig();
    const first = new FakeStream();
    const second = new FakeStream();
    route.open(first);
    route.open(second);

    hub.publish(vitalsEvent());

    expect(first.names).toEqual(['snapshot', 'quota', 'quota']);
    expect(second.names).toEqual(['snapshot', 'quota', 'quota']);
  });

  it('ignores a statusline event that is not the vitals one', () => {
    const { route, hub, quota } = rig();
    const stream = new FakeStream();
    route.open(stream);

    hub.publish({ ...vitalsEvent(), type: 'render' });

    expect(stream.names).toEqual(['snapshot', 'quota']);
    expect(quota.asked).toBe(1);
  });
});
