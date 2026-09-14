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
// **Vitals snapshots are the one exception, and they are not a contradiction of it.** A snapshot is
// an observation too: "at this instant the context was 62 % and the cost was $4.10". What the store
// still refuses to hold is a conclusion — no flags, no `live`, no derived state. The series exists
// because the burn-rate and sparkline readings are questions no registry of "now" can answer
// (contracts/vitals-snapshot.ts, SPEC §5.4/§5.5).
//
// This is what P1 needs. The FTS5 index and transcript excerpts are P7 and widen this interface
// then, against a task that knows what it is searching for.
import type { AuditRow, DraftAuditRow } from '../../contracts/audit-row.ts';
import type { DraftEvent, FdEvent } from '../../contracts/fd-event.ts';
import type { DraftVitalsSnapshot, VitalsSnapshot } from '../../contracts/vitals-snapshot.ts';

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

  /** Appends one vitals snapshot and returns it with its id. @throws as `appendEvent`. */
  appendSnapshot(snapshot: DraftVitalsSnapshot): VitalsSnapshot;

  /**
   * One session's snapshots, **oldest first**, at most `limit` — the most RECENT `limit` of them.
   *
   * The two halves of that are not a contradiction and the ordering is what a chart needs: a
   * sparkline plots left to right and wants the last hour, not the first. Taking the newest and
   * handing them back in time order is the only combination that is useful, and doing it here
   * rather than in every caller keeps the `ORDER BY` off the hot path of the deck.
   */
  snapshotsForSession(sessionId: string, limit: number): readonly VitalsSnapshot[];
}
