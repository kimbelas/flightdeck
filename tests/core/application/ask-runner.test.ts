// `AskRunner` — one question at a time, relayed while it runs (P4-T4).
//
// Three properties, and each is a decision rather than a mechanism:
//
//  - **one run at a time**, because a queue would let the owner press Ask four times, walk away,
//    and come back to four runs' worth of spend they can no longer decline;
//  - **the budget is refused, not clamped**, because clamping runs something nobody asked for;
//  - **a `done` always goes out**, because a child killed on the timeout emits no `result` of its
//    own and a panel waiting for one would spin for ever.
import { describe, expect, it } from 'vitest';
import { AskBroadcast } from '../../../core/application/ask-broadcast.ts';
import { AskRunner } from '../../../core/application/ask-runner.ts';
import { AuditLog } from '../../../core/application/audit-log.ts';
import { ClaudeInstall } from '../../../core/adapters/claude-cli/claude-install.ts';
import { DirectAskCommands } from '../../../core/adapters/claude-cli/direct-ask-commands.ts';
import {
  ASK_DEFAULT_MAX_TURNS,
  ASK_MAX_BUDGET_USD,
  type AskRequest,
} from '../../../contracts/ask-run.ts';
import type { AskFrame } from '../../../contracts/ask-record.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeProcessStream } from '../../fakes/fake-process-stream.ts';
import { FakeStore } from '../../fakes/fake-store.ts';

const INIT = JSON.stringify({
  type: 'system',
  subtype: 'init',
  session_id: '7877f4f3-b48e-4db9-8baf-c8aa97428e7c',
  model: 'claude-opus-5',
  permissionMode: 'plan',
});
const RESULT = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  total_cost_usd: 0.0135,
  stop_reason: 'end_turn',
});

interface Harness {
  readonly runner: AskRunner;
  readonly stream: FakeProcessStream;
  readonly frames: AskFrame[];
  readonly store: FakeStore;
}

function harness(executable = 'C:\\bin\\claude.exe'): Harness {
  const stream = new FakeProcessStream();
  const broadcast = new AskBroadcast();
  const frames: AskFrame[] = [];
  broadcast.subscribe((frame) => frames.push(frame));
  const clock = new FakeClock();
  const store = new FakeStore();
  const logger = new FakeLogger();
  const runner = new AskRunner({
    commands: new DirectAskCommands(new ClaudeInstall('C:\\Users\\ada', executable), {}),
    stream,
    publisher: broadcast,
    audit: new AuditLog(store, clock, logger),
    clock,
    logger,
  });
  return { runner, stream, frames, store };
}

function request(overrides: Partial<AskRequest> = {}): AskRequest {
  return {
    subscription: '365',
    prompt: 'what changed today',
    cwd: '',
    permissionMode: 'plan',
    budgetUsd: 2,
    maxTurns: ASK_DEFAULT_MAX_TURNS,
    ...overrides,
  };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('AskRunner — accepting a run', () => {
  it('answers a run id as soon as the child is spawned, not when it finishes', async () => {
    const { runner, stream } = harness();
    stream.willEmit([INIT, RESULT]);

    const started = runner.start(request());

    expect(started.ok).toBe(true);
    expect(started.ok ? started.value : '').toMatch(/^ask-/);
    await settle();
  });

  it('relays each line as a narrowed record, in order', async () => {
    const { runner, stream, frames } = harness();
    stream.willEmit([INIT, RESULT]);

    runner.start(request());
    await settle();

    expect(frames.map((frame) => frame.record.kind)).toEqual(['started', 'done', 'done']);
    expect(frames[0]?.subscription).toBe('365');
  });

  it('drops a line it cannot read rather than failing the run', async () => {
    const { runner, stream, frames } = harness();
    stream.willEmit(['not json at all', '{"type":"system","subtype":"status"}', INIT, RESULT]);

    runner.start(request());
    await settle();

    expect(frames.map((frame) => frame.record.kind)).toEqual(['started', 'done', 'done']);
  });
});

describe('AskRunner — the single slot', () => {
  it('refuses a second run while one is in flight, and says busy', async () => {
    // Not a queue. See the header: a queue turns four impatient presses into four runs' worth of
    // spend nobody can now decline.
    const { runner, stream } = harness();
    stream.willEmit([INIT]);
    stream.holdOpen();

    runner.start(request());
    await settle();
    const second = runner.start(request());

    expect(second.ok).toBe(false);
    expect(second.ok ? '' : second.error).toBe('busy');
    expect(runner.inFlight).toBeDefined();
    stream.finish();
    await settle();
  });

  it('frees the slot once the run ends, including when it failed', async () => {
    const { runner, stream } = harness();
    stream.willEmit([]);
    stream.willEndWith({ code: 1, timedOut: false, stderr: 'boom' });

    runner.start(request());
    await settle();

    expect(runner.inFlight).toBeUndefined();
    expect(runner.start(request()).ok).toBe(true);
    await settle();
  });
});

describe('AskRunner — refusing before it spends anything', () => {
  it('refuses a budget over the ceiling rather than clamping it', () => {
    // A clamp would run something the owner did not ask for. SEC-PROC-4's cap is a control only if
    // it is a refusal.
    const { runner, stream } = harness();

    const over = runner.start(request({ budgetUsd: ASK_MAX_BUDGET_USD + 1 }));

    expect(over.ok ? '' : over.error).toBe('bad_budget');
    expect(stream.asked).toHaveLength(0);
  });

  it('refuses a budget of zero or less, and a turn cap that is not a positive integer', () => {
    const { runner, stream } = harness();

    expect(runner.start(request({ budgetUsd: 0 })).ok).toBe(false);
    expect(runner.start(request({ maxTurns: 0 })).ok).toBe(false);
    expect(runner.start(request({ maxTurns: 1.5 })).ok).toBe(false);
    expect(stream.asked).toHaveLength(0);
  });

  it('refuses when there is no binary, and spawns nothing', () => {
    const { runner, stream } = harness('');

    const refused = runner.start(request());

    expect(refused.ok ? '' : refused.error).toBe('no_claude');
    expect(stream.asked).toHaveLength(0);
  });
});

describe('AskRunner — the closing frame and the audit trail', () => {
  it('publishes a done of its own even when the child emitted no result', async () => {
    // A child killed on the timeout prints no `result`. Without this the panel spins for ever.
    const { runner, stream, frames } = harness();
    stream.willEmit([INIT]);
    stream.willEndWith({ code: -1, timedOut: true, stderr: '' });

    runner.start(request());
    await settle();

    const last = frames.at(-1)?.record;
    expect(last?.kind).toBe('done');
    expect(last?.kind === 'done' ? last.ok : true).toBe(false);
    expect(last?.kind === 'done' ? last.stopReason : '').toBe('timed out');
  });

  it('never publishes the child’s stderr — SEC-DATA-2', () => {
    // stderr can carry a path. It is logged; what crosses the wire is a word.
    const { runner, stream, frames } = harness();
    stream.willEmit([]);
    stream.willEndWith({ code: 1, timedOut: false, stderr: 'C:\\Users\\ada\\secret\\thing.md' });

    runner.start(request());

    return settle().then(() => {
      expect(JSON.stringify(frames)).not.toContain('secret');
      expect(JSON.stringify(frames)).not.toContain('C:\\\\Users');
    });
  });

  it('writes a row when the run starts and another when it ends', async () => {
    // Unlike `rm`, an Ask spends money over minutes, so a row written only at the end would leave
    // a crash mid-run unrecorded — the case somebody would actually want the trail for.
    const { runner, stream, store } = harness();
    stream.willEmit([INIT, RESULT]);

    runner.start(request());
    await settle();

    const rows = store.allAudit.filter((row) => row.action === 'ask');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.outcome).toBe('ok');
    expect(rows.at(-1)?.args).toContain('end');
  });

  it('keeps the prompt out of the audit row', () => {
    // The row is read by eye and the prompt is the owner's text. What the trail needs is that a
    // run happened and what it was allowed to do.
    const { runner, stream, store } = harness();
    stream.willEmit([]);

    runner.start(request({ prompt: 'a very memorable and private question' }));

    expect(JSON.stringify(store.allAudit)).not.toContain('memorable');
    expect(store.allAudit[0]?.args).toContain('plan');
  });
});
