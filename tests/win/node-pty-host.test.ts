// A real ConPTY round trip — P0-T1 proved node-pty works; this proves the adapter does.
//
// The fakes everywhere else are honest about what they cannot cover: that `spawn` finds the
// binary, that bytes come back on `onData`, that `resize` does not throw on ConPTY, and that
// `kill` is idempotent even though node-pty throws on a double kill.
import { describe, expect, it } from 'vitest';
import { NodePtyHost } from '../../core/adapters/node-pty/node-pty-host.ts';
import type { PtySpec } from '../../core/ports/pty-host.ts';

const onWindows = process.platform === 'win32';
const SHELL = `${process.env['SystemRoot'] ?? 'C:\\Windows'}\\System32\\cmd.exe`;

function spec(overrides: Partial<PtySpec> = {}): PtySpec {
  return {
    command: SHELL,
    args: [],
    cwd: process.env['USERPROFILE'],
    cols: 80,
    rows: 24,
    env: process.env,
    ...overrides,
  };
}

/** Resolves with everything the PTY writes until `marker` appears, or rejects on timeout. */
function readUntil(
  pty: { onData: (listener: (data: string) => void) => void },
  marker: string,
  timeoutMs = 15_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let seen = '';
    const timer = setTimeout(() => {
      reject(new Error(`marker ${marker} never appeared in: ${seen.slice(-200)}`));
    }, timeoutMs);
    pty.onData((data) => {
      seen += data;
      if (seen.includes(marker)) {
        clearTimeout(timer);
        resolve(seen);
      }
    });
  });
}

describe('NodePtyHost', () => {
  it.skipIf(!onWindows)(
    'spawns a shell and streams its output back',
    async () => {
      const pty = new NodePtyHost().spawn(spec());
      const output = readUntil(pty, 'FLIGHTDECK-OK');

      pty.write('echo FLIGHTDECK-OK\r');

      expect(await output).toContain('FLIGHTDECK-OK');
      expect(pty.pid).toBeGreaterThan(0);
      pty.kill();
    },
    30_000,
  );

  it.skipIf(!onWindows)(
    'passes its own environment to the child, not the parent’s',
    async () => {
      const pty = new NodePtyHost().spawn(
        spec({ env: { ...process.env, FLIGHTDECK_PROBE: 'carried' } }),
      );
      const output = readUntil(pty, 'PROBE=carried');

      // The mechanism CLAUDE_CONFIG_DIR rides on: get this wrong and a pane attaches to the
      // wrong subscription (WindowsPtyCommands).
      pty.write('echo PROBE=%FLIGHTDECK_PROBE%\r');

      expect(await output).toContain('PROBE=carried');
      pty.kill();
    },
    30_000,
  );

  it.skipIf(!onWindows)(
    'resizes without throwing',
    async () => {
      const pty = new NodePtyHost().spawn(spec());
      await readUntil(pty, '>');

      expect(() => {
        pty.resize(120, 40);
      }).not.toThrow();
      pty.kill();
    },
    30_000,
  );

  it.skipIf(!onWindows)(
    'reports the exit code',
    async () => {
      const pty = new NodePtyHost().spawn(spec());
      const exited = new Promise<number>((resolve) => {
        pty.onExit(resolve);
      });

      pty.write('exit 7\r');

      expect(await exited).toBe(7);
    },
    30_000,
  );

  it.skipIf(!onWindows)(
    'survives a double kill, which node-pty alone does not',
    () => {
      const pty = new NodePtyHost().spawn(spec());

      pty.kill();

      // A pane closing while its session is already exiting is an ordinary race, not an error.
      expect(() => {
        pty.kill();
      }).not.toThrow();
    },
    30_000,
  );

  it.skipIf(!onWindows)(
    'ignores a write after exit rather than throwing',
    async () => {
      const pty = new NodePtyHost().spawn(spec());
      const exited = new Promise<number>((resolve) => {
        pty.onExit(resolve);
      });
      pty.write('exit\r');
      await exited;

      expect(() => {
        pty.write('too late\r');
      }).not.toThrow();
      expect(() => {
        pty.resize(100, 30);
      }).not.toThrow();
    },
    30_000,
  );
});
