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

/**
 * Where an imported folder actually is — P6-T1.
 *
 * A shell pane names its project by `projectKey` and core turns that into a directory. It is
 * a port rather than `ProjectRegistry` itself for the usual reason, and it is SYNCHRONOUS for
 * a specific one: `forTarget` is not async and must not become so. The registry holds every
 * imported project in memory and each path was canonicalised when it was imported, so there
 * is nothing to await — this is a `Map` lookup wearing an interface.
 *
 * **It answers with a stored path, never one composed from the key.** A key nobody imported
 * is `undefined`, which refuses the pane (SEC-FS-1, D26).
 */
export interface ProjectRoots {
  rootFor(projectKeyValue: string): string | undefined;
}
