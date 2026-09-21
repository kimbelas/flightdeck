// The command one Ask run is, as data — P4-T4, SEC-PROC-1, SEC-PROC-4.
//
// A port for the same reason `LaunchCommands` is one: what ends up on the argv is the security
// control, so it has to be assertable without spawning anything. The adapter is a table plus a
// config directory; the test that matters reads the array it returns.
import type { AskRequest } from '../../contracts/ask-run.ts';

export interface AskCommand {
  /** The binary, by absolute path (SEC-PROC-2) — never a name left to `PATH`. */
  readonly command: string;
  /** An array, always. No command strings anywhere (SEC-PROC-1). */
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The screened folder to start in, or absent for core's own. */
  readonly cwd?: string;
}

export interface AskCommands {
  /**
   * The command for one run.
   *
   * @returns `undefined` when there is no binary to run — `claude.exe` genuinely disappears during
   * an npm update (RESEARCH.md F.1.5), and that is a refusal the owner can read (`no_claude`),
   * not a spawn failure to discover afterwards.
   */
  forRun(request: AskRequest): AskCommand | undefined;
}
