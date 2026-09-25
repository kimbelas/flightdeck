// The schema, as a list of steps — P1-T8, SEC-DATA-3.
//
// The migration RUNNER lives here too, beside the list it walks: `sqlite-store.ts` has a 250-line
// limit it has been split for twice, and of what that file does, "bring the file up to
// MIGRATIONS.length" is the piece that is about this list rather than about any table.
//
// **Migrations are an append-only array and `user_version` is the index into it.** No migration
// table, no filenames, no timestamps: SQLite already carries an integer per database for exactly
// this, and a list whose length IS the target version cannot disagree with itself the way a table
// of "which ones ran" can. Adding a schema change means appending one entry and never editing an
// earlier one — an edited step is a database that migrated once and will never migrate again.
//
// **Every step runs inside one transaction with the version bump.** A migration that half-applied
// and then recorded itself as done is the failure that costs a rebuild, and it is the one thing
// here worth the extra four lines.
//
// **Payloads are TEXT holding JSON, not BLOB.** They are read back by `JSON.parse` and never by
// SQLite, and TEXT is what makes the file greppable when something is wrong — which for a
// single-user local store is worth more than the bytes.

import type { DatabaseSync } from 'node:sqlite';
import { asRecord } from './rows.ts';

/**
 * One migration per entry. **Append only; never edit one that has shipped.**
 *
 * `user_version` after applying all of them is `MIGRATIONS.length`.
 */
export const MIGRATIONS: readonly string[] = [
  // 1 — events and audit: what was observed, and what Flightdeck did (BUILD-PLAN §3, SEC-PROC-3).
  `
  CREATE TABLE events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    at           INTEGER NOT NULL,
    session_id   TEXT    NOT NULL,
    subscription TEXT    NOT NULL,
    source       TEXT    NOT NULL,
    type         TEXT    NOT NULL,
    payload      TEXT
  );
  -- (session_id, id) and not (session_id) alone: every read of this table is "for this session,
  -- after this id", so the id belongs in the index or every page is a scan plus a sort.
  CREATE INDEX events_by_session ON events (session_id, id);

  CREATE TABLE audit (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    at      INTEGER NOT NULL,
    who     TEXT    NOT NULL,
    action  TEXT    NOT NULL,
    target  TEXT    NOT NULL,
    args    TEXT    NOT NULL,
    outcome TEXT    NOT NULL,
    reason  TEXT
  );
  `,
  // 2 — vitals snapshots: the series behind the sparkline and the burn rate (SPEC §5.4, §5.5).
  `
  CREATE TABLE vitals_snapshots (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    at             INTEGER NOT NULL,
    session_id     TEXT    NOT NULL,
    subscription   TEXT    NOT NULL,
    used_percentage REAL,
    context_window  INTEGER,
    cost_usd        REAL,
    model_id        TEXT
  );
  -- Descending, because the only query is "the most recent N for this session".
  CREATE INDEX vitals_by_session ON vitals_snapshots (session_id, id DESC);
  `,
  // 3 — the project registry: which folders the owner imported (P3-T1, D26, SEC-FS-1).
  //
  // **The only table here that is not a log.** Everything above is append-only observation; a row
  // in this one is a standing permission — it is what widens `ReadPolicy`'s allowlist — so it can
  // be removed, and removing it has to actually take the permission away. Hence a primary key
  // rather than an autoincrementing id: the key is the folder, and importing the same folder twice
  // is the same project rather than a second row that outlives forgetting the first.
  //
  // **Two columns for one path, and neither is redundant.** `path_key` is the comparison form
  // (`projectKey`: separators folded, lowercased) and is what every lookup and every join uses;
  // `path` is what `realpath` returned, in the filesystem's own casing, and is what goes on screen
  // — `c:\users\belas\documents\development\app-next` is not how anybody reads a path. Deriving
  // one from the other at read time would mean a query that cannot use the key.
  `
  CREATE TABLE projects (
    path_key    TEXT PRIMARY KEY,
    path        TEXT NOT NULL,
    name        TEXT NOT NULL,
    imported_at INTEGER NOT NULL
  );
  `,
  // 4 — launch presets: the named ways to start a session in a folder (P4-T1, SPEC §5.6).
  //
  // **Only the SAVED ones are here.** The four built-ins are computed from the project and the
  // profile functions on every request (`PresetCatalogue`), so importing a folder still writes
  // exactly one row and the owner's database holds nothing they did not put there.
  //
  // **The key is (project_key, id), and `id` is derived from the name** (`presetId`), which is
  // what makes saving idempotent and what makes a saved `ticket` shadow the built-in of that name
  // rather than sit beside it. The same argument as the projects table one migration up: the thing
  // being named is the identity, so a surrogate id would make the second save a duplicate.
  //
  // **No `subscription` column and no `model`.** The profile function is both (D4, D44): it
  // exports the config directory and pins the model, so a column for either would be a second
  // opinion that the command line would then contradict.
  //
  // **`preset_group`, not `group`** — `GROUP` is a SQL keyword, and a column name that needs
  // quoting in every statement is one somebody eventually forgets to quote.
  `
  CREATE TABLE presets (
    project_key   TEXT NOT NULL,
    id            TEXT NOT NULL,
    name          TEXT NOT NULL,
    profile_fn    TEXT NOT NULL,
    cwd           TEXT NOT NULL,
    session_name  TEXT NOT NULL,
    prompt_source TEXT NOT NULL,
    prompt        TEXT NOT NULL,
    preset_group  TEXT,
    PRIMARY KEY (project_key, id)
  );
  `,
  // 5 — config snapshots: what `.claude` held, so that what it holds now can be a change (P3-T7).
  //
  // **A row per CHANGE, not per read.** `/projects/map` is answered on every deck load and the map
  // is cached for five minutes; a row per read would make this table grow with how often somebody
  // looks rather than with what happened. `ConfigHistorian` writes only when the digest moves.
  //
  // **The digest is a JSON TEXT column rather than eleven tables.** What is compared is a set of
  // names per facet, and the comparison happens in `contracts/config-snapshot.ts` where the rule
  // about what counts as a change lives. Normalising it would put that rule in SQL, where the
  // decision to exclude byte sizes and worktrees could not be read.
  //
  // **`project_key`, and no foreign key to `projects`.** A snapshot is an observation and survives
  // the folder being forgotten, exactly as an event about a session survives the session — and
  // re-importing a folder should not have lost what its config used to be. Nothing joins the two.
  `
  CREATE TABLE config_snapshots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_key TEXT    NOT NULL,
    taken_at    INTEGER NOT NULL,
    digest      TEXT    NOT NULL
  );
  CREATE INDEX config_snapshots_project ON config_snapshots (project_key, id DESC);
  `,
  // 6 — muted sessions: the toasts the owner has told core to stop raising (P6-T3, SPEC §5.5).
  //
  // **Keyed on BOTH ids, because a session id is unique only within a config dir.** The same uuid
  // under the other subscription is a different session (`sessionKey`), and a mute keyed on the
  // uuid alone would silence a session the owner can see beside it in the deck.
  //
  // **It is a standing decision, not an observation**, like the project registry and the presets
  // above it, and admitted here for the reasons the port gives: it is keyed, it is replaceable,
  // and unmuting really has to remove the row rather than write a tombstone the next reader might
  // miss.
  //
  // **`muted_at` is here to bound the table, not to be displayed.** A session id dies with its
  // session, so without a bound this would grow with every session ever muted. The store keeps the
  // newest and drops the rest in the same call that writes one, which is `config_snapshots`' prune
  // in a different shape.
  `
  CREATE TABLE session_mutes (
    subscription TEXT    NOT NULL,
    session_id   TEXT    NOT NULL,
    muted_at     INTEGER NOT NULL,
    PRIMARY KEY (subscription, session_id)
  );
  `,
  // 7 — the search index: transcript excerpts, and FTS5 over them (P7-T1, SEC-DATA-1).
  //
  // **This is the one table in the file that holds the owner's prose**, which is what SEC-DATA-1
  // is about: it is the same sensitivity as the transcripts themselves, so it lives in the store
  // under SEC-FS-4's ACL and is never copied into the repo, a fixture or a cloud. What goes in is
  // decided by `contracts/transcript-prose.ts` and is 1.7 % of a transcript's bytes — the other
  // 98 % is tool results and pasted files, which is not searched because it is not read.
  //
  // **An EXTERNAL-CONTENT FTS5 table**, so the text is stored once rather than twice. `content=`
  // points FTS5 at the row it indexes and `content_rowid=` at the key; the triggers below are what
  // keep the two in step, and they are the documented shape for this rather than a clever one —
  // a delete has to be posted to FTS5 with the OLD text, because a contentless index cannot go and
  // read it back.
  //
  // **`unicode61 remove_diacritics 2`** rather than the default tokenizer's `1`: `2` is the form
  // that handles characters outside the Basic Multilingual Plane correctly, and this corpus has
  // German UI strings and emoji in it.
  //
  // **`transcript_cursors` is what makes the index incremental.** One row per file, holding how
  // far into it the indexer has read and WHICH file that offset belongs to — `TranscriptCursor`'s
  // `dev:ino:birthtime`, because a resumed session writes a fresh transcript at a path already
  // indexed, and a size comparison cannot see a same-length replacement. It survives a restart,
  // which is the whole point: a first pass over 1.2 GB is seconds, and every pass after it is the
  // bytes appended since.
  //
  // **The cursor points at a record boundary, never mid-line.** The indexer advances it only past
  // the last newline it consumed, so a core that stops between two writes resumes at the start of
  // a line rather than in the middle of one — which would otherwise turn one record into an
  // unparseable fragment on every restart.
  `
  CREATE TABLE transcript_excerpts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    subscription TEXT    NOT NULL,
    session_id   TEXT    NOT NULL,
    project_key  TEXT    NOT NULL,
    kind         TEXT    NOT NULL,
    at           INTEGER NOT NULL,
    text         TEXT    NOT NULL
  );
  -- Every read of this table that is not the FTS index is "everything from this file", which is
  -- what a re-index deletes before it re-reads a transcript that restarted.
  CREATE INDEX transcript_excerpts_session
    ON transcript_excerpts (subscription, session_id, id);

  CREATE VIRTUAL TABLE transcript_fts USING fts5(
    text,
    content = 'transcript_excerpts',
    content_rowid = 'id',
    tokenize = 'unicode61 remove_diacritics 2'
  );

  CREATE TRIGGER transcript_excerpts_ai AFTER INSERT ON transcript_excerpts BEGIN
    INSERT INTO transcript_fts (rowid, text) VALUES (new.id, new.text);
  END;
  CREATE TRIGGER transcript_excerpts_ad AFTER DELETE ON transcript_excerpts BEGIN
    INSERT INTO transcript_fts (transcript_fts, rowid, text)
      VALUES ('delete', old.id, old.text);
  END;

  CREATE TABLE transcript_cursors (
    path         TEXT PRIMARY KEY,
    subscription TEXT    NOT NULL,
    session_id   TEXT    NOT NULL,
    project_key  TEXT    NOT NULL,
    offset_bytes INTEGER NOT NULL,
    identity     TEXT    NOT NULL,
    indexed_at   INTEGER NOT NULL
  );
  `,
];

/**
 * Pragmas applied on every open, before any migration.
 *
 * `journal_mode` is persistent and the rest are per connection, so they are set together rather
 * than split across "once" and "always" — one list is easier to be right about than two.
 *
 * - **WAL** so a reader never blocks the writer. Core is the only writer today, but `doctor`
 *   (P1-T12) and `flightdeck-core status` read the same file while core is running.
 * - **foreign_keys** because SQLite defaults it OFF per connection, which surprises everyone once.
 * - **busy_timeout** so a concurrent reader waits rather than throwing `SQLITE_BUSY` immediately.
 */
export const PRAGMAS: readonly string[] = [
  'PRAGMA journal_mode = WAL',
  'PRAGMA foreign_keys = ON',
  'PRAGMA busy_timeout = 5000',
  // NORMAL rather than FULL: with WAL this is durable across a process crash and only loses the
  // last commits on a power cut, which for an observation log is the right trade against an fsync
  // on every hook (SEC-ING-2's budget is 5 ms).
  'PRAGMA synchronous = NORMAL',
];

/**
 * Brings the file up to `MIGRATIONS.length`, one transaction per step.
 *
 * A database ahead of this build is left alone rather than downgraded: an older core opening a
 * newer file is a mistake to report, not to fix by deleting columns.
 */
export function migrate(db: DatabaseSync): void {
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

export function versionOf(db: DatabaseSync): number {
  const row: unknown = db.prepare('PRAGMA user_version').get();
  const value = asRecord(row)?.['user_version'];
  return typeof value === 'number' ? value : 0;
}
