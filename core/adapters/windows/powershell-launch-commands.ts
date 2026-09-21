// Starting a session through the owner's PowerShell profile — P4-T2, SEC-PROC-1, SEC-PROC-2, D4.
//
// **Why PowerShell at all, when core can spawn `claude.exe` directly.** D4: the four profile
// functions are where model routing lives, and each one is more than a config directory —
// `claude-isg-ticket` pins `--model "opusplan[1m]"` plus `ANTHROPIC_DEFAULT_OPUS_MODEL` and
// `ANTHROPIC_DEFAULT_SONNET_MODEL`, and `claude-isg-orch` pins a model, an agent and a name. Core
// spawning `claude.exe` with `CLAUDE_CONFIG_DIR` set — which is what it did until this task —
// reproduces one of those four and silently loses the rest. Going through the function is the only
// way the deck starts a session the same way the owner's terminal does.
//
// **The profile must load, so `-NoProfile` is not passed**, and that is the one flag whose absence
// is load-bearing here: with it, none of the four functions exists (measured — RESEARCH.md F.8.1).
// It costs ~135 ms on top of PowerShell's own ~270 ms start, against `--bg`'s 1.3-2.0 s.
//
// **`-ExecutionPolicy Bypass` is deliberately NOT passed either.** The profile loads under the
// machine's `CurrentUser` policy (`RemoteSigned`) because it is a local file, so the flag would
// buy nothing and would be a standing loosening of a control for a case that does not exist.
//
// **Four fixed scripts, one per function, and nothing is composed.** `ProfileFunction` is a closed
// union of four, so this table is exhaustive by type rather than by a check; a reviewer reads all
// four lines and can see there is no interpolation in any of them. The alternative — one template
// with the function name substituted in — would be a command string built from a value, which is
// the shape SEC-PROC-1 exists to keep out of this file even when the value is safe.
//
// `claude-isg-orch` has no `-n`, because the function already passes `-n orchestrator`
// (`pinsSessionName`): a second one would put two on a command line nobody has measured.
import { join } from 'node:path';
import type { ProfileFunction } from '../../../contracts/launch-preset.ts';
import { pinsSessionName } from '../../../contracts/launch-preset.ts';
import type { LaunchCommand, LaunchCommands, LaunchText } from '../../ports/launch-commands.ts';

/** The two variables the scripts read. Named here so the table and the environment cannot drift. */
export const PROMPT_VARIABLE = 'FD_PROMPT';
export const NAME_VARIABLE = 'FD_NAME';

/**
 * One line per profile function — the whole of what PowerShell is asked to do.
 *
 * `$env:FD_PROMPT` is a VALUE in argument mode, not source: it is passed as a single argument
 * whatever is in it, and is never expanded again (F.8.2). That is the entire SEC-PROC-1 mechanism,
 * and it is why there is no quoting, no escaping and nothing to get wrong below.
 */
const SCRIPTS: Readonly<Record<ProfileFunction, string>> = {
  'claude-365': 'claude-365 --bg -n $env:FD_NAME $env:FD_PROMPT',
  'claude-isg': 'claude-isg --bg -n $env:FD_NAME $env:FD_PROMPT',
  'claude-isg-ticket': 'claude-isg-ticket --bg -n $env:FD_NAME $env:FD_PROMPT',
  // No `-n`: the function pins `-n orchestrator` itself.
  'claude-isg-orch': 'claude-isg-orch --bg $env:FD_PROMPT',
};

export class PowerShellLaunchCommands implements LaunchCommands {
  private readonly shell: string;
  private readonly base: Readonly<Record<string, string | undefined>>;

  /**
   * @param shell omit to resolve `powershell.exe` under `%SystemRoot%`; pass a path to name it.
   * Resolved once and by absolute path (SEC-PROC-2) rather than left to `PATH`, because core runs
   * as a logon task and a service's `PATH` is not the interactive one — the lesson `ClaudeInstall`
   * already carries about the npm shim.
   * @param base the environment the child starts from. `CLAUDE_CONFIG_DIR` is deliberately NOT set
   * here: the profile function exports it and removes it again, and core setting it too would be a
   * second opinion about which account a session belongs to (D4).
   */
  constructor(
    shell: string = join(
      process.env['SystemRoot'] ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    ),
    base: Readonly<Record<string, string | undefined>> = process.env,
  ) {
    this.shell = shell;
    this.base = base;
  }

  /**
   * The argv and environment for one launch.
   *
   * `-EncodedCommand` takes base64 of UTF-16LE, which is PowerShell's own contract and is why the
   * script survives quoting rules entirely: what `CreateProcess` sees is one opaque token.
   * `-NonInteractive` so a prompt PowerShell would otherwise sit on becomes a failure rather than
   * a hang; `-NoLogo` because the banner would be the first thing a stdout parser read.
   *
   * @returns `undefined` never, today: the script table is total over the union and the shell is
   * resolved in the constructor. The signature keeps the port's promise so a future shell that
   * cannot be found is a refused launch rather than a throw.
   */
  public forProfile(profileFn: ProfileFunction, text: LaunchText): LaunchCommand | undefined {
    const encoded = Buffer.from(SCRIPTS[profileFn], 'utf16le').toString('base64');
    return {
      command: this.shell,
      args: ['-NoLogo', '-NonInteractive', '-EncodedCommand', encoded],
      env: {
        ...this.base,
        [PROMPT_VARIABLE]: text.prompt,
        // Absent for a function that names itself, so the audit row and the session agree about
        // what the session is called.
        ...(pinsSessionName(profileFn) ? {} : { [NAME_VARIABLE]: text.name }),
      },
    };
  }
}
