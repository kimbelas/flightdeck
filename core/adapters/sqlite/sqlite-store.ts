// The durable store, on `node:sqlite` — P1-T8, D9, SEC-DATA-1, SEC-DATA-3.
//
// **Every statement is prepared once and parameterised** (SEC-DATA-3). No query is built by string
// concatenation anywhere in this file, including the `LIMIT`s — a number is still a parameter.
//
// **Synchronous, because `node:sqlite` is** (R17). The port already argues this; the thing to know
// here is that it means no `await` can interleave between reading `id` and returning the row, so
// the id contract needs no lock.
//
// **A payload is capped, not trusted.** A hook body may be 4 MB (`limits.ts`) and one arrives per
// turn per session, so storing every one verbatim forever is unbounded growth in the one file that
// is never deleted. Over the cap, the row keeps a marker saying how big the payload was instead of
// the payload — which is honest, and which a fixture capture can still see the shape of. The cap is
// far above every payload in `fixtures/hooks/`.
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AuditRow, DraftAuditRow } from '../../../contracts/audit-row.ts';
import { MAX_CONFIG_SNAPSHOTS } from '../../../contracts/config-snapshot.ts';
import type { DraftEvent, FdEvent } from '../../../contracts/fd-event.ts';
import type { LaunchPreset } from '../../../contracts/launch-preset.ts';
import { projectKey, type ProjectRecord } from '../../../contracts/project.ts';
import type { SubscriptionId } from '../../../contracts/session.ts';
import type { DraftVitalsSnapshot, VitalsSnapshot } from '../../../contracts/vitals-snapshot.ts';
import {
  MAX_SESSION_MUTES,
  type ConfigSnapshot,
  type DraftConfigSnapshot,
  type MutedSession,
  type Store,
  type TranscriptIndexBatch,
} from '../../ports/store.ts';
import type { TranscriptCursor } from '../../ports/transcript-file.ts';
import type { SearchHit } from '../../../contracts/transcript-search.ts';
import {
  toAudit,
  toConfigSnapshot,
  toEvent,
  toMutedSession,
  capped,
  toPreset,
  toProject,
  toSnapshot,
} from './rows.ts';
import { migrate, versionOf, PRAGMAS } from './schema.ts';
import { SqliteTranscriptIndex } from './sqlite-transcript-index.ts';
import {
  prepareConfigStatements,
  prepareMuteStatements,
  preparePresetStatements,
  prepareProjectStatements,
  type ConfigStatements,
  type MuteStatements,
  type PresetStatements,
  type ProjectStatements,
} from './statements.ts';

/**
 * The largest payload kept verbatim, in JSON characters.
 *
 * 256 KB: sixteen times the largest hook payload captured in `fixtures/hooks/`, and one sixteenth
 * of what `limits.ts` will accept over the wire. A cap that is never reached costs nothing; the
 * absence of one is a file that grows without a ceiling.
 */
export const MAX_PAYLOAD_CHARS = 262_144;

/** What replaces a payload too large to keep. Deliberately a shape, so a reader is not guessing. */
export interface TruncatedPayload {
  readonly truncated: true;
  readonly chars: number;
}

export class SqliteStore implements Store {
  private readonly db: DatabaseSync;
  private readonly insertEvent: StatementSync;
  private readonly selectSince: StatementSync;
  private readonly selectForSession: StatementSync;
  private readonly insertAudit: StatementSync;
  private readonly selectAudit: StatementSync;
  private readonly insertSnapshot: StatementSync;
  private readonly selectSnapshots: StatementSync;
  /**
   * The registry's four, grouped — P3-T1.
   *
   * One field rather than four beside the others, because the constructor has a forty-line limit
   * and because these differ in kind from everything above: the logs are append-and-page, while
   * this table is keyed, upserted and deleted from. Grouping them says which is which.
   */
  private readonly projectRows: ProjectStatements;
  /** The preset table's five, grouped for the same reason — P4-T1. */
  private readonly presetRows: PresetStatements;
  /** The config history's three — P3-T7. */
  private readonly configRows: ConfigStatements;
  private readonly muteRows: MuteStatements;
  /** The search index — P7-T1, the widening the port predicted. Its own class; see below. */
  private readonly index: SqliteTranscriptIndex;

  /**
   * Opens (and creates) the store, applying any migrations it is behind on.
   *
   * @param path the database file. Its directory is created if missing — core may be the first
   * thing to run after an install, and a store that refused to open because `%LOCALAPPDATA%\
   * flightdeck` did not exist yet would be a worse first impression than a directory.
   * @throws if the file cannot be opened or a migration fails. Both are conditions core must not
   * start under: an event log nobody can write to is worse silent than loud.
   */
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    // The handle is open before anything below can fail, and a constructor that throws returns no
    // object for anyone to `close()` — so it is closed here or it is leaked for the life of the
    // process. On Windows that is not merely untidy: a leaked handle makes the FILE undeletable,
    // which is how the test for this failed its own cleanup rather than its assertion.
    try {
      for (const pragma of PRAGMAS) this.db.exec(pragma);
      migrate(this.db);
    } catch (cause) {
      this.db.close();
      throw cause;
    }
    this.insertEvent = this.db.prepare(
      `INSERT INTO events (at, session_id, subscription, source, type, payload)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.selectSince = this.db.prepare(`SELECT * FROM events WHERE id > ? ORDER BY id LIMIT ?`);
    this.selectForSession = this.db.prepare(
      `SELECT * FROM events WHERE session_id = ? AND id > ? ORDER BY id LIMIT ?`,
    );
    this.insertAudit = this.db.prepare(
      `INSERT INTO audit (at, who, action, target, args, outcome, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.selectAudit = this.db.prepare(`SELECT * FROM audit WHERE id > ? ORDER BY id LIMIT ?`);
    this.insertSnapshot = this.db.prepare(
      `INSERT INTO vitals_snapshots
         (at, session_id, subscription, used_percentage, context_window, cost_usd, model_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    // Newest first here, reversed by the caller — see the port's note on why both halves are right.
    this.selectSnapshots = this.db.prepare(
      `SELECT * FROM vitals_snapshots WHERE session_id = ? ORDER BY id DESC LIMIT ?`,
    );
    this.projectRows = prepareProjectStatements(this.db);
    this.presetRows = preparePresetStatements(this.db);
    this.configRows = prepareConfigStatements(this.db);
    this.muteRows = prepareMuteStatements(this.db);
    this.index = new SqliteTranscriptIndex(this.db);
  }

  /** The schema version this file is at. `flightdeck-core status` prints it (P1-T12). */
  public get version(): number {
    return versionOf(this.db);
  }

  public appendEvent(event: DraftEvent): FdEvent {
    const result = this.insertEvent.run(
      event.at,
      event.sessionId,
      event.subscription,
      event.source,
      event.type,
      encodePayload(event.payload),
    );
    return { ...event, id: Number(result.lastInsertRowid) };
  }

  public eventsSince(since: number, limit: number): readonly FdEvent[] {
    return this.selectSince.all(since, capped(limit)).map(toEvent);
  }

  public eventsForSession(sessionId: string, since: number, limit: number): readonly FdEvent[] {
    return this.selectForSession.all(sessionId, since, capped(limit)).map(toEvent);
  }

  public appendAudit(row: DraftAuditRow): AuditRow {
    const result = this.insertAudit.run(
      row.at,
      row.who,
      row.action,
      row.target,
      JSON.stringify(row.args),
      row.outcome,
      row.reason ?? null,
    );
    return { ...row, id: Number(result.lastInsertRowid) };
  }

  public auditSince(since: number, limit: number): readonly AuditRow[] {
    return this.selectAudit.all(since, capped(limit)).map(toAudit);
  }

  public appendSnapshot(snapshot: DraftVitalsSnapshot): VitalsSnapshot {
    const result = this.insertSnapshot.run(
      snapshot.at,
      snapshot.sessionId,
      snapshot.subscription,
      snapshot.usedPercentage ?? null,
      snapshot.contextWindowSize ?? null,
      snapshot.costUsd ?? null,
      snapshot.modelId ?? null,
    );
    return { ...snapshot, id: Number(result.lastInsertRowid) };
  }

  public snapshotsForSession(sessionId: string, limit: number): readonly VitalsSnapshot[] {
    return this.selectSnapshots.all(sessionId, capped(limit)).map(toSnapshot).reverse();
  }

  /** The row is read back rather than echoed: `imported_at` is not overwritten by a re-import. */
  public rememberProject(project: ProjectRecord): ProjectRecord {
    const key = projectKey(project.path);
    this.projectRows.upsert.run(key, project.path, project.name, project.importedAt);
    return toProject(this.projectRows.selectOne.get(key));
  }

  public projects(): readonly ProjectRecord[] {
    return this.projectRows.selectAll.all().map(toProject);
  }

  /** The project row and its presets, in that order. The answer is about the PROJECT row. */
  public forgetProject(path: string): boolean {
    const key = projectKey(path);
    const removed = this.projectRows.remove.run(key).changes > 0;
    this.presetRows.removeForProject.run(key);
    return removed;
  }

  /** Read back rather than echoed, exactly as `rememberProject` is. */
  public savePreset(preset: LaunchPreset): LaunchPreset {
    this.presetRows.upsert.run(
      preset.projectKey,
      preset.id,
      preset.name,
      preset.profileFn,
      preset.cwd,
      preset.sessionName,
      preset.promptSource,
      preset.prompt,
      preset.group ?? null,
      preset.agent ?? null,
    );
    return toPreset(this.presetRows.selectOne.get(preset.projectKey, preset.id));
  }

  public savedPresets(): readonly LaunchPreset[] {
    return this.presetRows.selectAll.all().map(toPreset);
  }

  public forgetPreset(projectKeyValue: string, id: string): boolean {
    return this.presetRows.remove.run(projectKeyValue, id).changes > 0;
  }

  /** Appended and pruned in one call, so the bound cannot be forgotten at a call site. */
  public rememberConfigSnapshot(snapshot: DraftConfigSnapshot): ConfigSnapshot {
    this.configRows.insert.run(
      snapshot.projectKey,
      snapshot.takenAt,
      JSON.stringify(snapshot.digest),
    );
    this.configRows.prune.run(snapshot.projectKey, snapshot.projectKey, MAX_CONFIG_SNAPSHOTS);
    return this.configSnapshots(snapshot.projectKey, 1)[0] ?? { ...snapshot, id: 0 };
  }

  public configSnapshots(projectKeyValue: string, limit: number): readonly ConfigSnapshot[] {
    return this.configRows.selectLatest.all(projectKeyValue, limit).map(toConfigSnapshot);
  }

  /** Written and pruned in one call, so the bound cannot be forgotten at a call site. */
  public muteSession(subscription: SubscriptionId, sessionId: string, at: number): void {
    this.muteRows.upsert.run(subscription, sessionId, at);
    this.muteRows.prune.run(MAX_SESSION_MUTES);
  }

  public unmuteSession(subscription: SubscriptionId, sessionId: string): boolean {
    return this.muteRows.remove.run(subscription, sessionId).changes > 0;
  }

  public mutedSessions(): readonly MutedSession[] {
    return this.muteRows.selectAll.all().map(toMutedSession);
  }

  /** The search index's three, delegated — P7-T1. See `SqliteTranscriptIndex` for the split. */
  public transcriptCursor(path: string): TranscriptCursor | undefined {
    return this.index.transcriptCursor(path);
  }

  public indexTranscript(batch: TranscriptIndexBatch): void {
    this.index.indexTranscript(batch);
  }

  public searchTranscripts(match: string, limit: number): readonly SearchHit[] {
    return this.index.searchTranscripts(match, limit);
  }

  /** Closes the handle. Idempotent, because shutdown is (main.ts `stopCore`). */
  public close(): void {
    if (this.db.isOpen) this.db.close();
  }
}

/**
 * A payload as TEXT, or a marker when it is too big to keep.
 *
 * `undefined` and a value that cannot be stringified both become SQL `NULL`. The second is not
 * theoretical — `payload` is `unknown` by contract, and a circular object would otherwise throw
 * inside `appendEvent`, which is on the hook path.
 */
function encodePayload(payload: unknown): string | null {
  // `unknown`, not `string`: TypeScript types `JSON.stringify` as returning a string, and it
  // returns `undefined` for `undefined`, a function and a symbol. `payload` is `unknown` by
  // contract, so all three can arrive here and the declared type is the thing that is wrong.
  let text: unknown;
  try {
    text = JSON.stringify(payload);
  } catch {
    return null;
  }
  if (typeof text !== 'string') return null;
  if (text.length <= MAX_PAYLOAD_CHARS) return text;
  const marker: TruncatedPayload = { truncated: true, chars: text.length };
  return JSON.stringify(marker);
}
