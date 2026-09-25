// Starting a `--bg` session — the only path to a pane that can be typed into.
//
// **P4-T2 moved the argv out of this class**, and the assertions moved with it. What the launcher
// decides is whether to run at all, what a name means, and what an answer means; what the argv
// looks like is `PowerShellLaunchCommands`' and is asserted there and in `tests/win`. What stays
// here is the SEC-PROC-1 assertion that matters at this layer: **the prompt and the name reach the
// port and never the argument list**.
import { describe, expect, it } from 'vitest';
import { AuditLog } from '../../../core/application/audit-log.ts';
import { SessionLauncher } from '../../../core/application/session-launcher.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLaunchCommands } from '../../fakes/fake-launch-commands.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeProcessRunner } from '../../fakes/fake-process-runner.ts';
import { FakeStore } from '../../fakes/fake-store.ts';

const NEW_ID = '11111111-2222-3333-4444-555555555555';
/** `String.raw`, or the backslashes are dropped and the case asserts a mangled path (G.38). */
const APP_NEXT = String.raw`C:\Users\belas\Documents\development\app-next`;

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

function launcher(runner: FakeProcessRunner): SessionLauncher {
  return build(runner).launcher;
}

describe('SessionLauncher', () => {
  it('returns the session id the CLI printed', async () => {
    const runner = new FakeProcessRunner();
    runner.willReturn({ stdout: `Started background session ${NEW_ID}\n` });

    const launched = await launcher(runner).launch({
      profileFn: 'claude-365',
      prompt: 'summarise the repo',
      name: 'reader',
      cwd: undefined,
      agent: undefined,
    });

    expect(launched).toEqual({ ok: true, value: NEW_ID });
  });

  it('reads the short id `--bg` actually prints through the profile route (F.8.1)', async () => {
    // `backgrounded · 17d31085 · fd-t2-probe` plus four help lines that repeat the id. The FIRST
    // match is the right one, and that is what this pins.
    const runner = new FakeProcessRunner();
    runner.willReturn({
      stdout: [
        'backgrounded \u00b7 17d31085 \u00b7 fd-t2-probe',
        '  claude attach 17d31085    open in this terminal',
      ].join('\n'),
    });

    const launched = await launcher(runner).launch({
      profileFn: 'claude-365',
      prompt: 'go',
      name: 'x',
      cwd: undefined,
      agent: undefined,
    });

    expect(launched).toEqual({ ok: true, value: '17d31085' });
  });

  it('sends the prompt and the name to the port, and neither into the argument list', async () => {
    const runner = new FakeProcessRunner();
    runner.willReturn({ stdout: NEW_ID });
    const hostile = 'do the thing" & calc.exe & echo "';
    const { launcher: subject, commands } = build(runner);

    await subject.launch({
      profileFn: 'claude-365',
      prompt: hostile,
      name: 'my session',
      cwd: undefined,
      agent: undefined,
    });

    // SEC-PROC-1 at this layer: user text goes to the thing that puts it in the environment, and
    // the argv the runner is handed has neither the prompt nor the name anywhere in it.
    expect(commands.asked[0]?.text).toEqual({ name: 'my session', prompt: hostile });
    expect(runner.requests[0]?.args.join(' ')).not.toContain('calc.exe');
    expect(runner.requests[0]?.args.join(' ')).not.toContain('my session');
    expect(runner.requests[0]?.env['FD_PROMPT']).toBe(hostile);
  });

  it('asks the port for the profile function it was given, and runs what it answers', async () => {
    const runner = new FakeProcessRunner();
    runner.willReturn({ stdout: NEW_ID });
    const { launcher: subject, commands } = build(runner);

    await subject.launch({
      profileFn: 'claude-isg-ticket',
      prompt: 'go',
      name: 'XWEB-1',
      cwd: undefined,
      agent: undefined,
    });

    expect(commands.asked[0]?.profileFn).toBe('claude-isg-ticket');
    expect(runner.requests[0]?.command).toBe('C:\\powershell.exe');
    expect(runner.requests[0]?.args).toContain('encoded:claude-isg-ticket');
  });

  it('does NOT set CLAUDE_CONFIG_DIR itself — the profile function exports it (D4)', async () => {
    const runner = new FakeProcessRunner();
    runner.willReturn({ stdout: NEW_ID });

    await launcher(runner).launch({
      profileFn: 'claude-isg',
      prompt: 'go',
      name: 'x',
      cwd: undefined,
      agent: undefined,
    });

    // Two opinions about which account a session belongs to is one too many, and the one that
    // would win is the function's.
    expect(runner.requests[0]?.env['CLAUDE_CONFIG_DIR']).toBeUndefined();
  });

  it.each([
    { why: 'an empty prompt', prompt: '', name: 'x' },
    { why: 'a whitespace-only prompt', prompt: '   ', name: 'x' },
    { why: 'a prompt past the cap', prompt: 'x'.repeat(8001), name: 'x' },
    { why: 'no name at all', prompt: 'go', name: '' },
    { why: 'a whitespace-only name', prompt: 'go', name: '  ' },
    { why: 'a name past the cap', prompt: 'go', name: 'x'.repeat(81) },
  ])('refuses $why without spawning', async ({ prompt, name }) => {
    const runner = new FakeProcessRunner();

    const launched = await launcher(runner).launch({
      profileFn: 'claude-365',
      prompt,
      name,
      cwd: undefined,
      agent: undefined,
    });

    expect(launched).toEqual({ ok: false, error: 'bad_request' });
    expect(runner.requests).toHaveLength(0);
  });

  it('lets the one function that names itself go without a name', async () => {
    // `claude-isg-orch` passes `-n orchestrator`, so asking for a second name would be asking for
    // one that is thrown away.
    const runner = new FakeProcessRunner();
    runner.willReturn({ stdout: NEW_ID });

    const launched = await launcher(runner).launch({
      profileFn: 'claude-isg-orch',
      prompt: 'go',
      name: '',
      cwd: undefined,
      agent: undefined,
    });

    expect(launched.ok).toBe(true);
  });

  it('starts the session in the folder it was given — P4-T1', async () => {
    // The field `LaunchRequest` has carried since P2-T2 and nothing passed on until that task: a
    // background session inherits the cwd it was started in, so a preset naming a project folder
    // and a launcher that ignored it is a button that says the wrong thing about where it goes.
    const runner = new FakeProcessRunner();
    runner.willReturn({ stdout: NEW_ID });

    await launcher(runner).launch({
      profileFn: 'claude-isg-ticket',
      prompt: 'plan ticket XWEB-2019',
      name: 'XWEB-2019',
      cwd: APP_NEXT,
      agent: undefined,
    });

    expect(runner.requests[0]?.cwd).toBe(APP_NEXT);
  });

  it('leaves the folder absent when there is none, rather than sending an empty one', async () => {
    // Absent means "inherit core's", which is what the launch form wants; `''` would be a path.
    const runner = new FakeProcessRunner();
    runner.willReturn({ stdout: NEW_ID });

    await launcher(runner).launch({
      profileFn: 'claude-365',
      prompt: 'hello',
      name: 'x',
      cwd: undefined,
      agent: undefined,
    });

    expect(runner.requests[0]).not.toHaveProperty('cwd');
  });

  it('refuses when there is no shell to run, without spawning', async () => {
    const runner = new FakeProcessRunner();
    const commands = new FakeLaunchCommands();
    commands.breakShell();

    const launched = await build(runner, commands).launcher.launch({
      profileFn: 'claude-365',
      prompt: 'go',
      name: 'x',
      cwd: undefined,
      agent: undefined,
    });

    expect(launched).toEqual({ ok: false, error: 'no_shell' });
    expect(runner.requests).toHaveLength(0);
  });

  it.each([
    { why: 'a non-zero exit', result: { code: 1, stdout: '' } },
    { why: 'a timeout', result: { timedOut: true, stdout: '' } },
  ])('reports launch_failed on $why', async ({ result }) => {
    const runner = new FakeProcessRunner();
    runner.willReturn(result);

    const launched = await launcher(runner).launch({
      profileFn: 'claude-365',
      prompt: 'go',
      name: 'x',
      cwd: undefined,
      agent: undefined,
    });

    expect(launched).toEqual({ ok: false, error: 'launch_failed' });
  });

  it('reports no_session_id — not launch_failed — for an exit-0 run with no id', async () => {
    // The distinct outcome P4-T2 owes. A process that exited 0 may well have started a session,
    // and "it failed" is how the owner ends up starting a second one.
    const runner = new FakeProcessRunner();
    runner.willReturn({ code: 0, stdout: 'something else entirely' });

    const launched = await launcher(runner).launch({
      profileFn: 'claude-365',
      prompt: 'go',
      name: 'x',
      cwd: undefined,
      agent: undefined,
    });

    expect(launched).toEqual({ ok: false, error: 'no_session_id' });
  });
});
