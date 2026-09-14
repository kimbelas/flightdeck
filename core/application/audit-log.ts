// Every mutating action, written down — SEC-PROC-3, CODING-STANDARDS §11.5, P1-T8.
//
// **A collaborator rather than a direct `Store` call, for the same reason `StoringEventSink` is
// one.** `Store.appendAudit` throws, and the callers are use cases in the middle of doing the
// thing being audited — a launcher that failed to start a session because the log write failed
// would be the audit trail causing the incident it exists to record.
//
// **A failed audit write does not fail the action, and that is a decision rather than an
// oversight.** "Fail closed" in SECURITY.md §11.6 is about requests — a missing token, an unknown
// Origin, an oversize body — where refusing costs nothing. This is a single-user local tool on the
// owner's own machine, and refusing to launch their session because a row could not be written
// would be a worse failure than the missing row. It is logged at `error`, and `dropped` is a
// number `doctor` surfaces (P1-T12).
//
// **`who` is a constant today.** There is exactly one credential (SEC-HTTP-3), so writing anything
// else would be inventing precision. The field exists so a second one is not a schema migration —
// which is the whole argument in `contracts/audit-row.ts`.
import type { AuditOutcome, DraftAuditRow } from '../../contracts/audit-row.ts';
import type { Clock } from '../ports/clock.ts';
import type { Logger } from '../ports/logger.ts';
import type { Store } from '../ports/store.ts';

/** The one credential there is (SEC-HTTP-3). See the header. */
export const CORE_TOKEN_ACTOR = 'core-token';

export interface AuditEntry {
  readonly action: string;
  readonly target: string;
  readonly args: readonly string[];
  readonly outcome: AuditOutcome;
  readonly reason?: string;
}

export class AuditLog {
  private readonly store: Store;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private writtenCount = 0;
  private droppedCount = 0;

  constructor(store: Store, clock: Clock, logger: Logger) {
    this.store = store;
    this.clock = clock;
    this.logger = logger;
  }

  public get written(): number {
    return this.writtenCount;
  }

  /** Rows that could not be written. Non-zero means the audit trail has holes in it. */
  public get dropped(): number {
    return this.droppedCount;
  }

  /**
   * Records one action. @throws never — see the header.
   *
   * `reason` is for a person to read and is rendered in the UI, so it must never carry the prompt,
   * the token or model text (SEC-UI-2, SEC-DATA-2). Callers pass a short phrase, not an exception.
   */
  public record(entry: AuditEntry): void {
    const row: DraftAuditRow = {
      at: this.clock.now().getTime(),
      who: CORE_TOKEN_ACTOR,
      action: entry.action,
      target: entry.target,
      args: entry.args,
      outcome: entry.outcome,
      reason: entry.reason,
    };
    try {
      this.store.appendAudit(row);
      this.writtenCount += 1;
    } catch (cause) {
      this.droppedCount += 1;
      this.logger.error('audit_write_failed', {
        action: entry.action,
        outcome: entry.outcome,
        reason: cause instanceof Error ? cause.message : 'unknown',
      });
    }
  }
}
