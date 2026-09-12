// P1-T6. The route is nine lines of Python's worth of somebody's render budget, so the tests are
// about what it costs them when things go wrong rather than only when they go right.
import { describe, expect, it } from 'vitest';
import { StatuslineQueue } from '../../../core/application/statusline-queue.ts';
import { SubscriptionPaths } from '../../../core/application/subscription-paths.ts';
import { VitalsRegistry } from '../../../core/application/vitals-registry.ts';
import { BUDGETS } from '../../../core/http/limits.ts';
import type { RequestFacts } from '../../../core/http/loopback-guard.ts';
import { RateLimiter } from '../../../core/http/rate-limiter.ts';
import { StatuslineRoute } from '../../../core/http/statusline-route.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeEventSink } from '../../fakes/fake-event-sink.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeScheduler } from '../../fakes/fake-scheduler.ts';

const SESSION = 'cb5e8102-f057-4d5c-ad98-eac21a12f37d';

const PAYLOAD = {
  session_id: SESSION,
  transcript_path: 'C:\\Users\\dev\\.claude-isg\\projects\\p\\t.jsonl',
  session_name: 'one',
  model: { id: 'claude-haiku-4-5-20251001', display_name: 'Haiku 4.5' },
  cost: { total_cost_usd: 0.02 },
  context_window: { used_percentage: 20, context_window_size: 200000 },
  rate_limits: { five_hour: { used_percentage: 23, resets_at: 1789080600 } },
};

/** No Origin, like a hook — this is a python socket, not a browser (RESEARCH.md F.3.1). */
const FACTS: RequestFacts = {
  method: 'POST',
  url: '/statusline',
  headers: { host: '127.0.0.1:4950', 'content-type': 'application/json' },
};

interface Rig {
  readonly route: StatuslineRoute;
  readonly queue: StatuslineQueue;
  readonly registry: VitalsRegistry;
  readonly scheduler: FakeScheduler;
  readonly logger: FakeLogger;
}

function rig(): Rig {
  const registry = new VitalsRegistry();
  const scheduler = new FakeScheduler();
  const logger = new FakeLogger();
  const queue = new StatuslineQueue({
    sink: new FakeEventSink(),
    registry,
    scheduler,
    clock: new FakeClock(),
    logger,
  });
  const route = new StatuslineRoute({
    queue,
    paths: new SubscriptionPaths({
      '365': 'C:\\Users\\dev\\.claude-365',
      isg: 'C:\\Users\\dev\\.claude-isg',
    }),
    limiter: new RateLimiter(new FakeClock()),
    logger,
  });
  return { route, queue, registry, scheduler, logger };
}

function post(route: StatuslineRoute, body: unknown): { status: number; body: unknown } {
  return route.handle(FACTS, typeof body === 'string' ? body : JSON.stringify(body));
}

describe('StatuslineRoute — the ack', () => {
  it('is where Connect will point the block', () => {
    const { route } = rig();

    expect(route.method).toBe('POST');
    expect(route.path).toBe('/statusline');
    expect(route.limit).toBe('ingest');
  });

  it('answers 200 with an empty object', () => {
    const { route } = rig();

    const reply = post(route, PAYLOAD);

    expect(reply.status).toBe(200);
    expect(JSON.stringify(reply.body)).toBe('{}');
  });

  it('hands over without doing the work first', () => {
    const { route, queue, registry } = rig();

    post(route, PAYLOAD);

    expect(queue.depth).toBe(1);
    expect(registry.size).toBe(0);
  });

  it('records the vitals once the drain runs', () => {
    const { route, registry, scheduler } = rig();

    post(route, PAYLOAD);
    scheduler.advance(0);

    expect(registry.get(SESSION)).toMatchObject({
      subscription: 'isg',
      report: { usedPercentage: 20 },
    });
  });
});

describe('StatuslineRoute — attribution', () => {
  it('reads the subscription off the transcript path', () => {
    const { route, registry, scheduler } = rig();

    post(route, {
      ...PAYLOAD,
      transcript_path: 'C:\\Users\\dev\\.claude-365\\projects\\p\\t.jsonl',
    });
    scheduler.advance(0);

    expect(registry.get(SESSION)?.subscription).toBe('365');
  });

  it('refuses a render it cannot attribute', () => {
    const { route, queue } = rig();

    const reply = post(route, { ...PAYLOAD, transcript_path: 'C:\\Windows\\Temp\\t.jsonl' });

    expect(reply.status).toBe(400);
    expect(queue.depth).toBe(0);
  });
});

describe('StatuslineRoute — what it refuses', () => {
  it('answers 400 for a body that is not JSON or not a payload', () => {
    const { route } = rig();

    expect(post(route, '{not json').status).toBe(400);
    expect(post(route, { hello: 'there' }).status).toBe(400);
  });

  it('tells the sender nothing, because nothing is listening', () => {
    // The block swallows every exception by design (SEC-ING-3), so a refusal is invisible to the
    // owner — which is the reason it must also cost them nothing.
    const { route } = rig();

    expect(JSON.stringify(post(route, { hello: 'there' }).body)).toBe('{"error":"bad request"}');
  });

  it('keeps the numbers out of the log', () => {
    const { route, logger } = rig();

    post(route, { ...PAYLOAD, session_id: 'nope' });

    expect(logger.logged('statusline_rejected')).toBe(true);
    expect(JSON.stringify(logger.lines)).not.toContain('0.02');
  });

  it('answers 429 past the ingest budget, per session', () => {
    const { route } = rig();
    for (let index = 0; index < BUDGETS.ingest.perMinute; index += 1) post(route, PAYLOAD);

    expect(post(route, PAYLOAD).status).toBe(429);
    const other = post(route, { ...PAYLOAD, session_id: 'aaaaaaaa-0000-0000-0000-000000000000' });
    expect(other.status).toBe(200);
  });
});
