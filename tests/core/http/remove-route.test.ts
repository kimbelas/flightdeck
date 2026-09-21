// `POST /sessions/rm` — the door to the one verb that destroys something (P4-T2).
//
// Its own literal path, which is the control this file mostly exists to pin: `RequestRouter`
// matches method and path exactly, so nothing reaches the destructive handler by a body field
// somebody got wrong. The confirm step is the deck's (`SessionRowCard`); what the route owes is
// that it screens the ref as hard as `stop` does, because `shortId` reaches a command line here.
import { describe, expect, it } from 'vitest';
import { ClaudeInstall } from '../../../core/adapters/claude-cli/claude-install.ts';
import { AuditLog } from '../../../core/application/audit-log.ts';
import { SessionRemover } from '../../../core/application/session-remover.ts';
import { RemoveRoute } from '../../../core/http/remove-route.ts';
import { StopRoute } from '../../../core/http/stop-route.ts';
import { SessionStopper } from '../../../core/application/session-stopper.ts';
import type { RequestFacts } from '../../../core/http/loopback-guard.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeProcessRunner } from '../../fakes/fake-process-runner.ts';
import { FakeStore } from '../../fakes/fake-store.ts';

const BODY = {
  sessionId: 'fe534daf-100b-4797-a59f-ca0714840328',
  shortId: 'fe534daf',
  subscription: '365',
};
const FACTS: RequestFacts = { method: 'POST', url: '/sessions/rm', headers: {} };

function route(runner = new FakeProcessRunner(), executable = 'C:\\claude.exe'): RemoveRoute {
  return new RemoveRoute(
    new SessionRemover({
      install: new ClaudeInstall('C:\\home', executable),
      runner,
      audit: new AuditLog(new FakeStore(), new FakeClock(), new FakeLogger()),
      logger: new FakeLogger(),
    }),
  );
}

describe('RemoveRoute', () => {
  it('sits at its own literal path, distinct from stop', () => {
    // The two verbs sound alike and are not. Sharing a path with a body field choosing between
    // them would be one typo away from deleting a conversation instead of pausing it.
    const stop = new StopRoute(
      new SessionStopper({
        install: new ClaudeInstall('C:\\home', 'C:\\claude.exe'),
        runner: new FakeProcessRunner(),
        audit: new AuditLog(new FakeStore(), new FakeClock(), new FakeLogger()),
        logger: new FakeLogger(),
      }),
    );

    expect(route().path).toBe('/sessions/rm');
    expect(route().method).toBe('POST');
    expect(route().path).not.toBe(stop.path);
  });

  it('answers 200 and the full id when the session was deleted', async () => {
    const runner = new FakeProcessRunner();
    runner.willReturn({ stdout: 'removed fe534daf' });

    const reply = await route(runner).handle(FACTS, JSON.stringify(BODY));

    expect(reply).toEqual({ status: 200, body: { sessionId: BODY.sessionId } });
  });

  it.each([
    { why: 'a body that is not JSON', body: 'nope' },
    { why: 'no shortId', body: JSON.stringify({ ...BODY, shortId: undefined }) },
    { why: 'a shortId that is not eight hex', body: JSON.stringify({ ...BODY, shortId: '../..' }) },
    { why: 'an unknown subscription', body: JSON.stringify({ ...BODY, subscription: 'other' }) },
  ])('refuses $why with bad_session, without spawning', async ({ body }) => {
    const runner = new FakeProcessRunner();

    const reply = await route(runner).handle(FACTS, body);

    expect(reply).toEqual({ status: 400, body: { error: 'bad_session' } });
    expect(runner.requests).toHaveLength(0);
  });

  it('answers 503 for the operator’s problem and 400 for everything else', async () => {
    const failing = new FakeProcessRunner();
    failing.willReturn({ code: 1, stdout: '' });

    expect(
      (await route(new FakeProcessRunner(), '').handle(FACTS, JSON.stringify(BODY))).status,
    ).toBe(503);
    expect((await route(failing).handle(FACTS, JSON.stringify(BODY))).status).toBe(400);
  });

  it('asks no confirmation of its own — that belongs where the person is', async () => {
    // A route that prompted would be a route nothing could call twice. What keeps this one hard to
    // reach by accident is the distinct path, the POST, the Origin check and the bearer.
    const runner = new FakeProcessRunner();
    runner.willReturn({ stdout: 'removed fe534daf' });

    await route(runner).handle(FACTS, JSON.stringify(BODY));

    expect(runner.requests).toHaveLength(1);
  });
});
