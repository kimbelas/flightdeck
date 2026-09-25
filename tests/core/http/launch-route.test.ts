// `POST /sessions` — the agent field (P9-T1).
//
// The route is the SHAPE check and the launcher is the roster check, so what is settled here is
// what reaches the launcher: an absent agent is none, an agent-shaped one is passed through, and a
// present value that is not a name is a 400 before anything runs — never a launch with the agent
// quietly dropped.
import { describe, expect, it } from 'vitest';
import { AuditLog } from '../../../core/application/audit-log.ts';
import { SessionLauncher } from '../../../core/application/session-launcher.ts';
import { LaunchRoute } from '../../../core/http/launch-route.ts';
import type { RequestFacts } from '../../../core/http/loopback-guard.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLaunchCommands } from '../../fakes/fake-launch-commands.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeProcessRunner } from '../../fakes/fake-process-runner.ts';
import { FakeStore } from '../../fakes/fake-store.ts';

const FACTS: RequestFacts = { method: 'POST', url: '/sessions', headers: {} };
const APP_NEXT = String.raw`C:\Users\belas\Documents\development\app-next`;
const NEW_ID = '11111111-2222-3333-4444-555555555555';

interface Rig {
  readonly route: LaunchRoute;
  readonly commands: FakeLaunchCommands;
  readonly runner: FakeProcessRunner;
}

function build(): Rig {
  const store = new FakeStore();
  const runner = new FakeProcessRunner();
  runner.willReturn({ stdout: `Started background session ${NEW_ID}\n` });
  const commands = new FakeLaunchCommands();
  const launcher = new SessionLauncher({
    commands,
    roster: {
      allows: (cwd, agent) => Promise.resolve(cwd === APP_NEXT && agent === 'code-reviewer'),
    },
    runner,
    audit: new AuditLog(store, new FakeClock(), new FakeLogger()),
    logger: new FakeLogger(),
  });
  return { route: new LaunchRoute(launcher), commands, runner };
}

function body(over: Readonly<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    profileFn: 'claude-365',
    prompt: 'go',
    name: 'review',
    cwd: APP_NEXT,
    ...over,
  });
}

describe('LaunchRoute — agent (P9-T1)', () => {
  it('launches with no agent when the field is absent', async () => {
    const { route, commands } = build();

    expect((await route.handle(FACTS, body())).status).toBe(201);
    expect(commands.asked[0]?.text.agent).toBeUndefined();
  });

  it.each([null, ''])('reads %j as no agent', async (agent) => {
    const { route, commands } = build();

    expect((await route.handle(FACTS, body({ agent }))).status).toBe(201);
    expect(commands.asked[0]?.text.agent).toBeUndefined();
  });

  it('passes a roster agent to the launcher', async () => {
    const { route, commands } = build();

    expect((await route.handle(FACTS, body({ agent: 'code-reviewer' }))).status).toBe(201);
    expect(commands.asked[0]?.text.agent).toBe('code-reviewer');
  });

  it.each(['Code Reviewer', 'a; calc.exe', 'x'.repeat(65), 7])(
    'refuses %j as a bad request and runs nothing',
    async (agent) => {
      const { route, runner } = build();

      const reply = await route.handle(FACTS, body({ agent }));

      expect(reply.status).toBe(400);
      expect(runner.requests).toHaveLength(0);
    },
  );

  it('answers unknown_agent for a well-shaped name the roster does not hold', async () => {
    const { route } = build();

    const reply = await route.handle(FACTS, body({ agent: 'ghost' }));

    expect(reply).toEqual({ status: 400, body: { error: 'unknown_agent' } });
  });

  it('answers pins_agent for an agent on claude-isg-orch', async () => {
    const { route } = build();

    const reply = await route.handle(
      FACTS,
      body({ profileFn: 'claude-isg-orch', agent: 'code-reviewer' }),
    );

    expect(reply).toEqual({ status: 400, body: { error: 'pins_agent' } });
  });
});
