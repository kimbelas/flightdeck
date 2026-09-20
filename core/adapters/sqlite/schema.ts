// The schema, as a list of steps — P1-T8, SEC-DATA-3.
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
