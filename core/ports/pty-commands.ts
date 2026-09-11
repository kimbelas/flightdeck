// What to actually run for a given bind target.
//
// A port because the answer is machine-specific — where `claude.exe` lives, which shell to use —
// and PaneRegistry must be testable without either. It is also the single place where a target
// becomes an argv, which is where SEC-PROC-1 is enforced: arguments are an array, never a string.
import type { PtyTarget } from '../../contracts/pty-protocol.ts';
import type { PtySpec } from './pty-host.ts';

export interface TerminalSize {
  readonly cols: number;
  readonly rows: number;
}

export interface PtyCommands {
  /** `undefined` when the target cannot be run here — a missing binary, say. Never throws. */
  forTarget(target: PtyTarget, size: TerminalSize): PtySpec | undefined;
}
