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
import type { DraftEvent, FdEvent } from '../../../contracts/fd-event.ts';
import { projectKey, type ProjectRecord } from '../../../contracts/project.ts';
import type { DraftVitalsSnapshot, VitalsSnapshot } from '../../../contracts/vitals-snapshot.ts';
import type { Store } from '../../ports/store.ts';
import { asRecord, toAudit, toEvent, toProject, toSnapshot } from './rows.ts';
import { MIGRATIONS, PRAGMAS } from './schema.ts';

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

/** The project registry's statements — P3-T1. See the field they are held in. */
interface ProjectStatements {
  readonly upsert: StatementSync;
  readonly selectAll: StatementSync;
  readonly selectOne: StatementSync;
  readonly remove: StatementSync;
}

/**
 * The one UPSERT in the file, and three around it.
 *
 * The reason for `ON CONFLICT` is in the port: a project is keyed by its folder, so re-importing
 * one has to be the same row. `DO UPDATE` rather than `DO NOTHING`, and `imported_at` deliberately
 * left out of the update — the path and the name are re-displayed in whatever casing the
 * filesystem now uses, while "when did I add this" survives, because a second click on the same
 * folder is not a second decision.
 *
 * `selectAll` orders newest first, then by key, so two folders imported in the same millisecond
 * still have an order: a list that reshuffles between reads is one the deck cannot key a React row
 * from.
 */
function prepareProjectStatements(db: DatabaseSync): ProjectStatements {
  return {
    upsert: db.prepare(
      `INSERT INTO projects (path_key, path, name, imported_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(path_key) DO UPDATE SET path = excluded.path, name = excluded.name`,
    ),
    selectAll: db.prepare(`SELECT * FROM projects ORDER BY imported_at DESC, path_key`),
    selectOne: db.prepare(`SELECT * FROM projects WHERE path_key = ?`),
    remove: db.prepare(`DELETE FROM projects WHERE path_key = ?`),
  };
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

  public forgetProject(path: string): boolean {
    return this.projectRows.remove.run(projectKey(path)).changes > 0;
  }

  /** Closes the handle. Idempotent, because shutdown is (main.ts `stopCore`). */
  public close(): void {
    if (this.db.isOpen) this.db.close();
  }
}

/**
 * Brings the file up to `MIGRATIONS.length`, one transaction per step.
 *
 * A database ahead of this build is left alone rather than downgraded: an older core opening a
 * newer file is a mistake to report, not to fix by deleting columns.
 */
function migrate(db: DatabaseSync): void {
  const from = versionOf(db);
  if (from >= MIGRATIONS.length) return;
  for (let version = from; version < MIGRATIONS.length; version += 1) {
    const step = MIGRATIONS[version];
    if (step === undefined) continue;
    db.exec('BEGIN');
    try {
      db.exec(step);
      // Not a parameter: PRAGMA does not take one, and `version` is a loop counter over an array
      // in this file, never anything from outside it (SEC-DATA-3 is about untrusted values).
      db.exec(`PRAGMA user_version = ${String(version + 1)}`);
      db.exec('COMMIT');
    } catch (cause) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${String(version + 1)} failed`, { cause });
    }
  }
}

function versionOf(db: DatabaseSync): number {
  const row: unknown = db.prepare('PRAGMA user_version').get();
  const value = asRecord(row)?.['user_version'];
  return typeof value === 'number' ? value : 0;
}

/** A negative or absurd `limit` becomes a sane one rather than a SQL error or the whole table. */
function capped(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  return Math.min(Math.floor(limit), 10_000);
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
