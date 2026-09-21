// Target to argv — SEC-PROC-1, and the id form `attach` actually accepts.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectKey } from '../../../contracts/project.ts';
import type { PtyTarget } from '../../../contracts/pty-protocol.ts';
import type { ProjectRoots } from '../../../core/ports/pty-commands.ts';
import { ClaudeInstall } from '../../../core/adapters/claude-cli/claude-install.ts';
import { WindowsPtyCommands } from '../../../core/adapters/windows/windows-pty-commands.ts';

const SIZE = { cols: 80, rows: 24 };
const UUID = '337975f9-c9c0-454a-a22a-2d53a86e0ea9';
const SHORT = '337975f9';

/** The imported folders this machine pretends to have — P6-T1. A key is matched, never built. */
const LEDGER_PATH = String.raw`C:\Users\owner\Documents\Ledger`;
const LEDGER_KEY = projectKey(LEDGER_PATH);

/** `ProjectRoots`, as the two lines it is — a `Map` lookup wearing an interface. */
const roots: ProjectRoots = {
  rootFor: (key) => (key === LEDGER_KEY ? LEDGER_PATH : undefined),
};

function commands(executable = 'C:\\claude.exe'): WindowsPtyCommands {
  return new WindowsPtyCommands(new ClaudeInstall('C:\\home', executable), roots);
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

const homeShell: PtyTarget = { kind: 'shell', id: 'shell-1', project: undefined };

describe('WindowsPtyCommands — shell panes', () => {
  it('runs PowerShell, and needs no Claude install', () => {
    const spec = commands('').forTarget(homeShell, SIZE);

    expect(spec?.command).toContain('powershell.exe');
    expect(spec?.command).not.toContain('cmd.exe');
  });

  // The flag that must never be added. The profile is where `claude-365`, `claude-isg` and the
  // two ticket functions live (D4, D45), and a pane without them is a terminal the owner would
  // have to leave to use — the exact opposite of what P6 is for.
  it('does NOT pass -NoProfile, because the profile is where the launch functions are', () => {
    const spec = commands('').forTarget(homeShell, SIZE);

    expect(spec?.args).toEqual(['-NoLogo']);
    expect(spec?.args).not.toContain('-NoProfile');
  });

  it('starts a shell with no project at home', () => {
    expect(commands('').forTarget(homeShell, SIZE)?.cwd).toBe('C:\\home');
  });

  // SPEC §5.7(3): "or the goal fails at the first `git status`".
  it('starts a shell in the imported folder it names', () => {
    const spec = commands('').forTarget({ ...homeShell, project: LEDGER_KEY }, SIZE);

    // The STORED path, in the filesystem's own casing — not the lowercased key it was found by.
    expect(spec?.cwd).toBe(LEDGER_PATH);
  });

  // Falling back to home would be a terminal that opened somewhere other than where the button
  // said, which is the one failure a terminal must not have (SEC-FS-1, D26).
  it('REFUSES a folder nobody imported, rather than falling back to home', () => {
    expect(commands('').forTarget({ ...homeShell, project: 'c:/nope' }, SIZE)).toBeUndefined();
  });

  it('carries the requested size, like a session pane', () => {
    expect(commands('').forTarget(homeShell, { cols: 132, rows: 43 })).toMatchObject({
      cols: 132,
      rows: 43,
    });
  });
});
