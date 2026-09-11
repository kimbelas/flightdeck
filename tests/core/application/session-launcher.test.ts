// Starting a `--bg` session — the only path to a pane that can be typed into.
//
// The prompt is user text on its way to a process. Every assertion about argv here is SEC-PROC-1:
// it must arrive as its own array element, never woven into a command string.
import { describe, expect, it } from 'vitest';
import { ClaudeInstall } from '../../../core/adapters/claude-cli/claude-install.ts';
import { ConsoleLogger } from '../../../core/adapters/console-logger.ts';
import { SessionLauncher } from '../../../core/application/session-launcher.ts';
import { FakeProcessRunner } from '../../fakes/fake-process-runner.ts';

const NEW_ID = '11111111-2222-3333-4444-555555555555';
const silent = new ConsoleLogger({ write: () => true } as unknown as NodeJS.WritableStream);

function launcher(runner: FakeProcessRunner, executable = 'C:\\claude.exe'): SessionLauncher {
  return new SessionLauncher(new ClaudeInstall('C:\\home', executable), runner, silent);
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
