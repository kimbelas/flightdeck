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
//
// **A second table, for a preset that names an agent (P9-T1)**, and it is three lines rather than
// four for the same reason: `claude-isg-orch` pins `--agent orchestrator` (`pinsAgent`), so there is
// no line that would give it a second one. `$env:FD_AGENT` is read in argument mode like the other
// two — the name is a roster name screened by shape, and it is STILL not composed into the script,
// because SEC-PROC-1 is a rule about the mechanism rather than about the value.
import { join } from 'node:path';
import type { ProfileFunction } from '../../../contracts/launch-preset.ts';
import { pinsSessionName } from '../../../contracts/launch-preset.ts';
import type { LaunchCommand, LaunchCommands, LaunchText } from '../../ports/launch-commands.ts';

/** The two variables the scripts read. Named here so the table and the environment cannot drift. */
export const PROMPT_VARIABLE = 'FD_PROMPT';
export const NAME_VARIABLE = 'FD_NAME';
/** `--agent`'s value (P9-T1). Set only when the preset names one. */
export const AGENT_VARIABLE = 'FD_AGENT';

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

/** The functions that do not pin an agent — the only ones a preset agent may reach (P9-T1). */
type AgentlessFunction = Exclude<ProfileFunction, 'claude-isg-orch'>;

/**
 * The same three lines with `--agent` — chosen only when the launch carries one.
 *
 * The flag goes before `-n` and the prompt last, the order the docs' own example uses
 * (`claude --agent <name> --bg "<prompt>"`); the prompt is the one positional, so it stays last.
 */
const AGENT_SCRIPTS: Readonly<Record<AgentlessFunction, string>> = {
  'claude-365': 'claude-365 --bg --agent $env:FD_AGENT -n $env:FD_NAME $env:FD_PROMPT',
  'claude-isg': 'claude-isg --bg --agent $env:FD_AGENT -n $env:FD_NAME $env:FD_PROMPT',
  'claude-isg-ticket':
    'claude-isg-ticket --bg --agent $env:FD_AGENT -n $env:FD_NAME $env:FD_PROMPT',
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
   * @returns `undefined` only for an agent on the function that pins one — there is no line for it
   * (`pinsAgent`), and the launcher refuses that case before it asks. The shell is resolved in the
   * constructor, so a future shell that cannot be found is a refused launch rather than a throw.
   */
  public forProfile(profileFn: ProfileFunction, text: LaunchText): LaunchCommand | undefined {
    const script = scriptFor(profileFn, text.agent);
    if (script === undefined) return undefined;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    return {
      command: this.shell,
      args: ['-NoLogo', '-NonInteractive', '-EncodedCommand', encoded],
      env: {
        ...this.base,
        [PROMPT_VARIABLE]: text.prompt,
        // Absent for a function that names itself, so the audit row and the session agree about
        // what the session is called.
        ...(pinsSessionName(profileFn) ? {} : { [NAME_VARIABLE]: text.name }),
        // Absent without an agent: only the agent line reads it, and that line is chosen by
        // `text.agent` alone.
        ...(text.agent === undefined ? {} : { [AGENT_VARIABLE]: text.agent }),
      },
    };
  }
}

/** The fixed line for this launch, or `undefined` for an agent on a function that pins one. */
function scriptFor(profileFn: ProfileFunction, agent: string | undefined): string | undefined {
  if (agent === undefined) return SCRIPTS[profileFn];
  // `pinsAgent`'s one function, spelled as the literal so the compiler narrows to the three.
  if (profileFn === 'claude-isg-orch') return undefined;
  return AGENT_SCRIPTS[profileFn];
}
