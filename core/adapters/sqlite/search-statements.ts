// The search index's statements — P7-T1, SEC-DATA-3.
//
// Its own file beside `statements.ts` for that file's reason: `sqlite-store.ts` has a 250-line
// limit it has been split for once already, and these belong together — every one of them is about
// the two tables migration 7 added and nothing else touches them.
//
// **Every statement is parameterised, including the MATCH expression.** FTS5's grammar is screened
// in `contracts/transcript-search.ts` before it gets here; what this file guarantees is the other
// half, that nothing is built by concatenation (SEC-DATA-3) — a `LIMIT` is a parameter too.
import type { DatabaseSync, StatementSync } from 'node:sqlite';

export interface SearchStatements {
  readonly selectCursor: StatementSync;
  readonly upsertCursor: StatementSync;
  readonly insertExcerpt: StatementSync;
  /** Everything already indexed from one transcript. Run when the file restarted — see the port. */
  readonly deleteForSession: StatementSync;
  readonly search: StatementSync;
}

/**
 * The five, prepared once.
 *
 * **`search` is one hit per session, and the grouping is the query's whole shape.** The gate asks
 * *"where did I do that Cloudflare Workers deploy?"*, and the answer is a conversation to go back
 * to — forty lines from inside one session would push every other session off the page. So it
 * groups by `(subscription, session_id)` and takes the best-ranked line in each: FTS5's rank is
 * negative and smaller is better, so `MIN(rank)` is the strongest match, and SQLite's documented
 * behaviour for a bare column beside a `MIN` is that it comes from the row that produced it.
 *
 * **The whole excerpt comes back and the window is cut afterwards, NOT by `snippet()`.** FTS5's
 * `snippet()` refuses to run in an aggregate context — "unable to use function snippet in the
 * requested context" — which is a real answer to the grouping above rather than a limitation to
 * work around. `snippetAround` does it in TypeScript, where it is testable without a database and
 * where the decision to emit no highlight markup can be read (SEC-UI-2).
 *
 * **`ORDER BY` before `LIMIT`, and the limit is bound.** Ordering by the grouped rank puts the
 * strongest session first; `at DESC` breaks ties toward the more recent conversation, which is
 * what somebody asking "where did I do that" almost always means.
 */
export function prepareSearchStatements(db: DatabaseSync): SearchStatements {
  return {
    selectCursor: db.prepare(
      `SELECT offset_bytes, identity FROM transcript_cursors WHERE path = ?`,
    ),
    upsertCursor: db.prepare(
      `INSERT INTO transcript_cursors
         (path, subscription, session_id, project_key, offset_bytes, identity, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         offset_bytes = excluded.offset_bytes,
         identity     = excluded.identity,
         indexed_at   = excluded.indexed_at`,
    ),
    insertExcerpt: db.prepare(
      `INSERT INTO transcript_excerpts
         (subscription, session_id, project_key, kind, at, text)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ),
    deleteForSession: db.prepare(
      `DELETE FROM transcript_excerpts WHERE subscription = ? AND session_id = ?`,
    ),
    search: db.prepare(
      `SELECT e.subscription   AS subscription,
              e.session_id     AS session_id,
              e.project_key    AS project_key,
              e.kind           AS kind,
              e.at             AS at,
              e.text           AS snippet,
              MIN(f.rank)      AS best
         FROM transcript_fts AS f
         JOIN transcript_excerpts AS e ON e.id = f.rowid
        WHERE transcript_fts MATCH ?
        GROUP BY e.subscription, e.session_id
        ORDER BY best ASC, e.at DESC
        LIMIT ?`,
    ),
  };
}
