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
// **The FTS5 index and the transcript excerpts are the P7 widening this file predicted** (P7-T1).
// They are observations too — "this was said, at this instant, in this session" — and they are the
// one thing in here that holds the owner's prose, which is what SEC-DATA-1 is about. The three
// methods at the bottom are all of it: where the indexer got to in one file, what it read, and the
// query. Nothing else in core may write to that table.
// **The project registry is the one thing in here that is not an observation** (P3-T1). Everything
// above is append-only: what happened, in the order it happened. A project row is a standing
// permission — it is what widens `ReadPolicy`'s allowlist — so it is keyed, it is replaceable and
// it can be taken away, and `forgetProject` really has to remove it rather than write a tombstone
// the next reader might miss. That is a different kind of state, and it is admitted here rather
// than smuggled in as an event whose absence somebody has to compute.
import type { AuditRow, DraftAuditRow } from '../../contracts/audit-row.ts';
import type { ConfigDigest } from '../../contracts/config-snapshot.ts';
import type { LaunchPreset } from '../../contracts/launch-preset.ts';
import type { DraftEvent, FdEvent } from '../../contracts/fd-event.ts';
import type { ProjectRecord } from '../../contracts/project.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import type { TranscriptProse } from '../../contracts/transcript-prose.ts';
import type { SearchHit } from '../../contracts/transcript-search.ts';
import type { DraftVitalsSnapshot, VitalsSnapshot } from '../../contracts/vitals-snapshot.ts';
import type { TranscriptCursor } from './transcript-file.ts';

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

  /**
   * Records an imported project, keyed by `projectKey(project.path)` — P3-T1, SEC-FS-1.
   *
   * Idempotent by construction: importing a folder that is already held replaces its row rather
   * than adding a second one, because the folder is the identity. The stored record is returned,
   * which is not always the one passed in — see `ProjectRegistry.import` for why the original
   * `importedAt` is the one that survives.
   *
   * @throws if the store cannot be written. A permission that was reported as granted and was not
   * recorded is worse silent than loud.
   */
  rememberProject(project: ProjectRecord): ProjectRecord;

  /** Every imported project, newest first. Empty until the owner imports one (D26). */
  projects(): readonly ProjectRecord[];

  /**
   * Removes one project by path, canonical or not, **and every preset filed under it**.
   *
   * The cascade is here rather than in `ProjectRegistry` because it is one storage concern and
   * because the alternative is a caller that has to remember: a preset names a folder to start a
   * session in, and a folder that is no longer imported is one core may not read (SEC-FS-1). An
   * orphaned launch button is worse than an absent one.
   *
   * @returns whether a PROJECT row was actually removed, so the caller can tell "withdrawn" from
   * "was never there" — they are different audit rows and different things to say in the deck.
   * Presets going with it does not change that answer.
   * @throws as `rememberProject`.
   */
  forgetProject(path: string): boolean;

  /**
   * Records one launch preset, keyed by `(projectKey, id)` — P4-T1.
   *
   * Idempotent by construction, exactly as `rememberProject` is: the id is derived from the name
   * (`presetId`), so saving `ticket` twice replaces the row rather than adding a second one — and
   * saving one called `ticket` is how the built-in of that name is shadowed.
   *
   * @returns the stored record, read back rather than echoed.
   * @throws if the store cannot be written.
   */
  savePreset(preset: LaunchPreset): LaunchPreset;

  /**
   * Every SAVED preset, across every project, ordered by project then name.
   *
   * The built-ins are not in here and never will be: they are computed from the project and the
   * four profile functions on every request (`PresetCatalogue`), so nothing is seeded into the
   * owner's database when a folder is imported. Every row this answers with has `builtIn: false`.
   */
  savedPresets(): readonly LaunchPreset[];

  /**
   * Removes one saved preset. A built-in cannot be removed — there is no row to remove.
   *
   * @param projectKeyValue `projectKey(path)`, already canonical.
   * @returns whether a row was removed.
   * @throws as `savePreset`.
   */
  forgetPreset(projectKeyValue: string, id: string): boolean;

  /**
   * Records one folder's configuration as it was at this instant — P3-T7.
   *
   * An observation, which is what everything in here except the registry is: "at this instant the
   * `.claude` of this folder held these hooks, these agents and these rules". It is written only
   * when the digest MOVES, so the table is a history of changes rather than a log of reads — the
   * map is re-read every time the deck loads, and a row per read would be a table that grows with
   * attention rather than with events.
   *
   * @returns the stored snapshot, read back rather than echoed.
   * @throws if the store cannot be written.
   */
  rememberConfigSnapshot(snapshot: DraftConfigSnapshot): ConfigSnapshot;

  /**
   * The most recent snapshots of one folder's configuration, newest first.
   *
   * Two is what the historian asks for: the current configuration and the one it replaced, which
   * is what a diff is. More than two is the history, and P7's analytics is where that is drawn.
   *
   * @param projectKeyValue `projectKey(path)`, already canonical.
   */
  configSnapshots(projectKeyValue: string, limit: number): readonly ConfigSnapshot[];

  /**
   * Silences this session's toasts until it is unmuted — P6-T3, SPEC §5.5.
   *
   * Another of the things in here that is not an observation, alongside the project registry and
   * the presets, and for the same reasons: a mute is a standing decision by the owner, it is
   * keyed, and `unmuteSession` has to really remove the row rather than write a tombstone the next
   * reader might miss. What makes it belong in the store at all rather than in the deck is that
   * core raises the toast with no browser open (D16) — a mute that lived in a page would be one
   * core could not read.
   *
   * Idempotent: muting a muted session moves `muted_at` and adds no row. Pruned to
   * `MAX_SESSION_MUTES` in the same call, because a session id dies with its session and nothing
   * else would ever bound this table.
   *
   * @throws if the store cannot be written. A mute reported as set and not recorded is a toast the
   * owner will be surprised by at 2 a.m.
   */
  muteSession(subscription: SubscriptionId, sessionId: string, at: number): void;

  /** @returns whether a row was actually removed. @throws as `muteSession`. */
  unmuteSession(subscription: SubscriptionId, sessionId: string): boolean;

  /** Every muted session, newest mute first. Empty until the owner mutes one. */
  mutedSessions(): readonly MutedSession[];

  /**
   * Where the indexer got to in one transcript, or `undefined` for one it has never read — P7-T1.
   *
   * A `TranscriptCursor`, not a number, and for the reason `core/ports/transcript-file.ts` gives:
   * a transcript is deleted after thirty days and a resumed session writes a fresh file at the
   * same path, so "the file is 40 KB and I have read 60 KB" and "the file is 80 KB and it is a
   * different file" are both real and only the second is invisible to arithmetic.
   */
  transcriptCursor(path: string): TranscriptCursor | undefined;

  /**
   * Records what was read out of one transcript, and where reading stopped.
   *
   * **One transaction, because half of it is a lie.** Excerpts written without their cursor are
   * indexed twice on the next pass; a cursor written without its excerpts is text that is never
   * searchable and never read again.
   *
   * @param restarted the file was replaced or shrank, so everything already indexed from it is
   * about a transcript that no longer exists. The store DELETES those rows before inserting —
   * the alternative is a search that returns a conversation from a session the owner resumed
   * away from, which reads as a bug in the search rather than in the index.
   * @throws if the store cannot be written. An index that silently stopped growing is a search
   * that silently stops finding.
   */
  indexTranscript(batch: TranscriptIndexBatch): void;

  /**
   * The sessions whose transcripts match `match`, best first, at most `limit`.
   *
   * @param match an FTS5 MATCH expression built by `toMatchExpression`, never a raw typed query:
   * FTS5 has a grammar, and a `"` somebody typed is a syntax error rather than a search
   * (contracts/transcript-search.ts).
   * @returns at most one hit per session — the gate asks "where did I do that", and the answer is
   * a conversation to go back to rather than forty lines from inside one.
   */
  searchTranscripts(match: string, limit: number): readonly SearchHit[];
}

/** What one pass over one transcript read — P7-T1. See `Store.indexTranscript`. */
export interface TranscriptIndexBatch {
  /** The transcript's full path. The key of the cursor row, and never displayed (SEC-DATA-2). */
  readonly path: string;
  readonly subscription: SubscriptionId;
  /** The session the transcript belongs to — its filename, which is the session's uuid. */
  readonly sessionId: string;
  /** The slug folder the transcript sits in. P7-T2's project filter, without a second read. */
  readonly projectKey: string;
  /** Where reading stopped. Always a record boundary — see the migration for why. */
  readonly cursor: TranscriptCursor;
  readonly at: number;
  readonly restarted: boolean;
  readonly excerpts: readonly TranscriptProse[];
}

/**
 * How many mutes are kept.
 *
 * 500, which is far more sessions than the owner has ever had at once and small enough that the
 * whole set is read into memory on boot (`MuteBook`). The bound exists because the key is a
 * session id: it dies with its session, so without one this table grows with every session ever
 * muted and never shrinks.
 */
export const MAX_SESSION_MUTES = 500;

/** One muted session. Two ids, because one of them is not unique on its own (`sessionKey`). */
export interface MutedSession {
  readonly subscription: SubscriptionId;
  readonly sessionId: string;
  readonly mutedAt: number;
}

/** One snapshot before it has been stored — the id and nothing else is missing. */
export interface DraftConfigSnapshot {
  readonly projectKey: string;
  readonly takenAt: number;
  readonly digest: ConfigDigest;
}

export interface ConfigSnapshot extends DraftConfigSnapshot {
  readonly id: number;
}
