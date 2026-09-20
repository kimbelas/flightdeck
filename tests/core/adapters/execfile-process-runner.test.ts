// P1-T5 found this by killing core: `execFile` can fail before there is a process to fail.
//
// Windows answered `spawn UNKNOWN` on a sweep, that throw landed on the calling stack rather than
// in the callback, and it became a rejected promise, an unhandled rejection and an exited core
// (RESEARCH.md G.10). The class's own header already said a failure is a value rather than a
// throw; this is the half that was not true.
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { ExecFileProcessRunner } from '../../../core/adapters/claude-cli/execfile-process-runner.ts';

const TIMEOUT_MS = 5000;

/** A null byte makes Node throw synchronously — the only spawn failure a test can produce on demand. */
const UNSPAWNABLE = `claude${String.fromCharCode(0)}.exe`;

describe('ExecFileProcessRunner', () => {
  it('reports a spawn that never happened as a failed run, not a rejection', async () => {
    const runner = new ExecFileProcessRunner();

    const result = await runner.run({
      command: UNSPAWNABLE,
      args: ['agents', '--json'],
      env: {},
      timeoutMs: TIMEOUT_MS,
    });

    expect(result.code).toBe(-1);
    expect(result.timedOut).toBe(false);
  });

  it('says why in stderr, so a log can tell a bad argument from a refusal', async () => {
    const runner = new ExecFileProcessRunner();

    const result = await runner.run({
      command: UNSPAWNABLE,
      args: [],
      env: {},
      timeoutMs: TIMEOUT_MS,
    });

    expect(result.stderr).not.toBe('');
    expect(result.stdout).toBe('');
  });

  // P4-T1's seam, and the one link in the cwd chain no fake can stand in for. `SessionLauncher`
  // is tested against a `FakeProcessRunner` that records what it was handed; whether `execFile`
  // then STARTS the child there is this adapter's promise, and a real process is the only thing
  // that can answer it. `node -p` rather than `claude.exe`: the question is about the option, not
  // about Claude Code.
  it('starts the child in the directory it was given — P4-T1', async () => {
    const runner = new ExecFileProcessRunner();

    const result = await runner.run({
      command: process.execPath,
      args: ['-p', 'process.cwd()'],
      env: {},
      cwd: tmpdir(),
      timeoutMs: TIMEOUT_MS,
    });

    expect(result.code).toBe(0);
    // Compared case-insensitively and by tail: Windows answers `C:\Users\…\Temp` for a `TMP` the
    // environment spells `C:\Users\…\AppData\Local\Temp`, and CI is Linux where neither applies.
    expect(result.stdout.trim().toLowerCase()).toBe(tmpdir().toLowerCase());
  });

  it('starts it in core’s own directory when it is given none', async () => {
    const runner = new ExecFileProcessRunner();

    const result = await runner.run({
      command: process.execPath,
      args: ['-p', 'process.cwd()'],
      env: {},
      timeoutMs: TIMEOUT_MS,
    });

    expect(result.stdout.trim().toLowerCase()).toBe(process.cwd().toLowerCase());
  });

  it('reports a command that does not exist the same way', async () => {
    // The asynchronous half, which already worked. Both roads lead to the same result shape,
    // because every caller already handles that one.
    const runner = new ExecFileProcessRunner();

    const result = await runner.run({
      command: 'flightdeck-no-such-binary.exe',
      args: [],
      env: {},
      timeoutMs: TIMEOUT_MS,
    });

    expect(result.code).toBe(-1);
  });
});
