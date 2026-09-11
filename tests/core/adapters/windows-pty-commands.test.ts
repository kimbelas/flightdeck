// Target to argv — SEC-PROC-1, and the id form `attach` actually accepts.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PtyTarget } from '../../../contracts/pty-protocol.ts';
import { ClaudeInstall } from '../../../core/adapters/claude-cli/claude-install.ts';
import { WindowsPtyCommands } from '../../../core/adapters/windows/windows-pty-commands.ts';

const SIZE = { cols: 80, rows: 24 };
const UUID = '337975f9-c9c0-454a-a22a-2d53a86e0ea9';
const SHORT = '337975f9';

function commands(executable = 'C:\\claude.exe'): WindowsPtyCommands {
  return new WindowsPtyCommands(new ClaudeInstall('C:\\home', executable));
}

const sessionTarget: PtyTarget = { kind: 'session', sessionId: UUID, subscription: '365' };

describe('WindowsPtyCommands — session panes', () => {
  it('attaches with the SHORT id, not the full uuid', () => {
    const spec = commands().forTarget(sessionTarget, SIZE);

    // Measured: attaching with the uuid gets "No job matching '<uuid>'" and exit 1 — the pane
    // mounts and the session dies immediately. SessionId documented the short form all along.
    expect(spec?.args).toEqual(['attach', SHORT]);
    expect(spec?.args).not.toContain(UUID);
  });

  it('points the child at the subscription’s config dir', () => {
    const spec = commands().forTarget(sessionTarget, SIZE);

    expect(spec?.env['CLAUDE_CONFIG_DIR']).toBe(join('C:\\home', '.claude-365'));
  });

  it('points at the other config dir for the other subscription', () => {
    const spec = commands().forTarget({ ...sessionTarget, subscription: 'isg' }, SIZE);

    expect(spec?.env['CLAUDE_CONFIG_DIR']).toBe(join('C:\\home', '.claude-isg'));
  });

  it('refuses a session pane when Claude is not installed', () => {
    expect(commands('').forTarget(sessionTarget, SIZE)).toBeUndefined();
  });

  it('refuses rather than throws on an id that is not a uuid', () => {
    const malformed: PtyTarget = { kind: 'session', sessionId: 'nonsense', subscription: '365' };

    expect(() => commands().forTarget(malformed, SIZE)).not.toThrow();
    expect(commands().forTarget(malformed, SIZE)).toBeUndefined();
  });

  it('carries the requested size', () => {
    const spec = commands().forTarget(sessionTarget, { cols: 132, rows: 43 });

    expect(spec).toMatchObject({ cols: 132, rows: 43 });
  });
});

describe('WindowsPtyCommands — shell panes', () => {
  it('runs a shell with no arguments, and needs no Claude install', () => {
    const spec = commands('').forTarget({ kind: 'shell' }, SIZE);

    expect(spec?.args).toEqual([]);
    expect(spec?.command).toContain('cmd.exe');
  });
});
