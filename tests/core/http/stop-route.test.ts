// `POST /sessions/stop` — the door, and the ref it insists on (P4-T2b).
import { describe, expect, it } from 'vitest';
import { ClaudeInstall } from '../../../core/adapters/claude-cli/claude-install.ts';
import { AuditLog } from '../../../core/application/audit-log.ts';
import { SessionStopper } from '../../../core/application/session-stopper.ts';
import type { SessionPopper } from '../../../core/application/session-popper.ts';
import { PopoutRoute } from '../../../core/http/popout-route.ts';
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

describe('PopoutRoute — handing a session to Windows Terminal (P6-T2)', () => {
  const REF = {
    sessionId: '337975f9-c9c0-454a-a22a-2d53a86e0ea9',
    shortId: '337975f9',
    subscription: '365',
  };

  function route(
    answer: Awaited<ReturnType<SessionPopper['popOut']>> = { ok: true, value: true },
  ): { route: PopoutRoute; seen: Parameters<SessionPopper['popOut']>[0][] } {
    const seen: Parameters<SessionPopper['popOut']>[0][] = [];
    const popper = {
      popOut: (request: Parameters<SessionPopper['popOut']>[0]) => {
        seen.push(request);
        return Promise.resolve(answer);
      },
    } as unknown as SessionPopper;
    return { route: new PopoutRoute(popper), seen };
  }

  it('is a POST on its own literal path, like every other session verb', () => {
    const { route: made } = route();

    expect([made.method, made.path, made.limit, made.credential]).toEqual([
      'POST',
      '/sessions/popout',
      'control',
      'token',
    ]);
  });

  it('answers 200 and says whether a pane was detached', async () => {
    const { route: made } = route();

    expect(await made.handle(FACTS, JSON.stringify({ ...REF, title: 'a', cwd: 'C:\r' }))).toEqual({
      status: 200,
      body: { detached: true },
    });
  });

  it('carries the title and the folder through, because core cannot look them up', async () => {
    const { route: made, seen } = route();

    await made.handle(FACTS, JSON.stringify({ ...REF, title: 'alpha', cwd: 'C:\repo' }));

    expect(seen[0]).toMatchObject({ title: 'alpha', cwd: 'C:\repo' });
  });

  // A tab with no name is worse than one named after the session, which is what core has.
  it('falls back to the short id when the body carries no title', async () => {
    const { route: made, seen } = route();

    await made.handle(FACTS, JSON.stringify(REF));

    expect(seen[0]).toMatchObject({ title: '337975f9', cwd: undefined });
  });

  it.each([
    { body: '{', why: 'a body that is not JSON' },
    { body: JSON.stringify({ subscription: '365' }), why: 'no session' },
    { body: JSON.stringify({ ...REF, sessionId: 'nope' }), why: 'an id that is not a uuid' },
  ])('answers 400 for $why', async ({ body }) => {
    expect(await route().route.handle(FACTS, body)).toMatchObject({ status: 400 });
  });

  // 503 rather than 400: the request was fine, the machine has nothing to pop out into.
  it('answers 503 when there is no terminal here', async () => {
    const { route: made } = route({ ok: false, error: 'no_terminal' });

    expect(await made.handle(FACTS, JSON.stringify(REF))).toEqual({
      status: 503,
      body: { error: 'no_terminal' },
    });
  });

  it('answers 400 when the spawn itself failed', async () => {
    const { route: made } = route({ ok: false, error: 'popout_failed' });

    expect(await made.handle(FACTS, JSON.stringify(REF))).toMatchObject({ status: 400 });
  });
});
