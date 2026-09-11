// P1-T5. The route, tested through what it answers — because what it answers is read by Claude
// Code and a wrong answer is visible to the owner for every turn afterwards (RESEARCH.md F.1.5).
import { describe, expect, it } from 'vitest';
import { HookQueue } from '../../../core/application/hook-queue.ts';
import { SubscriptionPaths } from '../../../core/application/subscription-paths.ts';
import { HooksRoute } from '../../../core/http/hooks-route.ts';
import { BUDGETS } from '../../../core/http/limits.ts';
import type { RequestFacts } from '../../../core/http/loopback-guard.ts';
import { RateLimiter } from '../../../core/http/rate-limiter.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeEventSink } from '../../fakes/fake-event-sink.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeScheduler } from '../../fakes/fake-scheduler.ts';

const SESSION = 'aaaaaaaa-0000-0000-0000-000000000000';
const ISG_TRANSCRIPT = 'C:\\Users\\dev\\.claude-isg\\projects\\p\\t.jsonl';

const PAYLOAD = {
  session_id: SESSION,
  hook_event_name: 'Stop',
  transcript_path: ISG_TRANSCRIPT,
  cwd: 'C:\\work',
};

/** The facts a hook actually arrives with: no Origin at all (RESEARCH.md F.1.3). */
const FACTS: RequestFacts = {
  method: 'POST',
  url: '/hooks',
  headers: { host: '127.0.0.1:4950', 'content-type': 'application/json' },
};

interface Rig {
  readonly route: HooksRoute;
  readonly queue: HookQueue;
  readonly sink: FakeEventSink;
  readonly scheduler: FakeScheduler;
  readonly logger: FakeLogger;
}

function rig(): Rig {
  const sink = new FakeEventSink();
  const scheduler = new FakeScheduler();
  const logger = new FakeLogger();
  const queue = new HookQueue({
    sink,
    trigger: {
      nudge: (): void => {
        // Asserted in hook-queue.test.ts; here the route is the subject.
      },
    },
    scheduler,
    clock: new FakeClock(),
    logger,
  });
  const route = new HooksRoute({
    queue,
    paths: new SubscriptionPaths({
      '365': 'C:\\Users\\dev\\.claude-365',
      isg: 'C:\\Users\\dev\\.claude-isg',
    }),
    limiter: new RateLimiter(new FakeClock()),
    logger,
  });
  return { route, queue, sink, scheduler, logger };
}

function post(route: HooksRoute, body: unknown): { status: number; body: unknown } {
  return route.handle(FACTS, typeof body === 'string' ? body : JSON.stringify(body));
}

describe('HooksRoute — the ack', () => {
  it('is registered where Connect will point the hooks', () => {
    const { route } = rig();

    expect(route.method).toBe('POST');
    expect(route.path).toBe('/hooks');
  });

  it('answers 200 with an empty object, which is the only safe reply', () => {
    // A hook handler's response is read by Claude Code and can carry decisions. Core observes
    // sessions; it does not steer them.
    const { route } = rig();

    const reply = post(route, PAYLOAD);

    expect(reply.status).toBe(200);
    expect(JSON.stringify(reply.body)).toBe('{}');
  });

  it('hands the payload over without doing the work first', () => {
    const { route, queue, sink } = rig();

    post(route, PAYLOAD);

    expect(queue.depth).toBe(1);
    expect(sink.published).toEqual([]);
  });

  it('spends the ingest budget rather than the control one', () => {
    const { route } = rig();

    expect(route.limit).toBe('ingest');
    expect(BUDGETS.ingest.bodyBytes).toBeGreaterThan(BUDGETS.control.bodyBytes);
  });
});

describe('HooksRoute — attribution', () => {
  it('reads the subscription off the transcript path', () => {
    const { route, sink, scheduler } = rig();

    post(route, { ...PAYLOAD, transcript_path: 'C:\\Users\\dev\\.claude-365\\p\\t.jsonl' });
    scheduler.advance(0);

    expect(sink.last?.subscription).toBe('365');
  });

  it('refuses a payload it cannot attribute to either subscription', () => {
    // Fail closed. The same token authenticates both, so a transcript under neither config dir is
    // not something to guess about.
    const { route, queue } = rig();

    const reply = post(route, { ...PAYLOAD, transcript_path: 'C:\\Windows\\Temp\\t.jsonl' });

    expect(reply.status).toBe(400);
    expect(queue.depth).toBe(0);
  });
});

describe('HooksRoute — what it refuses', () => {
  it('answers 400 for a body that is not JSON', () => {
    const { route } = rig();

    expect(post(route, '{not json').status).toBe(400);
  });

  it('answers 400 for JSON that is not a hook payload', () => {
    const { route } = rig();

    expect(post(route, { hello: 'there' }).status).toBe(400);
    expect(post(route, { ...PAYLOAD, session_id: 'not-a-uuid' }).status).toBe(400);
  });

  it('tells a refused sender nothing about why', () => {
    const { route } = rig();

    const reply = post(route, { hello: 'there' });

    expect(JSON.stringify(reply.body)).toBe('{"error":"bad request"}');
  });

  it('logs the refusal without logging the payload', () => {
    // A payload that got this far may carry model text, and a log is not a place to put it
    // (SEC-DATA-2).
    const { route, logger } = rig();

    post(route, { ...PAYLOAD, last_assistant_message: 'secret', session_id: 'nope' });

    expect(logger.logged('hook_rejected')).toBe(true);
    expect(JSON.stringify(logger.lines)).not.toContain('secret');
  });
});

describe('HooksRoute — the rate limit (SEC-HTTP-6)', () => {
  it('answers 429 past the ingest budget', () => {
    const { route } = rig();
    for (let index = 0; index < BUDGETS.ingest.perMinute; index += 1) post(route, PAYLOAD);

    expect(post(route, PAYLOAD).status).toBe(429);
  });

  it('limits per session, so one runaway does not silence the others', () => {
    const { route } = rig();
    for (let index = 0; index < BUDGETS.ingest.perMinute + 1; index += 1) post(route, PAYLOAD);

    const other = post(route, { ...PAYLOAD, session_id: 'bbbbbbbb-0000-0000-0000-000000000000' });

    expect(other.status).toBe(200);
  });

  it('stops queueing what it refused', () => {
    const { route, queue, scheduler } = rig();
    for (let index = 0; index < BUDGETS.ingest.perMinute; index += 1) post(route, PAYLOAD);
    // Drained, so the next assertion is about the limiter rather than about the queue's own cap.
    scheduler.advance(0);
    expect(queue.depth).toBe(0);

    post(route, PAYLOAD);

    expect(queue.depth).toBe(0);
  });
});
