// The transcript index's half of the store — P7-T1, SEC-DATA-1, SEC-DATA-3.
//
// Its own class beside `SqliteStore` rather than three more methods on it, and the line limit is
// only half the reason. The other half is that everything in that file is one call against one
// prepared statement, and this is a loop inside a transaction across two tables plus a virtual one
// — and it is the only place in core that writes the owner's prose to disk.
//
// **It shares the handle; it does not open one.** Two connections to the same file would be two
// WAL readers and, worse, two migration runners; `SqliteStore` opens and migrates, and hands this
// the `DatabaseSync` it already has.
import type { DatabaseSync } from 'node:sqlite';
import { worktreeSlugPrefix } from '../../../contracts/search-filters.ts';
import { snippetAround, type SearchHit } from '../../../contracts/transcript-search.ts';
import type { TranscriptIndexBatch, TranscriptQuery } from '../../ports/store.ts';
import type { TranscriptCursor } from '../../ports/transcript-file.ts';
import { capped, toSearchHit, toToolName, toTranscriptCursor } from './rows.ts';
import { prepareSearchStatements, type SearchStatements } from './search-statements.ts';

export class SqliteTranscriptIndex {
  private readonly db: DatabaseSync;
  private readonly rows: SearchStatements;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.rows = prepareSearchStatements(db);
  }

  public transcriptCursor(path: string): TranscriptCursor | undefined {
    return toTranscriptCursor(this.rows.selectCursor.get(path));
  }

  /**
   * One transaction, because half of this batch is a lie — see the port.
   *
   * The delete comes first and only when the file restarted: a transcript that was replaced has
   * everything already indexed from it describing a conversation that is no longer at that path,
   * and a search that returned it would read as a bug in the search rather than in the index.
   */
  public indexTranscript(batch: TranscriptIndexBatch): void {
    this.db.exec('BEGIN');
    try {
      if (batch.restarted) {
        this.rows.deleteForSession.run(batch.subscription, batch.sessionId);
        this.rows.deleteToolsForSession.run(batch.subscription, batch.sessionId);
      }
      for (const tool of batch.tools) {
        this.rows.insertTool.run(batch.subscription, batch.sessionId, tool);
      }
      for (const prose of batch.excerpts) {
        this.rows.insertExcerpt.run(
          batch.subscription,
          batch.sessionId,
          batch.projectKey,
          prose.kind,
          // 0 rather than NULL for a line that carried no timestamp: `at` is ordered on, and a
          // NULL would sort a record with no instant above every one that has one.
          prose.at ?? 0,
          prose.text,
        );
      }
      this.rows.upsertCursor.run(
        batch.path,
        batch.subscription,
        batch.sessionId,
        batch.projectKey,
        batch.cursor.offset,
        batch.cursor.identity,
        batch.at,
      );
      this.db.exec('COMMIT');
    } catch (cause) {
      this.db.exec('ROLLBACK');
      throw new Error('indexTranscript failed', { cause });
    }
  }

  public searchTranscripts(query: TranscriptQuery): readonly SearchHit[] {
    const { match, filters } = query;
    // Named rather than positional: seven filters, two of them read twice, is a statement one
    // reordered line would silently mis-bind. `null` is what `IS NULL` reads as absent.
    const parameters = {
      match,
      subscription: filters.subscription ?? null,
      project: filters.project ?? null,
      worktrees: filters.project === undefined ? null : `${worktreeSlugPrefix(filters.project)}%`,
      since: filters.since ?? null,
      until: filters.until ?? null,
      session: filters.session === undefined ? null : `${filters.session}%`,
      tool: filters.tool ?? null,
      limit: capped(query.limit),
    };
    return (
      this.rows.search
        .all(parameters)
        .map(toSearchHit)
        // The row carries the whole excerpt, up to 8 KB. The window is cut here rather than by
        // FTS5's `snippet()`, which cannot run in the aggregate query above — see the statement.
        .map((hit) => ({ ...hit, snippet: snippetAround(hit.snippet, match) }))
    );
  }

  /** The picker's list — see the port. Most sessions first, then by name so the order is stable. */
  public transcriptTools(limit: number): readonly string[] {
    return this.rows.selectTools
      .all(capped(limit))
      .map(toToolName)
      .filter((tool) => tool !== '');
  }
}
