// One row per mutating action — SEC-PROC-3, CODING-STANDARDS §11.5.
//
// A contract rather than a log line because audit rows are **visible in the UI**. The log answers
// an operator reading a file; this answers the person looking at the deck and asking "what did
// Flightdeck just do to my session, and did it work?".
//
// `args` is the argv as it was actually run, not a paraphrase — the point of the row is to be able
// to read back the exact command, and SEC-PROC-1 keeps it an array everywhere else for the same
// reason a string would be wrong here.
export type AuditOutcome = 'ok' | 'refused' | 'failed';
export const AUDIT_OUTCOMES: readonly AuditOutcome[] = ['ok', 'refused', 'failed'];

/** An action as its caller describes it, before the store gives it a place in the sequence. */
export interface DraftAuditRow {
  /** Epoch ms, taken from a `Clock`. */
  readonly at: number;
  /**
   * Who asked — the token id (§11.5). There is exactly one token today (SEC-HTTP-3), so P1 writes
   * a constant; the field exists so that a second credential is not a schema migration.
   */
  readonly who: string;
  /** What was attempted: `launch`, `stop`, `rm`, `respawn`, `resume`, `rename`, `connect`. */
  readonly action: string;
  /** What it was attempted on — a session id, a subscription, a settings file path. */
  readonly target: string;
  readonly args: readonly string[];
  readonly outcome: AuditOutcome;
  /**
   * Why, when the outcome is not `ok`. A short reason for a person to read.
   *
   * Never the token, a prompt, or model text: this is rendered in the UI and the whole row is
   * kept forever (SEC-DATA-2, SEC-UI-2).
   */
  readonly reason: string | undefined;
}

/** A stored audit row. `id` is monotonic within one store. */
export interface AuditRow extends DraftAuditRow {
  readonly id: number;
}
