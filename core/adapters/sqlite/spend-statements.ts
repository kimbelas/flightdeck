// The spend ledger's statements — P7-T3, SEC-DATA-3.
//
// Its own file for `search-statements.ts`'s reason: every one of these is about the two tables
// migration 10 added and nothing else touches them. Every value is a bound parameter, the week a
// summary starts from included.
import type { DatabaseSync, StatementSync } from 'node:sqlite';

export interface SpendStatements {
  readonly selectMark: StatementSync;
  readonly upsertMark: StatementSync;
  /** ADDS one week's increment to what the row holds — a slice never replaces a week. */
  readonly addWeek: StatementSync;
  /** Everything a transcript contributed. Run when the file restarted — see the port. */
  readonly deleteWeeks: StatementSync;
  readonly byWeek: StatementSync;
  readonly byProject: StatementSync;
}

/**
 * The six, prepared once.
 *
 * The two summaries repeat their column list rather than splicing in a shared one: a template
 * literal inside SQL is the thing SEC-DATA-3 asks a reader never to have to check the source of.
 * `COUNT(DISTINCT path)` is why `sessions` is counted here and never summed afterwards — a
 * transcript that reported in two weeks is one session in the project it belongs to.
 */
export function prepareSpendStatements(db: DatabaseSync): SpendStatements {
  return { ...prepareWrites(db), ...prepareReads(db) };
}

/** The four the ledger uses, one slice at a time. */
function prepareWrites(
  db: DatabaseSync,
): Pick<SpendStatements, 'selectMark' | 'upsertMark' | 'addWeek' | 'deleteWeeks'> {
  return {
    selectMark: db.prepare(`SELECT * FROM spend_cursors WHERE path = ?`),
    upsertMark: db.prepare(
      `INSERT INTO spend_cursors
         (path, subscription, session_id, project_key, offset_bytes, identity, run_started_at,
          run_cost_usd, run_lines_added, run_lines_removed, run_tokens_in, run_tokens_out, read_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         offset_bytes      = excluded.offset_bytes,
         identity          = excluded.identity,
         run_started_at    = excluded.run_started_at,
         run_cost_usd      = excluded.run_cost_usd,
         run_lines_added   = excluded.run_lines_added,
         run_lines_removed = excluded.run_lines_removed,
         run_tokens_in     = excluded.run_tokens_in,
         run_tokens_out    = excluded.run_tokens_out,
         read_at           = excluded.read_at`,
    ),
    addWeek: db.prepare(
      `INSERT INTO spend_weeks
         (path, week_start, subscription, project_key,
          cost_usd, lines_added, lines_removed, tokens_in, tokens_out)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(path, week_start) DO UPDATE SET
         cost_usd      = cost_usd      + excluded.cost_usd,
         lines_added   = lines_added   + excluded.lines_added,
         lines_removed = lines_removed + excluded.lines_removed,
         tokens_in     = tokens_in     + excluded.tokens_in,
         tokens_out    = tokens_out    + excluded.tokens_out`,
    ),
    deleteWeeks: db.prepare(`DELETE FROM spend_weeks WHERE path = ?`),
  };
}

/** The two the report uses. */
function prepareReads(db: DatabaseSync): Pick<SpendStatements, 'byWeek' | 'byProject'> {
  return {
    byWeek: db.prepare(
      `SELECT week_start AS key, subscription, COUNT(DISTINCT path) AS sessions,
              SUM(cost_usd)        AS cost_usd,
              SUM(lines_added)     AS lines_added,
              SUM(lines_removed)   AS lines_removed,
              SUM(tokens_in)       AS tokens_in,
              SUM(tokens_out)      AS tokens_out
         FROM spend_weeks WHERE week_start >= ?
        GROUP BY week_start, subscription
        ORDER BY week_start, subscription`,
    ),
    byProject: db.prepare(
      `SELECT project_key AS key, subscription, COUNT(DISTINCT path) AS sessions,
              SUM(cost_usd)        AS cost_usd,
              SUM(lines_added)     AS lines_added,
              SUM(lines_removed)   AS lines_removed,
              SUM(tokens_in)       AS tokens_in,
              SUM(tokens_out)      AS tokens_out
         FROM spend_weeks WHERE week_start >= ?
        GROUP BY project_key, subscription
        ORDER BY project_key, subscription`,
    ),
  };
}
