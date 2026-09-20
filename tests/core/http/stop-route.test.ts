// `POST /sessions/stop` — the door, and the ref it insists on (P4-T2b).
import { describe, expect, it } from 'vitest';
import { ClaudeInstall } from '../../../core/adapters/claude-cli/claude-install.ts';
import { AuditLog } from '../../../core/application/audit-log.ts';
import { SessionStopper } from '../../../core/application/session-stopper.ts';
import { StopRoute } from '../../../core/http/stop-route.ts';
import type { RequestFacts } from '../../../core/http/loopback-guard.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeProcessRunner } from '../../fakes/fake-process-runner.ts';
import { FakeStore } from '../../fakes/fake-store.ts';

const BODY = {
  sessionId: 'cfe7facb-a785-4b2d-4b1b-600138ad1c70',
  shortId: 'cfe7facb',
  subscription: '365',
};
const FACTS: RequestFacts = { method: 'POST', url: '/sessions/stop', headers: {} };

function route(runner = new FakeProcessRunner(), executable = 'C:\\claude.exe'): StopRoute {
  return new StopRoute(
    new SessionStopper({
      install: new ClaudeInstall('C:\\home', executable),
      runner,
      audit: new AuditLog(new FakeStore(), new FakeClock(), new FakeLogger()),
      logger: new FakeLogger(),
    }),
  );
}

describe('StopRoute', () => {
  it('sits at its own literal path beside the other two session verbs', () => {
    expect(route().path).toBe('/sessions/stop');
    expect(route().method).toBe('POST');
  });

  it('answers 200 and the full id when the session stopped', async () => {
    const reply = await route().handle(FACTS, JSON.stringify(BODY));

    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ sessionId: BODY.sessionId });
  });

  it.each([
    { why: 'a body that is not JSON', body: 'nope' },
    { why: 'no shortId', body: JSON.stringify({ ...BODY, shortId: undefined }) },
    { why: 'a shortId that is not eight hex', body: JSON.stringify({ ...BODY, shortId: '../..' }) },
    {
      why: 'a shortId with upper case in it',
      body: JSON.stringify({ ...BODY, shortId: 'CFE7FACB' }),
    },
    { why: 'no sessionId', body: JSON.stringify({ ...BODY, sessionId: undefined }) },
    { why: 'an unknown subscription', body: JSON.stringify({ ...BODY, subscription: 'other' }) },
  ])('answers 400 bad_session for $why, without running anything', async ({ body }) => {
    const runner = new FakeProcessRunner();

    const reply = await route(runner).handle(FACTS, body);

    expect(reply.status).toBe(400);
    expect(reply.body).toEqual({ error: 'bad_session' });
    expect(runner.requests).toEqual([]);
  });

  it('answers 503 for no_claude, which is the operators to fix', async () => {
    const reply = await route(new FakeProcessRunner(), '').handle(FACTS, JSON.stringify(BODY));

    expect(reply.status).toBe(503);
    expect(reply.body).toEqual({ error: 'no_claude' });
  });

  it('answers 400 stop_failed when the CLI refused', async () => {
    const runner = new FakeProcessRunner();
    runner.willReturn({ code: 1 });

    const reply = await route(runner).handle(FACTS, JSON.stringify(BODY));

    expect(reply.status).toBe(400);
    expect(reply.body).toEqual({ error: 'stop_failed' });
  });
});
