// Finding Windows Terminal, and the one command line that attaches in it — P6-T2, SEC-PROC-1.
//
// **`wt.exe` on `PATH` is not a program.** It is an AppX execution alias — a zero-byte reparse
// point the shell understands and `CreateProcess` does not — so Node cannot spawn it
// (RESEARCH.md §A; `open-tab.mjs` carries the same fix). The real binary is inside the package:
// `(Get-AppxPackage Microsoft.WindowsTerminal).InstallLocation`, which on this machine is
// `C:\Program Files\WindowsApps\Microsoft.WindowsTerminal_1.24.11911.0_x64__8wekyb3d8bbwe`.
// Resolved once and cached, because an AppX package does not move while core runs and the lookup
// is a PowerShell start.
//
// **It does NOT go through a profile function, and that is a correction to SPEC** (D57). SPEC
// §5.3 spells the pop-out `powershell -NoExit -Command "<profile fn> attach <id>"`. Measured, that
// does not attach to anything: `claude-365` passes `--dangerously-skip-permissions` before `@args`,
// and a global flag before the subcommand makes Claude Code read `attach <id>` as a PROMPT. It
// starts a new interactive session, spends tokens, and exits 0 — a button that looks like it
// worked. So the tab runs `claude attach` directly with `CLAUDE_CONFIG_DIR` set, which is what a
// pane has always done (`WindowsPtyCommands`).
//
// **Nothing is interpolated into a command string.** The `-Command` text is FIXED and reads two
// environment variables, exactly as `PowerShellLaunchCommands` does — `$env:X` in argument mode is
// a value and is never expanded again (F.8.2). The environment reaches a new tab in an EXISTING
// window, measured: `-w 0` hands off to the running Windows Terminal and the variables still
// arrive (G.50). That is the fact this whole design rests on; without it the config directory
// would have had to be composed into the script.
import { join } from 'node:path';
import type { Logger } from '../../ports/logger.ts';
import type { ProcessRequest, ProcessRunner } from '../../ports/process-runner.ts';
import type { PopoutSpec, TerminalCommands } from '../../ports/terminal-commands.ts';
import type { ClaudeInstall } from '../claude-cli/claude-install.ts';

/** The two variables the fixed script reads. Named here so the script and the env cannot drift. */
export const CLAUDE_VARIABLE = 'FD_CLAUDE';
export const SESSION_VARIABLE = 'FD_SESSION';

/**
 * The whole of what the new tab is asked to do.
 *
 * `&` because the path is in a variable; `-NoExit` so the tab survives the attach ending and the
 * owner can read why. There is no interpolation in this string and there must never be.
 */
const SCRIPT = `& $env:${CLAUDE_VARIABLE} attach $env:${SESSION_VARIABLE}`;

/** Finding the package is a PowerShell start; this is the budget for it, not for the tab. */
const RESOLVE_TIMEOUT_MS = 15_000;

/** Asking PowerShell where the package is. A fixed script with nothing composed into it. */
const RESOLVE_SCRIPT = '(Get-AppxPackage Microsoft.WindowsTerminal).InstallLocation';

/**
 * What a tab title may contain.
 *
 * Windows Terminal re-reads its own command line and treats `;` as a subcommand separator, so a
 * title carrying one would split the command in half. The title is cosmetic, so it is SANITISED
 * rather than refused — unlike the folder below, where being wrong means opening somewhere else.
 */
const UNSAFE_IN_TITLE = /[^\w .\u00b7@/\\:-]/gu;
const MAX_TITLE_CHARS = 64;

export interface WindowsTerminalParts {
  readonly install: ClaudeInstall;
  readonly runner: ProcessRunner;
  readonly shell: string;
  readonly logger: Logger;
}

export class WindowsTerminalCommands implements TerminalCommands {
  private readonly parts: WindowsTerminalParts;
  /** `undefined` until the first lookup; `''` once one has failed, so it is not repeated. */
  private resolved: string | undefined;

  constructor(parts: WindowsTerminalParts) {
    this.parts = parts;
  }

  public async popout(spec: PopoutSpec): Promise<ProcessRequest | undefined> {
    const { executable } = this.parts.install;
    if (executable === undefined) return undefined;
    // A folder Windows Terminal would re-read as two commands. Refused rather than dropped: a tab
    // that opened somewhere other than the session's folder is the shell-pane failure again.
    if (spec.cwd?.includes(';') === true) {
      this.parts.logger.warn('popout_refused', { reason: 'separator in cwd' });
      return undefined;
    }
    const terminal = await this.terminal();
    if (terminal === undefined) return undefined;

    return {
      command: terminal,
      args: [
        // `-w 0` puts it in the window that is already open, which is what makes this feel like a
        // tab rather than a second terminal. The environment still reaches it (G.50).
        '-w',
        '0',
        'nt',
        '--title',
        titleOf(spec.title),
        ...(spec.cwd === undefined ? [] : ['-d', spec.cwd]),
        'powershell',
        '-NoLogo',
        '-NoExit',
        '-Command',
        SCRIPT,
      ],
      env: this.environment(executable, spec),
      timeoutMs: RESOLVE_TIMEOUT_MS,
    };
  }

  /**
   * The environment the tab inherits.
   *
   * `CLAUDE_CONFIG_DIR` is set here, where a LAUNCH deliberately does not set it (D4): a launch
   * goes through the profile function, which exports and removes it; an attach cannot, for the
   * reason in the header. It is named from the closed `SubscriptionId` union, so a page asking for
   * a pop-out cannot steer it at a folder (SECURITY.md §11 rule 2).
   */
  private environment(
    executable: string,
    spec: PopoutSpec,
  ): Readonly<Record<string, string | undefined>> {
    return {
      ...process.env,
      CLAUDE_CONFIG_DIR: this.parts.install.configDirFor(spec.subscription),
      [CLAUDE_VARIABLE]: executable,
      [SESSION_VARIABLE]: spec.shortId,
    };
  }

  /** The AppX binary, found once. `undefined` for a machine with no Windows Terminal. */
  private async terminal(): Promise<string | undefined> {
    if (this.resolved !== undefined) return this.resolved === '' ? undefined : this.resolved;
    const found = await this.resolve();
    this.resolved = found ?? '';
    return found;
  }

  private async resolve(): Promise<string | undefined> {
    const result = await this.parts.runner.run({
      command: this.parts.shell,
      args: ['-NoLogo', '-NonInteractive', '-Command', RESOLVE_SCRIPT],
      env: process.env,
      timeoutMs: RESOLVE_TIMEOUT_MS,
    });
    const location = result.stdout.trim();
    if (result.code !== 0 || location === '') {
      this.parts.logger.warn('windows_terminal_absent', { code: result.code });
      return undefined;
    }
    return join(location, 'wt.exe');
  }
}

function titleOf(title: string): string {
  const safe = title.replaceAll(UNSAFE_IN_TITLE, '').slice(0, MAX_TITLE_CHARS).trim();
  return safe === '' ? 'claude' : safe;
}
