// The search index's statements — P7-T1, P7-T2, SEC-DATA-3.
//
// Its own file beside `statements.ts` for that file's reason: `sqlite-store.ts` has a 250-line
// limit it has been split for once already, and these belong together — every one of them is about
// the tables migrations 7 and 9 added and nothing else touches them.
//
// **Every statement is parameterised, including the MATCH expression and every filter.** FTS5's
// grammar is screened in `contracts/transcript-search.ts` and the filters' shapes in
// `contracts/search-filters.ts` before they get here; what this file guarantees is the other half,
// that nothing is built by concatenation (SEC-DATA-3) — a `LIMIT` is a parameter too.
import type { DatabaseSync, StatementSync } from 'node:sqlite';

export interface SearchStatements {
  readonly selectCursor: StatementSync;
  readonly upsertCursor: StatementSync;
  readonly insertExcerpt: StatementSync;
  /** Everything already indexed from one transcript. Run when the file restarted — see the port. */
  readonly deleteForSession: StatementSync;
  readonly insertTool: StatementSync;
  /** The tools half of `deleteForSession`, run beside it for the same reason. */
  readonly deleteToolsForSession: StatementSync;
  readonly search: StatementSync;
  readonly selectTools: StatementSync;
}

/**
 * One hit per session, best first, narrowed by whichever filters were given — P7-T1, P7-T2.
 *
 * **One hit per session, and the grouping is the query's whole shape.** The gate asks *"where did
 * I do that Cloudflare Workers deploy?"*, and the answer is a conversation to go back to — forty
 * lines from inside one session would push every other session off the page. So it groups by
 * `(subscription, session_id)` and takes the best-ranked line in each: FTS5's rank is negative and
 * smaller is better, so `MIN(rank)` is the strongest match, and SQLite's documented behaviour for a
 * bare column beside a `MIN` is that it comes from the row that produced it.
 *
 * **The whole excerpt comes back and the window is cut afterwards, NOT by `snippet()`.** FTS5's
 * `snippet()` refuses to run in an aggregate context — "unable to use function snippet in the
 * requested context" — which is a real answer to the grouping above rather than a limitation to
 * work around. `snippetAround` does it in TypeScript (SEC-UI-2).
 *
 * **Every filter is `(:x IS NULL OR …)`**, so one prepared statement answers all thirty-two
 * combinations and an absent filter costs nothing. They narrow the LINES before the grouping, so a
 * date range means a matching line written in it. `until` also refuses `at = 0` — a line with no
 * timestamp is not "older than 30 days", it is undated. The project matches its root slug and its
 * worktrees' (`worktreeSlugPrefix`); `LIKE` is safe on both because a slug is letters, digits and
 * `-` only, and it is case-insensitive, as a Windows path is.
 *
 * **`ORDER BY` before `LIMIT`, and the limit is bound.** `at DESC` breaks ties toward the more
 * recent conversation, which is what somebody asking "where did I do that" almost always means.
 */
const SEARCH = `
  SELECT e.subscription   AS subscription,
         e.session_id     AS session_id,
         e.project_key    AS project_key,
         e.kind           AS kind,
         e.at             AS at,
         e.text           AS snippet,
         MIN(f.rank)      AS best
    FROM transcript_fts AS f
    JOIN transcript_excerpts AS e ON e.id = f.rowid
   WHERE transcript_fts MATCH :match
     AND (:subscription IS NULL OR e.subscription = :subscription)
     AND (:project IS NULL OR e.project_key LIKE :project OR e.project_key LIKE :worktrees)
     AND (:since IS NULL OR e.at >= :since)
     AND (:until IS NULL OR (e.at > 0 AND e.at < :until))
     AND (:session IS NULL OR e.session_id LIKE :session)
     AND (:tool IS NULL OR EXISTS (
           SELECT 1 FROM transcript_tools AS t
            WHERE t.subscription = e.subscription
              AND t.session_id = e.session_id
              AND t.tool = :tool))
   GROUP BY e.subscription, e.session_id
   ORDER BY best ASC, e.at DESC
   LIMIT :limit`;

/** The statements, prepared once. */
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
    // OR IGNORE: the key is (session, tool), and a session calls `Read` in most of its slices.
    insertTool: db.prepare(
      `INSERT OR IGNORE INTO transcript_tools (subscription, session_id, tool) VALUES (?, ?, ?)`,
    ),
    deleteToolsForSession: db.prepare(
      `DELETE FROM transcript_tools WHERE subscription = ? AND session_id = ?`,
    ),
    search: db.prepare(SEARCH),
    selectTools: db.prepare(
      `SELECT tool, COUNT(*) AS sessions FROM transcript_tools
        GROUP BY tool ORDER BY sessions DESC, tool ASC LIMIT ?`,
    ),
  };
}
