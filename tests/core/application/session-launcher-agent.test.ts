// Starting a `--bg` session under an agent — P9-T1.
//
// The launcher's half of the roster rule: an agent is checked against the roster of the folder the
// session is about to start in, AT LAUNCH, because the preset that remembers the name was saved
// against a roster that may have lost the file since. Both refusals run nothing and leave a row.
import { describe, expect, it } from 'vitest';
import { AuditLog } from '../../../core/application/audit-log.ts';
import {
  SessionLauncher,
  type LaunchAgentRoster,
} from '../../../core/application/session-launcher.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLaunchCommands } from '../../fakes/fake-launch-commands.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeProcessRunner } from '../../fakes/fake-process-runner.ts';
import { FakeStore } from '../../fakes/fake-store.ts';

const NEW_ID = '11111111-2222-3333-4444-555555555555';
const APP_NEXT = String.raw`C:\Users\belas\Documents\development\app-next`;

/** A roster that holds whatever it was given, and remembers what it was asked (P9-T1). */
class FakeRoster implements LaunchAgentRoster {
  public readonly asked: { cwd: string; agent: string }[] = [];
  private readonly held: readonly string[];

  constructor(held: readonly string[] = []) {
    this.held = held;
  }

  public allows(cwd: string, agent: string): Promise<boolean> {
    this.asked.push({ cwd, agent });
    return Promise.resolve(this.held.includes(agent));
  }
}

interface Rig {
  readonly launcher: SessionLauncher;
  readonly store: FakeStore;
  readonly commands: FakeLaunchCommands;
}

function build(
  runner: FakeProcessRunner,
  commands = new FakeLaunchCommands(),
  roster: LaunchAgentRoster = new FakeRoster(),
): Rig {
  const store = new FakeStore();
  const audit = new AuditLog(store, new FakeClock(), new FakeLogger());
  const launcher = new SessionLauncher({
    commands,
    roster,
    runner,
    audit,
    logger: new FakeLogger(),
  });
  return { launcher, store, commands };
}

describe('SessionLauncher — an agent (P9-T1)', () => {
  const request = {
    profileFn: 'claude-365',
    prompt: 'review the diff',
    name: 'review',
    cwd: APP_NEXT,
    agent: 'code-reviewer',
  } as const;

  it('passes a roster agent to the port, and checks the folder it will start in', async () => {
    const runner = new FakeProcessRunner();
    runner.willReturn({
      stdout: `Started background session ${NEW_ID}
`,
    });
    const roster = new FakeRoster(['code-reviewer']);
    const { launcher: subject, commands } = build(runner, new FakeLaunchCommands(), roster);

    expect(await subject.launch(request)).toEqual({ ok: true, value: NEW_ID });
    expect(roster.asked).toEqual([{ cwd: APP_NEXT, agent: 'code-reviewer' }]);
    expect(commands.asked[0]?.text.agent).toBe('code-reviewer');
  });

  it('puts the agent in the audit row, and still never the prompt or the name', async () => {
    const runner = new FakeProcessRunner();
    runner.willReturn({
      stdout: `Started background session ${NEW_ID}
`,
    });
    const { launcher: subject, store } = build(
      runner,
      new FakeLaunchCommands(),
      new FakeRoster(['code-reviewer']),
    );

    await subject.launch(request);

    expect(store.allAudit[0]?.args).toEqual(['claude-365', '--bg', '--agent', 'code-reviewer']);
  });

  it('refuses an agent the roster no longer holds, and runs nothing', async () => {
    // The roster file was deleted between the save and the press: a refusal, not an agent Claude
    // Code will not find.
    const runner = new FakeProcessRunner();
    const { launcher: subject, store, commands } = build(runner);

    expect(await subject.launch(request)).toEqual({ ok: false, error: 'unknown_agent' });
    expect(runner.requests).toHaveLength(0);
    expect(commands.asked).toHaveLength(0);
    expect(store.allAudit[0]?.outcome).toBe('refused');
  });

  it('refuses an agent with no folder, because there is no roster to find it on', async () => {
    const runner = new FakeProcessRunner();
    const roster = new FakeRoster(['code-reviewer']);
    const { launcher: subject } = build(runner, new FakeLaunchCommands(), roster);

    expect(await subject.launch({ ...request, cwd: undefined })).toEqual({
      ok: false,
      error: 'unknown_agent',
    });
    expect(roster.asked).toHaveLength(0);
  });

  it('refuses an agent on the function that pins one, before asking the roster', async () => {
    const runner = new FakeProcessRunner();
    const roster = new FakeRoster(['code-reviewer']);
    const { launcher: subject } = build(runner, new FakeLaunchCommands(), roster);

    const launched = await subject.launch({ ...request, profileFn: 'claude-isg-orch' });

    expect(launched).toEqual({ ok: false, error: 'pins_agent' });
    expect(roster.asked).toHaveLength(0);
    expect(runner.requests).toHaveLength(0);
  });

  it('asks the roster nothing when there is no agent', async () => {
    const runner = new FakeProcessRunner();
    runner.willReturn({
      stdout: `Started background session ${NEW_ID}
`,
    });
    const roster = new FakeRoster();
    const { launcher: subject } = build(runner, new FakeLaunchCommands(), roster);

    await subject.launch({ ...request, agent: undefined });

    expect(roster.asked).toHaveLength(0);
  });
});
