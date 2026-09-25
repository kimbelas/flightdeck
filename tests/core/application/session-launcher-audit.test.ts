// Every launch leaves exactly one audit row — SEC-PROC-3.
//
// Split from `session-launcher.test.ts` at its size limit when P9-T1 added the agent field; the
// rows here are the ones a reviewer looks for, refusals included, and none of them ever holds the
// prompt or the name (SEC-DATA-2).
import { describe, expect, it } from 'vitest';
import { AuditLog } from '../../../core/application/audit-log.ts';
import { SessionLauncher } from '../../../core/application/session-launcher.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLaunchCommands } from '../../fakes/fake-launch-commands.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeProcessRunner } from '../../fakes/fake-process-runner.ts';
import { FakeStore } from '../../fakes/fake-store.ts';

const NEW_ID = '11111111-2222-3333-4444-555555555555';

interface Rig {
  readonly launcher: SessionLauncher;
  readonly store: FakeStore;
  readonly commands: FakeLaunchCommands;
}

/** The store comes back too, because SEC-PROC-3's row is part of what a launch is (P1-T8). */
function build(runner: FakeProcessRunner, commands = new FakeLaunchCommands()): Rig {
  const store = new FakeStore();
  const audit = new AuditLog(store, new FakeClock(), new FakeLogger());
  const launcher = new SessionLauncher({
    commands,
    // No agent in any case in this file — `session-launcher-agent.test.ts` has those (P9-T1).
    roster: { allows: () => Promise.resolve(false) },
    runner,
    audit,
    logger: new FakeLogger(),
  });
  return { launcher, store, commands };
}

describe('SessionLauncher — the audit row (SEC-PROC-3)', () => {
  it('writes one ok row naming the new session', async () => {
    const runner = new FakeProcessRunner();
    runner.willReturn({ stdout: `Started background session ${NEW_ID}\n` });
    const { launcher: subject, store } = build(runner);

    await subject.launch({
      profileFn: 'claude-365',
      prompt: 'do a thing',
      name: 'r',
      cwd: undefined,
      agent: undefined,
    });

    const [row] = store.allAudit;
    expect(store.allAudit).toHaveLength(1);
    expect(row?.action).toBe('launch');
    expect(row?.outcome).toBe('ok');
    expect(row?.target).toBe(NEW_ID);
    // The function is the routing, so it is the fact worth keeping (D44).
    expect(row?.args).toEqual(['claude-365', '--bg']);
  });

  it('writes a refused row when there is no shell, before running anything', async () => {
    const runner = new FakeProcessRunner();
    const commands = new FakeLaunchCommands();
    commands.breakShell();
    const { launcher: subject, store } = build(runner, commands);

    await subject.launch({
      profileFn: 'claude-isg',
      prompt: 'do a thing',
      name: 'x',
      cwd: undefined,
      agent: undefined,
    });

    // The refusals are the rows a reviewer actually looks for, so they cannot be the ones that
    // return early without writing.
    expect(store.auditFailures()).toHaveLength(1);
    expect(store.allAudit[0]?.outcome).toBe('refused');
    // The subscription is DERIVED from the function, never carried beside it (D44).
    expect(store.allAudit[0]?.target).toBe('isg');
  });

  it('writes a refused row for a prompt that is out of range', async () => {
    const runner = new FakeProcessRunner();
    const { launcher: subject, store } = build(runner);

    await subject.launch({
      profileFn: 'claude-365',
      prompt: '   ',
      name: 'x',
      cwd: undefined,
      agent: undefined,
    });

    expect(store.allAudit[0]?.outcome).toBe('refused');
    expect(store.allAudit[0]?.reason).toBeTypeOf('string');
  });

  it('writes a failed row carrying why, when the CLI does not exit 0', async () => {
    const runner = new FakeProcessRunner();
    runner.willReturn({ stdout: '', code: 1 });
    const { launcher: subject, store } = build(runner);

    await subject.launch({
      profileFn: 'claude-365',
      prompt: 'do a thing',
      name: 'x',
      cwd: undefined,
      agent: undefined,
    });

    expect(store.allAudit[0]?.outcome).toBe('failed');
    expect(store.allAudit[0]?.reason).toContain('exit 1');
  });

  it('never puts the prompt or the name in the row, kept forever and shown in the UI', async () => {
    const runner = new FakeProcessRunner();
    runner.willReturn({ stdout: `Started background session ${NEW_ID}\n` });
    const { launcher: subject, store } = build(runner);

    await subject.launch({
      profileFn: 'claude-365',
      prompt: 'something the owner typed',
      name: 'a private name',
      cwd: undefined,
      agent: undefined,
    });

    // SEC-DATA-2: `args` is the argv as it was run, and the one place that rule bends is the
    // fields carrying the owner's words — which, since P4-T2, are not in the argv at all.
    expect(JSON.stringify(store.allAudit)).not.toContain('something the owner typed');
    expect(JSON.stringify(store.allAudit)).not.toContain('a private name');
  });
});
