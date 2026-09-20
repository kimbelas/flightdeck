// `POST /sessions/resume` — the door, and what it refuses before anything runs (P4-T2a).
//
// The route is thin on purpose, so what is worth asserting is the shape of the body it accepts and
// the status it puts each refusal under. The id rule itself belongs to `SessionResumer` and is
// tested there: it is the argv's rule, not the door's, because a short id does not fail at the CLI
// — it forks a copy of the session (RESEARCH.md F.2.7).
import { describe, expect, it } from 'vitest';
import { ClaudeInstall } from '../../../core/adapters/claude-cli/claude-install.ts';
import { AuditLog } from '../../../core/application/audit-log.ts';
import { SessionResumer } from '../../../core/application/session-resumer.ts';
import { ResumeRoute } from '../../../core/http/resume-route.ts';
import type { RequestFacts } from '../../../core/http/loopback-guard.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeProcessRunner } from '../../fakes/fake-process-runner.ts';
import { FakeStore } from '../../fakes/fake-store.ts';

const ID = 'cfe7facb-a785-42e4-b1b3-600138ad1c70';
const FACTS: RequestFacts = { method: 'POST', url: '/sessions/resume', headers: {} };

function route(runner = new FakeProcessRunner(), executable = 'C:\\claude.exe'): ResumeRoute {
  return new ResumeRoute(
    new SessionResumer({
      install: new ClaudeInstall('C:\\home', executable),
      runner,
      audit: new AuditLog(new FakeStore(), new FakeClock(), new FakeLogger()),
      logger: new FakeLogger(),
    }),
  );
}

describe('ResumeRoute', () => {
  it('is registered at its own literal path, not as a verb on /sessions', () => {
    // `RequestRouter` matches method and path literally, which is the control routes.ts describes.
    expect(route().method).toBe('POST');
    expect(route().path).toBe('/sessions/resume');
  });

  it('answers 200 and the same id when the session woke', async () => {
    const reply = await route().handle(
      FACTS,
      JSON.stringify({ subscription: '365', sessionId: ID }),
    );

    // 200, not 201: nothing was created — the session already existed and is now awake.
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ sessionId: ID });
  });

  it('answers 400 bad_session for a body that is not JSON', async () => {
    const reply = await route().handle(FACTS, 'not json');

    expect(reply.status).toBe(400);
    expect(reply.body).toEqual({ error: 'bad_session' });
  });

  it.each([
    { why: 'no subscription', body: { sessionId: ID } },
    { why: 'an unknown subscription', body: { subscription: 'other', sessionId: ID } },
    { why: 'no session id', body: { subscription: '365' } },
    { why: 'a session id that is not a string', body: { subscription: '365', sessionId: 7 } },
  ])('answers 400 for $why', async ({ body }) => {
    const reply = await route().handle(FACTS, JSON.stringify(body));

    expect(reply.status).toBe(400);
    expect(reply.body).toEqual({ error: 'bad_session' });
  });

  it('answers 400 bad_session for a short id, which never reaches the CLI', async () => {
    const runner = new FakeProcessRunner();
    const reply = await route(runner).handle(
      FACTS,
      JSON.stringify({ subscription: '365', sessionId: 'cfe7facb' }),
    );

    expect(reply.status).toBe(400);
    expect(reply.body).toEqual({ error: 'bad_session' });
    expect(runner.requests).toEqual([]);
  });

  it('answers 503 for no_claude, because that one is the operators to fix', async () => {
    const reply = await route(new FakeProcessRunner(), '').handle(
      FACTS,
      JSON.stringify({ subscription: '365', sessionId: ID }),
    );

    expect(reply.status).toBe(503);
    expect(reply.body).toEqual({ error: 'no_claude' });
  });

  it('answers 400 resume_failed when the CLI refused', async () => {
    const runner = new FakeProcessRunner();
    runner.willReturn({ code: 1, stdout: 'No job matching\n' });

    const reply = await route(runner).handle(
      FACTS,
      JSON.stringify({ subscription: '365', sessionId: ID }),
    );

    expect(reply.status).toBe(400);
    expect(reply.body).toEqual({ error: 'resume_failed' });
  });
});
