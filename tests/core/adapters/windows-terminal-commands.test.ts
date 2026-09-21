// Finding Windows Terminal, and the command line that attaches in it — P6-T2, SEC-PROC-1.
//
// The header of the adapter carries the correction this file protects: SPEC spells the pop-out
// `<profile fn> attach <id>`, and the profile functions pass `--dangerously-skip-permissions`
// before `@args`, which makes Claude Code read `attach <id>` as a PROMPT. So the tests below are
// two-sided — what the command line IS, and what it must never contain.
import { describe, expect, it } from 'vitest';
import type { ProcessRequest, ProcessResult } from '../../../core/ports/process-runner.ts';
import { ClaudeInstall } from '../../../core/adapters/claude-cli/claude-install.ts';
import {
  CLAUDE_VARIABLE,
  SESSION_VARIABLE,
  WindowsTerminalCommands,
} from '../../../core/adapters/windows/windows-terminal-commands.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';

const LOCATION = String.raw`C:\Program Files\WindowsApps\Microsoft.WindowsTerminal_1.24_x64__8wek`;
const SPEC = { shortId: '337975f9', subscription: '365', title: 'alpha', cwd: 'C:\\repo' } as const;

const FOUND: ProcessResult = { code: 0, stdout: `${LOCATION}\r\n`, stderr: '', timedOut: false };
const ABSENT: ProcessResult = { code: 1, stdout: '', stderr: 'not found', timedOut: false };

function build(
  result: ProcessResult = FOUND,
  executable = 'C:\\claude.exe',
): { commands: WindowsTerminalCommands; asked: ProcessRequest[] } {
  const asked: ProcessRequest[] = [];
  const commands = new WindowsTerminalCommands({
    install: new ClaudeInstall('C:\\home', executable),
    runner: {
      run: (request) => {
        asked.push(request);
        return Promise.resolve(result);
      },
    },
    shell: 'C:\\powershell.exe',
    logger: new FakeLogger(),
  });
  return { commands, asked };
}

describe('WindowsTerminalCommands — finding it', () => {
  // `wt.exe` on PATH is an AppX execution alias that CreateProcess cannot run (RESEARCH §A).
  it('asks PowerShell where the AppX package is, rather than trusting PATH', async () => {
    const { commands, asked } = build();

    await commands.popout(SPEC);

    expect(asked[0]?.args).toContain('(Get-AppxPackage Microsoft.WindowsTerminal).InstallLocation');
  });

  it('runs the wt.exe INSIDE the package, not the alias', async () => {
    const { commands } = build();

    expect((await commands.popout(SPEC))?.command).toBe(`${LOCATION}\\wt.exe`);
  });

  it('looks it up once and remembers — an AppX package does not move while core runs', async () => {
    const { commands, asked } = build();

    await commands.popout(SPEC);
    await commands.popout(SPEC);

    expect(asked.length).toBe(1);
  });

  it('remembers that it is NOT there too, rather than paying for the answer twice', async () => {
    const { commands, asked } = build(ABSENT);

    expect(await commands.popout(SPEC)).toBeUndefined();
    expect(await commands.popout(SPEC)).toBeUndefined();
    expect(asked.length).toBe(1);
  });

  it('refuses when Claude Code is not installed, without looking for a terminal', async () => {
    const { commands, asked } = build(FOUND, '');

    expect(await commands.popout(SPEC)).toBeUndefined();
    expect(asked).toEqual([]);
  });
});

describe('WindowsTerminalCommands — the command line', () => {
  it('opens a tab in the window that is already there', async () => {
    const args = (await build().commands.popout(SPEC))?.args ?? [];

    expect(args.slice(0, 3)).toEqual(['-w', '0', 'nt']);
  });

  it('names the tab and starts it in the session’s folder', async () => {
    const args = (await build().commands.popout(SPEC))?.args ?? [];

    expect(args).toContain('--title');
    expect(args[args.indexOf('--title') + 1]).toBe('alpha');
    expect(args[args.indexOf('-d') + 1]).toBe('C:\\repo');
  });

  it('leaves the folder to Windows Terminal when the row carries none', async () => {
    const args = (await build().commands.popout({ ...SPEC, cwd: undefined }))?.args ?? [];

    expect(args).not.toContain('-d');
  });

  // Windows Terminal re-reads its own command line and treats `;` as a subcommand separator. A tab
  // that opened somewhere other than the session's folder is the shell-pane failure again.
  it('REFUSES a folder carrying a command separator, rather than dropping it', async () => {
    expect(await build().commands.popout({ ...SPEC, cwd: 'C:\\a;calc' })).toBeUndefined();
  });

  it('strips a separator out of the TITLE, which is only cosmetic', async () => {
    const args = (await build().commands.popout({ ...SPEC, title: 'a;calc' }))?.args ?? [];

    expect(args[args.indexOf('--title') + 1]).toBe('acalc');
  });

  it('gives a tab with no usable title a name anyway', async () => {
    const args = (await build().commands.popout({ ...SPEC, title: ';;;' }))?.args ?? [];

    expect(args[args.indexOf('--title') + 1]).toBe('claude');
  });

  it('keeps the tab open after the attach ends, so the reason is readable', async () => {
    const args = (await build().commands.popout(SPEC))?.args ?? [];

    expect(args).toContain('-NoExit');
  });
});

describe('WindowsTerminalCommands — what it must never do', () => {
  // The finding this whole adapter exists around: `claude-365` passes
  // `--dangerously-skip-permissions` before `@args`, and a global flag before the subcommand makes
  // Claude Code read `attach <id>` as a PROMPT. It starts a session, spends tokens, and exits 0.
  it('does NOT go through a profile function', async () => {
    const args = (await build().commands.popout(SPEC))?.args ?? [];

    expect(args.join(' ')).not.toContain('claude-365');
    expect(args.join(' ')).not.toContain('claude-isg');
    expect(args.join(' ')).not.toContain('--dangerously-skip-permissions');
  });

  it('interpolates nothing into the script — it reads two environment variables', async () => {
    const command = await build().commands.popout(SPEC);
    const script = command?.args.at(-1) ?? '';

    expect(script).toBe(`& $env:${CLAUDE_VARIABLE} attach $env:${SESSION_VARIABLE}`);
    expect(script).not.toContain('337975f9');
    expect(script).not.toContain('claude.exe');
  });

  it('carries the id and the binary as VALUES instead', async () => {
    const command = await build().commands.popout(SPEC);

    expect(command?.env[SESSION_VARIABLE]).toBe('337975f9');
    expect(command?.env[CLAUDE_VARIABLE]).toBe('C:\\claude.exe');
  });

  // The one line that decides which of the two accounts the tab attaches under. A LAUNCH must not
  // set this (D4 — the profile function does); an attach has no function to go through.
  it('names the config directory from the closed subscription union', async () => {
    const one = await build().commands.popout(SPEC);
    const other = await build().commands.popout({ ...SPEC, subscription: 'isg' });

    expect(one?.env['CLAUDE_CONFIG_DIR']).toContain('.claude-365');
    expect(other?.env['CLAUDE_CONFIG_DIR']).toContain('.claude-isg');
  });

  it('passes every argument as an array element, never a command string', async () => {
    const command = await build().commands.popout(SPEC);

    expect(Array.isArray(command?.args)).toBe(true);
    expect(command?.command).not.toContain(' -w ');
  });
});
