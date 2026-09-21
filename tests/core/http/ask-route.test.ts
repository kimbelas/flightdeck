// `POST /run` — the door to a headless question (P4-T4, D48).
//
// The property this file pins is that the route ANSWERS rather than waits. An Ask is minutes long
// and its records arrive on `/stream`; a route that resolved when the run finished would hold a
// request open for the length of the answer and give the deck a second live feed to manage, which
// is what P1-T9 and P2-T3 both decided against.
//
// The refusal codes are the other half. `busy` is 409 and not 400, because the request was fine
// and the state was not — a deck told 400 would ask the owner to fix a prompt that is correct.
import { describe, expect, it } from 'vitest';
import { AskBroadcast } from '../../../core/application/ask-broadcast.ts';
import { AskRunner } from '../../../core/application/ask-runner.ts';
import { AuditLog } from '../../../core/application/audit-log.ts';
import { ClaudeInstall } from '../../../core/adapters/claude-cli/claude-install.ts';
import { DirectAskCommands } from '../../../core/adapters/claude-cli/direct-ask-commands.ts';
import { AskRoute } from '../../../core/http/ask-route.ts';
import { ASK_MAX_BUDGET_USD } from '../../../contracts/ask-run.ts';
import type { RequestFacts } from '../../../core/http/loopback-guard.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeProcessStream } from '../../fakes/fake-process-stream.ts';
import { FakeStore } from '../../fakes/fake-store.ts';

const FACTS: RequestFacts = { method: 'POST', url: '/run', headers: {} };

interface Harness {
  readonly route: AskRoute;
  readonly stream: FakeProcessStream;
}

function harness(executable = 'C:\\bin\\claude.exe'): Harness {
  const stream = new FakeProcessStream();
  const runner = new AskRunner({
    commands: new DirectAskCommands(new ClaudeInstall('C:\\Users\\ada', executable), {}),
    stream,
    publisher: new AskBroadcast(),
    audit: new AuditLog(new FakeStore(), new FakeClock(), new FakeLogger()),
    clock: new FakeClock(),
    logger: new FakeLogger(),
  });
  return { route: new AskRoute(runner), stream };
}

function body(fields: Record<string, unknown> = {}): string {
  return JSON.stringify({ subscription: '365', prompt: 'what changed today', ...fields });
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('AskRoute', () => {
  it('sits at its own literal path, behind the token', () => {
    const { route } = harness();

    expect(route.method).toBe('POST');
    expect(route.path).toBe('/run');
    expect(route.credential).toBe('token');
  });

  it('answers 202 and a run id — accepted, not finished', async () => {
    const { route, stream } = harness();
    stream.holdOpen();

    const reply = await route.handle(FACTS, body());

    expect(reply.status).toBe(202);
    expect(JSON.stringify(reply.body)).toContain('runId');
    stream.finish();
    await settle();
  });

  it('answers 409 for a second run while one is in flight', async () => {
    // Not 400: the body was fine and the state was not.
    const { route, stream } = harness();
    stream.holdOpen();
    await route.handle(FACTS, body());

    const second = await route.handle(FACTS, body());

    expect(second.status).toBe(409);
    expect(second.body).toEqual({ error: 'busy' });
    stream.finish();
    await settle();
  });

  it('answers 400 for a body that is not a request', async () => {
    const { route } = harness();

    expect((await route.handle(FACTS, 'not json')).status).toBe(400);
    expect((await route.handle(FACTS, JSON.stringify({ prompt: 'x' }))).status).toBe(400);
    expect((await route.handle(FACTS, body({ prompt: '' }))).status).toBe(400);
  });

  it('answers 400 and names the budget when the cap was exceeded', async () => {
    // A distinct refusal so the panel can say "that is over the ceiling" rather than "bad request".
    const { route, stream } = harness();

    const reply = await route.handle(FACTS, body({ budgetUsd: ASK_MAX_BUDGET_USD + 10 }));

    expect(reply.status).toBe(400);
    expect(reply.body).toEqual({ error: 'bad_budget' });
    expect(stream.asked).toHaveLength(0);
  });

  it('answers 503 when there is no binary — core’s problem, not the caller’s', async () => {
    const { route } = harness('');

    const reply = await route.handle(FACTS, body());

    expect(reply.status).toBe(503);
    expect(reply.body).toEqual({ error: 'no_claude' });
  });

  it('never lets a body choose bypassPermissions', async () => {
    // SEC-PROC-4 through the whole stack: the mode is dropped at the parse, so what reaches the
    // argv is the default. The adapter test asserts the flag's absence; this asserts the door.
    const { route, stream } = harness();
    stream.holdOpen();

    await route.handle(FACTS, body({ permissionMode: 'bypassPermissions' }));

    const args = stream.asked[0]?.args.join(' ') ?? '';
    expect(args).not.toContain('dangerously');
    expect(args).toContain('--permission-mode plan');
    stream.finish();
    await settle();
  });
});
