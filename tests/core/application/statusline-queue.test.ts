// P1-T6. The ack-then-work contract, and the one thing that makes this queue different from the
// hook one: a render is not news, and a sweep per repaint would be absurd.
import { describe, expect, it } from 'vitest';
import { NO_QUOTA, type StatuslineReport } from '../../../contracts/statusline-report.ts';
import { StatuslineQueue } from '../../../core/application/statusline-queue.ts';
import { VitalsRegistry } from '../../../core/application/vitals-registry.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeEventSink } from '../../fakes/fake-event-sink.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeScheduler } from '../../fakes/fake-scheduler.ts';

const SESSION = 'cb5e8102-f057-4d5c-ad98-eac21a12f37d';

function report(overrides: Partial<StatuslineReport> = {}): StatuslineReport {
  return {
    sessionId: SESSION,
    transcriptPath: 'C:\\x\\.claude-isg\\t.jsonl',
    sessionName: 'one',
    modelId: 'claude-haiku-4-5-20251001',
    modelName: 'Haiku 4.5',
    claudeVersion: '2.1.267',
    costUsd: 0.02,
    usedPercentage: 20,
    contextWindowSize: 200_000,
    fiveHour: { usedPercentage: 23, resetsAt: 1_789_080_600_000 },
    sevenDay: NO_QUOTA,
    ...overrides,
  };
}

interface Rig {
  readonly queue: StatuslineQueue;
  readonly sink: FakeEventSink;
  readonly registry: VitalsRegistry;
  readonly scheduler: FakeScheduler;
  readonly logger: FakeLogger;
}

function rig(): Rig {
  const sink = new FakeEventSink();
  const registry = new VitalsRegistry();
  const scheduler = new FakeScheduler();
  const logger = new FakeLogger();
  const queue = new StatuslineQueue({
    sink,
    registry,
    scheduler,
    clock: new FakeClock(),
    logger,
  });
  return { queue, sink, registry, scheduler, logger };
}

describe('StatuslineQueue — the ack comes first', () => {
  it('records and publishes nothing during accept', () => {
    const { queue, sink, registry } = rig();

    queue.accept(report(), 'isg');

    expect(sink.published).toEqual([]);
    expect(registry.size).toBe(0);
    expect(queue.depth).toBe(1);
  });

  it('does the work when the drain comes due', () => {
    const { queue, sink, registry, scheduler } = rig();
    queue.accept(report(), 'isg');

    scheduler.advance(0);

    expect(registry.size).toBe(1);
    expect(sink.published).toHaveLength(1);
  });
});

describe('StatuslineQueue — a render is not news', () => {
  it('publishes the first render of a session', () => {
    const { queue, sink, scheduler } = rig();

    queue.accept(report(), 'isg');
    scheduler.advance(0);

    expect(sink.last).toMatchObject({
      sessionId: SESSION,
      subscription: 'isg',
      source: 'statusline',
      type: 'vitals',
    });
  });

  it('publishes nothing for the repaints that say the same thing', () => {
    // The whole point. The block posts on every render; almost none of them carry news.
    const { queue, sink, scheduler } = rig();

    for (let index = 0; index < 20; index += 1) queue.accept(report(), 'isg');
    scheduler.advance(0);

    expect(sink.published).toHaveLength(1);
    expect(queue.published).toBe(1);
  });

  it('publishes again the moment something moves', () => {
    const { queue, sink, scheduler } = rig();
    queue.accept(report(), 'isg');
    scheduler.advance(0);

    queue.accept(report({ usedPercentage: 42 }), 'isg');
    scheduler.advance(0);

    expect(sink.published).toHaveLength(2);
    expect(sink.last?.payload).toMatchObject({ usedPercentage: 42 });
  });

  it('keeps recording even when it is not publishing', () => {
    // The registry is what `flightdeck-core status` reads; a quiet feed is still a live one.
    const { queue, registry, scheduler } = rig();
    queue.accept(report(), 'isg');
    scheduler.advance(0);

    queue.accept(report(), 'isg');
    scheduler.advance(0);

    expect(registry.get(SESSION)).toBeDefined();
    expect(queue.published).toBe(1);
  });
});

describe('StatuslineQueue — what it publishes', () => {
  it('sends the projection, which carries no model text at all', () => {
    const { queue, sink, scheduler } = rig();

    queue.accept(report(), 'isg');
    scheduler.advance(0);

    expect(sink.last?.payload).toMatchObject({ sessionId: SESSION, usedPercentage: 20 });
  });

  it('stamps the arrival time rather than the drain time', () => {
    const clock = new FakeClock();
    const sink = new FakeEventSink();
    const scheduler = new FakeScheduler();
    const queue = new StatuslineQueue({
      sink,
      registry: new VitalsRegistry(),
      scheduler,
      clock,
      logger: new FakeLogger(),
    });
    const arrivedAt = clock.now().getTime();

    queue.accept(report(), 'isg');
    clock.advance(5000);
    scheduler.advance(0);

    expect(sink.last?.at).toBe(arrivedAt);
  });

  it('never throws at the caller, whatever the sink does', () => {
    const { queue, sink, scheduler } = rig();
    sink.failNext = true;

    expect(() => {
      queue.accept(report(), 'isg');
      scheduler.advance(0);
    }).not.toThrow();
    expect(sink.swallowed).toBe(1);
  });
});
