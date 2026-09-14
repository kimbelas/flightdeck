// Starting a `--bg` session — the only path to a pane that can be typed into.
//
// The prompt is user text on its way to a process. Every assertion about argv here is SEC-PROC-1:
// it must arrive as its own array element, never woven into a command string.
import { describe, expect, it } from 'vitest';
import { ClaudeInstall } from '../../../core/adapters/claude-cli/claude-install.ts';
import { AuditLog } from '../../../core/application/audit-log.ts';
import { SessionLauncher } from '../../../core/application/session-launcher.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeProcessRunner } from '../../fakes/fake-process-runner.ts';
import { FakeStore } from '../../fakes/fake-store.ts';

const NEW_ID = '11111111-2222-3333-4444-555555555555';
/** The store comes back too, because SEC-PROC-3's row is part of what a launch is (P1-T8). */
function build(
  runner: FakeProcessRunner,
  executable = 'C:\\claude.exe',
): { launcher: SessionLauncher; store: FakeStore } {
  const store = new FakeStore();
  const audit = new AuditLog(store, new FakeClock(), new FakeLogger());
  const launcher = new SessionLauncher({
    install: new ClaudeInstall('C:\\home', executable),
    runner,
    audit,
    logger: new FakeLogger(),
  });
  return { launcher, store };
}

function launcher(runner: FakeProcessRunner, executable = 'C:\\claude.exe'): SessionLauncher {
  return build(runner, executable).launcher;
}

describe('SessionLauncher', () => {
  it('returns the session id the CLI printed', async () => {
    const runner = new FakeProcessRunner();
    runner.willReturn({ stdout: `Started background session ${NEW_ID}\n` });

    const launched = await launcher(runner).launch({
      subscription: '365',
      prompt: 'summarise the repo',
      name: 'reader',
      cwd: undefined,
    });

    expect(launched).toEqual({ ok: true, value: NEW_ID });
  });

  it('passes the prompt as its own argv element, never as a command string', async () => {
    const runner = new FakeProcessRunner();
    runner.willReturn({ stdout: NEW_ID });
    const hostile = 'do the thing" & calc.exe & echo "';

    await launcher(runner).launch({
      subscription: '365',
      prompt: hostile,
      name: undefined,
      cwd: undefined,
    });

    const [request] = runner.requests;
    expect(request?.args).toEqual(['--bg', hostile]);
    // Nothing joined the arguments into a string anywhere on the way down.
    expect(request?.args.join(' ')).toContain('calc.exe');
    expect(request?.command).toBe('C:\\claude.exe');
  });

  it('passes a name through as a separate flag and value', async () => {
    const runner = new FakeProcessRunner();
    runner.willReturn({ stdout: NEW_ID });

    await launcher(runner).launch({
      subscription: 'isg',
      prompt: 'go',
      name: 'my session',
      cwd: undefined,
    });

    expect(runner.requests[0]?.args).toEqual(['--bg', '--name', 'my session', 'go']);
  });

  it('launches into the requested subscription’s config dir', async () => {
    const runner = new FakeProcessRunner();
    runner.willReturn({ stdout: NEW_ID });

    await launcher(runner).launch({
      subscription: 'isg',
      prompt: 'go',
      name: undefined,
      cwd: undefined,
    });

    expect(runner.requests[0]?.env['CLAUDE_CONFIG_DIR']).toContain('.claude-isg');
  });

  it.each([
    { why: 'an empty prompt', prompt: '' },
    { why: 'a whitespace-only prompt', prompt: '   ' },
    { why: 'a prompt past the cap', prompt: 'x'.repeat(8001) },
  ])('refuses $why without spawning — `--bg` requires a real prompt (B.4)', async ({ prompt }) => {
    const runner = new FakeProcessRunner();

    const launched = await launcher(runner).launch({
      subscription: '365',
      prompt,
      name: undefined,
      cwd: undefined,
    });

    expect(launched).toEqual({ ok: false, error: 'bad_request' });
    expect(runner.requests).toHaveLength(0);
  });

  it('refuses when Claude is not installed, without spawning', async () => {
    const runner = new FakeProcessRunner();

    const launched = await launcher(runner, '').launch({
      subscription: '365',
      prompt: 'go',
      name: undefined,
      cwd: undefined,
    });

    expect(launched).toEqual({ ok: false, error: 'no_claude' });
    expect(runner.requests).toHaveLength(0);
  });

  it.each([
    { why: 'a non-zero exit', result: { code: 1, stdout: '' } },
    { why: 'a timeout', result: { timedOut: true, stdout: '' } },
    { why: 'output with no id in it', result: { stdout: 'something went wrong' } },
  ])('reports launch_failed on $why', async ({ result }) => {
    const runner = new FakeProcessRunner();
    runner.willReturn(result);

    const launched = await launcher(runner).launch({
      subscription: '365',
      prompt: 'go',
      name: undefined,
      cwd: undefined,
    });

    expect(launched).toEqual({ ok: false, error: 'launch_failed' });
  });

  it('accepts a short id when that is all the CLI printed', async () => {
    const runner = new FakeProcessRunner();
    runner.willReturn({ stdout: 'session a1b2c3d4 started in the background' });

    const launched = await launcher(runner).launch({
      subscription: '365',
      prompt: 'go',
      name: undefined,
      cwd: undefined,
    });

    expect(launched).toEqual({ ok: true, value: 'a1b2c3d4' });
  });
});

describe('SessionLauncher — the audit row (SEC-PROC-3)', () => {
  it('writes one ok row naming the new session', async () => {
    const runner = new FakeProcessRunner();
    runner.willReturn({ stdout: `Started background session ${NEW_ID}\n` });
    const { launcher: subject, store } = build(runner);

    await subject.launch({ subscription: '365', prompt: 'do a thing', name: 'r', cwd: undefined });

    const [row] = store.allAudit;
    expect(store.allAudit).toHaveLength(1);
    expect(row?.action).toBe('launch');
    expect(row?.outcome).toBe('ok');
    expect(row?.target).toBe(NEW_ID);
  });

  it('writes a refused row when there is no claude, before running anything', async () => {
    const runner = new FakeProcessRunner();
    // `''` rather than `undefined`, which would take the default parameter — the file's existing
    // convention for "claude.exe was not found".
    const { launcher: subject, store } = build(runner, '');

    await subject.launch({
      subscription: 'isg',
      prompt: 'do a thing',
      name: undefined,
      cwd: undefined,
    });

    // The refusals are the rows a reviewer actually looks for, so they cannot be the ones that
    // return early without writing.
    expect(store.auditFailures()).toHaveLength(1);
    expect(store.allAudit[0]?.outcome).toBe('refused');
    expect(store.allAudit[0]?.target).toBe('isg');
  });

  it('writes a refused row for a prompt that is out of range', async () => {
    const runner = new FakeProcessRunner();
    const { launcher: subject, store } = build(runner);

    await subject.launch({ subscription: '365', prompt: '   ', name: undefined, cwd: undefined });

    expect(store.allAudit[0]?.outcome).toBe('refused');
    expect(store.allAudit[0]?.reason).toBeTypeOf('string');
  });

  it('writes a failed row carrying why, when the CLI does not exit 0', async () => {
    const runner = new FakeProcessRunner();
    runner.willReturn({ stdout: '', code: 1 });
    const { launcher: subject, store } = build(runner);

    await subject.launch({
      subscription: '365',
      prompt: 'do a thing',
      name: undefined,
      cwd: undefined,
    });

    expect(store.allAudit[0]?.outcome).toBe('failed');
    expect(store.allAudit[0]?.reason).toContain('exit 1');
  });

  it('never puts the prompt in the row, which is kept forever and shown in the UI', async () => {
    const runner = new FakeProcessRunner();
    runner.willReturn({ stdout: `Started background session ${NEW_ID}\n` });
    const { launcher: subject, store } = build(runner);

    await subject.launch({
      subscription: '365',
      prompt: 'something the owner typed',
      name: undefined,
      cwd: undefined,
    });

    // `args` is the argv as run everywhere else; the prompt is the one element that bends the rule,
    // because this table is kept forever and rendered (SEC-DATA-2, SEC-UI-2).
    expect(JSON.stringify(store.allAudit)).not.toContain('something the owner typed');
    expect(store.allAudit[0]?.args).toEqual(['--bg']);
  });
});
