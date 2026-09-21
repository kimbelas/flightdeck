// The argv for one Ask run — P4-T4, SEC-PROC-1, SEC-PROC-2, SEC-PROC-4, D47.
//
// **This is the one spawn in the codebase that does NOT go through a profile function**, and the
// reason is measured rather than argued. All four functions pass `--dangerously-skip-permissions`
// unconditionally; a headless run started through one reports `permissionMode: "bypassPermissions"`
// however the rest of the command line reads, and `--permission-mode` is not refused — it is
// silently ignored, on all three values (RESEARCH.md F.9.3). SEC-PROC-4 forbids exactly that flag
// on an Ask, and SPEC §5.2 lists permission mode among Ask's own controls, so through a function
// the control is a dropdown that does nothing. Spawning the binary with `CLAUDE_CONFIG_DIR` set
// restores both: measured on the same machine, `--permission-mode plan` reports `plan` and
// `--permission-mode default` reports `default` (F.9.4).
//
// **D4 is not being reopened.** D4 is about which MODEL and which account a SESSION runs under —
// a thing the owner attaches to, steers and comes back to. An Ask is a one-shot headless read with
// its own model, effort, permission mode and budget in the panel that starts it; the profile
// function has nothing left to contribute to it but the flag SEC-PROC-4 bans.
//
// **No PowerShell, so no script and nothing to quote.** The launcher needs a shell because the
// functions live in the profile; this does not, so the prompt is simply one element of an argv
// array handed to `execFile`. That is a stronger position than P4-T2's `$env:FD_PROMPT` rather
// than a weaker one — there is no interpreter between core and the binary at all.
import type { AskRequest } from '../../../contracts/ask-run.ts';
import type { AskCommand, AskCommands } from '../../ports/ask-commands.ts';
import type { ClaudeInstall } from './claude-install.ts';

/**
 * The flags every Ask carries, in one place.
 *
 * `--output-format stream-json` needs `--verbose` in headless mode or the CLI refuses the pair;
 * `--include-partial-messages` is what makes the panel fill as the answer is written rather than
 * all at once at the end. Measured together in F.9.1.
 */
const FIXED_FLAGS: readonly string[] = [
  '-p',
  '--output-format',
  'stream-json',
  '--include-partial-messages',
  '--verbose',
];

export class DirectAskCommands implements AskCommands {
  private readonly install: ClaudeInstall;
  private readonly base: Readonly<Record<string, string | undefined>>;

  constructor(
    install: ClaudeInstall,
    base: Readonly<Record<string, string | undefined>> = process.env,
  ) {
    this.install = install;
    this.base = base;
  }

  /**
   * The argv and environment for one run.
   *
   * The prompt is the LAST element and is never preceded by anything it could be read as an
   * argument to, so a prompt beginning `--model` is a prompt and not a flag. Everything before it
   * is a fixed string or a number this build produced.
   *
   * @returns `undefined` when there is no binary — see the port.
   */
  public forRun(request: AskRequest): AskCommand | undefined {
    const command = this.install.executable;
    if (command === undefined) return undefined;
    return {
      command,
      args: [
        ...FIXED_FLAGS,
        '--permission-mode',
        request.permissionMode,
        // SEC-PROC-4: both are always present, and neither comes off the request unchecked —
        // `askBudgetInRange` has already refused anything outside the ceiling.
        '--max-budget-usd',
        String(request.budgetUsd),
        '--max-turns',
        String(request.maxTurns),
        request.prompt,
      ],
      env: {
        ...this.base,
        // The account, chosen from a closed union rather than named by the browser (SEC-FS-1).
        CLAUDE_CONFIG_DIR: this.install.configDirFor(request.subscription),
      },
      // `''` means core's own directory, which `execFile` spells as absent.
      ...(request.cwd === '' ? {} : { cwd: request.cwd }),
    };
  }
}
