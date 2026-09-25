// What to actually run to start a session — P4-T2, SEC-PROC-1, SEC-PROC-2.
//
// A port for `PtyCommands`' reason and one more. The answer is machine-specific — where
// `powershell.exe` lives, what the owner's profile defines — so `SessionLauncher` must be testable
// without either. And this is the single place where a launch becomes an argv, which is where
// SEC-PROC-1 is enforced: the script is a fixed literal chosen from a closed set, and the prompt
// and the name never appear in it at all.
//
// **They travel as environment variables**, which is the part that is measured rather than assumed
// (RESEARCH.md F.8.2). A prompt containing spaces, apostrophes, `$`, `;` and `|` arrives at the
// child as ONE argv element, unexpanded and unsplit, because `$env:FD_PROMPT` in PowerShell's
// argument mode is a value rather than source. A prompt that reads like flags —
// `--help --version -p` — arrives as one element too.
import type { ProfileFunction } from '../../contracts/launch-preset.ts';

/** One command, ready for `ProcessRunner`. `cwd` is the caller's to add — it screens the folder. */
export interface LaunchCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** The pieces of text a launch carries. None of them ever reaches a command string. */
export interface LaunchText {
  readonly name: string;
  readonly prompt: string;
  /**
   * `--agent`'s value, or `undefined` for none — P9-T1. A roster name the launcher has already
   * checked, and still carried as a variable rather than composed in: SEC-PROC-1 is about the
   * mechanism, not about how safe today's value happens to be.
   */
  readonly agent: string | undefined;
}

export interface LaunchCommands {
  /**
   * The command for one profile function, or `undefined` when it cannot be run here.
   *
   * @param profileFn one of SEC-PROC-2's four, already narrowed to the union by the route's parser
   * — nothing outside that set can reach this method, which is what makes the script table
   * exhaustive rather than defensive.
   * @returns `undefined` too for an agent on a function that pins one (`pinsAgent`) — there is no
   * line for that, and the launcher refuses it before asking.
   * @throws never.
   */
  forProfile(profileFn: ProfileFunction, text: LaunchText): LaunchCommand | undefined;
}
