// `DirectAskCommands` — the argv is the security control, so the argv is what is asserted (P4-T4).
//
// Everything here is SEC-PROC-4 or SEC-PROC-1. The one that matters most is the flag that must be
// ABSENT: every profile function passes `--dangerously-skip-permissions`, a run started through
// one reports `bypassPermissions` whatever else is on the line, and `--permission-mode` is not
// refused in that case — it is silently ignored (RESEARCH.md F.9.3). That is why Ask does not go
// through a function at all (D47), and why a test asserts on a string that is not there.
import { describe, expect, it } from 'vitest';
import {
  ASK_DEFAULT_BUDGET_USD,
  ASK_DEFAULT_MAX_TURNS,
  type AskRequest,
} from '../../../contracts/ask-run.ts';
import { ClaudeInstall } from '../../../core/adapters/claude-cli/claude-install.ts';
import { DirectAskCommands } from '../../../core/adapters/claude-cli/direct-ask-commands.ts';

const HOME = 'C:\\Users\\ada';
const BIN = 'C:\\bin\\claude.exe';

function commands(executable: string = BIN): DirectAskCommands {
  return new DirectAskCommands(new ClaudeInstall(HOME, executable), { PATH: 'C:\\Windows' });
}

function request(overrides: Partial<AskRequest> = {}): AskRequest {
  return {
    subscription: '365',
    prompt: 'summarise what changed in this repo today',
    cwd: '',
    permissionMode: 'plan',
    budgetUsd: ASK_DEFAULT_BUDGET_USD,
    maxTurns: ASK_DEFAULT_MAX_TURNS,
    ...overrides,
  };
}

describe('DirectAskCommands — SEC-PROC-4, the flags that must be there', () => {
  it('always carries a budget cap and a turn cap', () => {
    const command = commands().forRun(request());

    expect(command?.args).toContain('--max-budget-usd');
    expect(command?.args).toContain(String(ASK_DEFAULT_BUDGET_USD));
    expect(command?.args).toContain('--max-turns');
    expect(command?.args).toContain(String(ASK_DEFAULT_MAX_TURNS));
  });

  it('passes the permission mode the request asked for', () => {
    for (const mode of ['plan', 'default', 'acceptEdits'] as const) {
      const command = commands().forRun(request({ permissionMode: mode }));
      const at = command?.args.indexOf('--permission-mode') ?? -1;

      expect(at).toBeGreaterThanOrEqual(0);
      expect(command?.args[at + 1]).toBe(mode);
    }
  });

  it('asks for the stream format the panel needs, with the --verbose the CLI requires with it', () => {
    const args = commands().forRun(request())?.args ?? [];

    expect(args).toContain('-p');
    expect(args.join(' ')).toContain('--output-format stream-json');
    expect(args).toContain('--include-partial-messages');
    expect(args).toContain('--verbose');
  });
});

describe('DirectAskCommands — SEC-PROC-4, the flag that must NOT be there', () => {
  it('never passes --dangerously-skip-permissions, whatever the request says', () => {
    // The whole of D47 in one assertion. Through any of the four profile functions this string is
    // unavoidable and `--permission-mode` is silently ignored beside it (F.9.3).
    for (const mode of ['plan', 'default', 'acceptEdits'] as const) {
      const args = commands().forRun(request({ permissionMode: mode }))?.args ?? [];

      expect(args).not.toContain('--dangerously-skip-permissions');
      expect(args.join(' ')).not.toContain('dangerously');
    }
  });

  it('runs the binary directly rather than a shell', () => {
    // No `powershell.exe`, no `-EncodedCommand`, no script: there is no interpreter between core
    // and the binary, which is a stronger position than the launcher's, not a weaker one.
    const command = commands().forRun(request());

    expect(command?.command).toBe(BIN);
    expect(command?.args.join(' ')).not.toContain('EncodedCommand');
    expect(command?.command.toLowerCase()).not.toContain('powershell');
  });
});

describe('DirectAskCommands — SEC-PROC-1, the prompt is a value', () => {
  it('puts the prompt last, as one element, however it reads', () => {
    // A prompt beginning `--model` is a prompt. It is the final element and nothing follows it, so
    // there is no flag it could be read as an argument to.
    const nasty = '--model claude-opus-5 ; $(Get-Date) | rm -rf "quoted" $env:PATH';
    const args = commands().forRun(request({ prompt: nasty }))?.args ?? [];

    expect(args.at(-1)).toBe(nasty);
    expect(args.filter((arg) => arg === nasty)).toHaveLength(1);
  });

  it('names the account by config directory, chosen from the closed union', () => {
    // The browser asks for `365`, never for a folder (SECURITY.md §11 rule 2).
    //
    // Compared against `ClaudeInstall`'s own answer rather than against a pinned string: `join`
    // uses the HOST separator, so a literal `C:\Users\ada\.claude-365` passes on Windows and fails
    // on the Linux runner as `C:\Users\ada/.claude-365`. What is worth asserting is that the
    // adapter takes the directory from the install and picks it by subscription — which is the
    // control — not which slash this machine happens to write.
    const install = new ClaudeInstall(HOME, BIN);

    expect(commands().forRun(request({ subscription: '365' }))?.env['CLAUDE_CONFIG_DIR']).toBe(
      install.configDirFor('365'),
    );
    expect(commands().forRun(request({ subscription: 'isg' }))?.env['CLAUDE_CONFIG_DIR']).toBe(
      install.configDirFor('isg'),
    );
    expect(install.configDirFor('365')).not.toBe(install.configDirFor('isg'));
    expect(install.configDirFor('365').endsWith('.claude-365')).toBe(true);
  });

  it('starts in a named folder, or in core’s own when none was given', () => {
    expect(commands().forRun(request({ cwd: '' }))?.cwd).toBeUndefined();
    expect(commands().forRun(request({ cwd: 'C:\\dev\\thing' }))?.cwd).toBe('C:\\dev\\thing');
  });

  it('answers undefined when there is no binary, rather than a command that cannot run', () => {
    // `claude.exe` genuinely goes missing mid-npm-update (F.1.5). The refusal is `no_claude`, which
    // the owner can read, not a spawn failure discovered afterwards.
    expect(commands('').forRun(request())).toBeUndefined();
  });
});
