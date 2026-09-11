// P1-T5. The half of the receiver that happens after the ack.
//
// Two properties matter more than the rest, and both are about somebody else's session: nothing
// here may run before the route has answered (SEC-ING-2), and nothing here may throw at the caller
// — a hook that errors puts a banner in front of the owner for every turn afterwards (F.1.5).
import { describe, expect, it } from 'vitest';
import type { HookPayload } from '../../../contracts/hook-event.ts';
import { HookQueue, type SweepTrigger } from '../../../core/application/hook-queue.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeEventSink } from '../../fakes/fake-event-sink.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeScheduler } from '../../fakes/fake-scheduler.ts';

function payload(overrides: Partial<HookPayload> = {}): HookPayload {
  return {
    session_id: 'aaaaaaaa-0000-0000-0000-000000000000',
    hook_event_name: 'Stop',
    transcript_path: 'C:\\Users\\dev\\.claude-isg\\projects\\p\\t.jsonl',
    cwd: 'C:\\work',
    scratchpad_dir: undefined,
    session_title: undefined,
    model: undefined,
    source: undefined,
    prompt_id: undefined,
    permission_mode: undefined,
    stop_hook_active: undefined,
    last_assistant_message: undefined,
    ...overrides,
  };
}

class CountingTrigger implements SweepTrigger {
  public nudges = 0;

  public nudge(): void {
    this.nudges += 1;
  }
}

interface Rig {
  readonly queue: HookQueue;
  readonly sink: FakeEventSink;
  readonly scheduler: FakeScheduler;
  readonly trigger: CountingTrigger;
  readonly logger: FakeLogger;
}

function rig(): Rig {
  const sink = new FakeEventSink();
  const scheduler = new FakeScheduler();
  const trigger = new CountingTrigger();
  const logger = new FakeLogger();
  const queue = new HookQueue({ sink, trigger, scheduler, clock: new FakeClock(), logger });
  return { queue, sink, scheduler, trigger, logger };
}

describe('HookQueue — the ack comes first', () => {
  it('publishes nothing during accept', () => {
    // The whole SEC-ING-2 contract in one assertion: the route returns before any of this runs.
    const { queue, sink, trigger } = rig();

    queue.accept(payload(), 'isg');

    expect(sink.published).toEqual([]);
    expect(trigger.nudges).toBe(0);
    expect(queue.depth).toBe(1);
  });

  it('publishes when the drain comes due', () => {
    const { queue, sink, scheduler } = rig();
    queue.accept(payload(), 'isg');

    scheduler.advance(0);

    expect(sink.published).toHaveLength(1);
    expect(queue.depth).toBe(0);
  });

  it('schedules one drain for a burst, not one per event', () => {
    const { queue, sink, scheduler } = rig();

    queue.accept(payload(), 'isg');
    queue.accept(payload({ hook_event_name: 'SubagentStop' }), 'isg');
    queue.accept(payload({ hook_event_name: 'Notification' }), 'isg');

    expect(scheduler.pendingCount).toBe(1);
    scheduler.advance(0);
    expect(sink.published).toHaveLength(3);
  });
});

describe('HookQueue — what it publishes', () => {
  it('describes the event as the hook named it, from the source that saw it', () => {
    const { queue, sink, scheduler } = rig();
    queue.accept(payload({ hook_event_name: 'SubagentStop' }), '365');
    scheduler.advance(0);

    expect(sink.last).toMatchObject({
      sessionId: 'aaaaaaaa-0000-0000-0000-000000000000',
      subscription: '365',
      source: 'hook',
      type: 'SubagentStop',
    });
  });

  it('stamps the arrival time, not the drain time', () => {
    // The event says when it happened. A queue that ran late would otherwise move the timestamp.
    const clock = new FakeClock();
    const sink = new FakeEventSink();
    const scheduler = new FakeScheduler();
    const queue = new HookQueue({
      sink,
      trigger: new CountingTrigger(),
      scheduler,
      clock,
      logger: new FakeLogger(),
    });
    const arrivedAt = clock.now().getTime();

    queue.accept(payload(), 'isg');
    clock.advance(5000);
    scheduler.advance(0);

    expect(sink.last?.at).toBe(arrivedAt);
  });

  it('keeps the payload verbatim, model text included', () => {
    const { queue, sink, scheduler } = rig();
    const text = 'whatever the model said';

    queue.accept(payload({ last_assistant_message: text }), 'isg');
    scheduler.advance(0);

    // Kept for the store (P1-T8). Nothing renders it: SessionStreamRoute refuses every event that
    // is not the reconciler's, so a hook payload has no path to a browser (SEC-UI-2).
    expect(sink.last?.payload).toMatchObject({ last_assistant_message: text });
  });
});

describe('HookQueue — the nudge', () => {
  it('asks the reconciler to look, once per batch', () => {
    // A turn ending fires more than one hook, and each of them asking would be the same sweep.
    const { queue, scheduler, trigger } = rig();

    queue.accept(payload(), 'isg');
    queue.accept(payload({ hook_event_name: 'SubagentStop' }), 'isg');
    scheduler.advance(0);

    expect(trigger.nudges).toBe(1);
  });

  it('does not nudge for an empty drain', () => {
    const { queue, trigger } = rig();

    queue.drain();

    expect(trigger.nudges).toBe(0);
  });
});

describe('HookQueue — when something is wrong', () => {
  it('never throws at the caller, whatever the sink does', () => {
    const { queue, sink, scheduler } = rig();
    sink.failNext = true;

    expect(() => {
      queue.accept(payload(), 'isg');
    }).not.toThrow();
    expect(() => {
      scheduler.advance(0);
    }).not.toThrow();
    expect(sink.swallowed).toBe(1);
  });

  it('drops the newest once the queue is full, and keeps what it already had', () => {
    const { queue, sink, scheduler } = rig();
    for (let index = 0; index < 600; index += 1) queue.accept(payload(), 'isg');

    queue.accept(payload({ hook_event_name: 'TooLate' }), 'isg');

    expect(queue.dropped).toBe(1);
    scheduler.advance(0);
    expect(sink.published).toHaveLength(600);
    expect(sink.ofType('TooLate')).toEqual([]);
  });

  it('says so once rather than once per dropped event', () => {
    const { queue, logger } = rig();
    for (let index = 0; index < 610; index += 1) queue.accept(payload(), 'isg');

    // At 600 events a minute the log would become the incident. The count is what doctor reads.
    expect(logger.at('warn')).toHaveLength(1);
    expect(queue.dropped).toBe(10);
  });
});
