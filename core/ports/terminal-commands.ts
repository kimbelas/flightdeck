// Popping a session out into Windows Terminal — P6-T2, SPEC §5.7(4).
//
// A port because the answer is machine-specific and expensive to find: `wt.exe` on `PATH` is an
// AppX execution alias that Node cannot spawn (RESEARCH.md §A), so the real one has to be located
// through `Get-AppxPackage`, which is a PowerShell start. The application layer should not know
// any of that, and a test of "the pane is detached before the terminal opens" must not have to own
// an AppX registry.
import type { SubscriptionId } from '../../contracts/session.ts';
import type { ProcessRequest } from './process-runner.ts';

/** What a pop-out is about. Every field is core's own — nothing here came from a browser. */
export interface PopoutSpec {
  /** The session's SHORT id, which is the form `attach` takes (F.2.1). */
  readonly shortId: string;
  /** Which account it belongs to. The config directory is named from this, server-side. */
  readonly subscription: SubscriptionId;
  /** What the tab is called. Cosmetic, and sanitised — see the adapter. */
  readonly title: string;
  /** Where the tab starts, or `undefined` to leave it to Windows Terminal's own default. */
  readonly cwd: string | undefined;
}

export interface TerminalCommands {
  /**
   * The argv and environment for one pop-out.
   *
   * `undefined` when it cannot be run here: Windows Terminal is not installed, Claude Code is not
   * installed, or the folder carries a character Windows Terminal would re-read as a command
   * separator. All three are refusals rather than errors — the deck says so and the pane stays.
   *
   * Asynchronous, unlike `PtyCommands.forTarget`, because finding the terminal is a process start.
   * The answer is cached for the life of core: an AppX package does not move while it runs, and a
   * button that paid 300 ms every press would be a button somebody stopped using.
   *
   * @throws never.
   */
  popout(spec: PopoutSpec): Promise<ProcessRequest | undefined>;
}
