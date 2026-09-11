// Durable local state — the `events` and `audit` tables (BUILD-PLAN.md §3).
//
// **Synchronous on purpose.** `node:sqlite` has no async API (SPEC §13, R17), so a `Promise`-
// returning signature here would be a lie that every caller pays for: it would make the reconciler
// and the hooks queue async for a call that never yields, and `await`s that cannot interleave are
// worse than none — they suggest a concurrency that does not exist. The adapter is a local file on
// the same machine; when something here becomes slow, it becomes a queue, not a promise.
//
// **Sessions are not in here.** Derived flags are computed from events and never stored as truth
// (BUILD-PLAN §3), and the live session set is the reconciler's, held in memory and rebuilt from
// `agents --json` on every sweep. What survives a restart is what was *observed* — which is the
// events — not what was concluded from it.
//
// This is what P1 needs. The FTS5 index and transcript excerpts are P7 and widen this interface
// then, against a task that knows what it is searching for.
import type { AuditRow, DraftAuditRow } from '../../contracts/audit-row.ts';
import type { DraftEvent, FdEvent } from '../../contracts/fd-event.ts';

export interface Store {
  /**
   * Appends one event and returns it with the id it was given.
   *
   * Ids are monotonic and gapless within one store, because `since=` paging depends on it: a
   * consumer that asks for everything after 41 must not be able to miss 42.
   *
   * @throws if the store cannot be written. Losing an event silently is worse than a loud failure
   * — the event log is the only durable record of what happened.
   */
  appendEvent(event: DraftEvent): FdEvent;

  /** Events after `since`, oldest first, at most `limit`. `since: 0` means from the beginning. */
  eventsSince(since: number, limit: number): readonly FdEvent[];

  /** The same, narrowed to one session — `GET /sessions/:id/events?since=`. */
  eventsForSession(sessionId: string, since: number, limit: number): readonly FdEvent[];

  /** Appends one audit row (SEC-PROC-3) and returns it with its id. @throws as `appendEvent`. */
  appendAudit(row: DraftAuditRow): AuditRow;

  /** Audit rows after `since`, oldest first, at most `limit`. */
  auditSince(since: number, limit: number): readonly AuditRow[];
}
