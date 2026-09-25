// `GET /search` — the index, asked a question (P7-T1, P7-T2, SPEC §5.8).
//
// **A route in P7-T1 rather than in P7-T2**, deliberately and narrowly: an index nobody can query
// is a table that cannot be observed to be right. P7-T2 adds what the deck needs to draw a search
// page — the five filters SPEC §5.8 lists (contracts/search-filters.ts) and, beside the hits, how
// far the index has got (contracts/search-reply.ts), because the cold backfill takes hours
// (RESEARCH.md G.56) and a missing hit during it is not evidence of anything.
//
// **The query is screened into an FTS5 expression before it reaches the store** — FTS5 has a
// grammar, and `"` or `NOT` typed by somebody looking for those words is a syntax error rather
// than a search (contracts/transcript-search.ts). What reaches SQLite is still a bound parameter
// (SEC-DATA-3); the screening is about FTS5's grammar, not about SQL's.
//
// **An empty query is 200 with no hits, not 400.** The search box is typed into one character at a
// time, and a deck that had to special-case "too early to ask" would ask anyway. **A malformed
// FILTER is 400**, because nobody types one: the deck builds it from a select, and answering a
// narrower question with the wider answer would look exactly like the narrow one.
import type { IndexProgress } from '../../contracts/search-reply.ts';
import { parseSearchFilters } from '../../contracts/search-filters.ts';
import {
  searchLimit,
  toMatchExpression,
  type SearchHit,
} from '../../contracts/transcript-search.ts';
import type { TranscriptQuery } from '../ports/store.ts';
import type { RouteLimit } from './limits.ts';
import type { Credential, RequestFacts } from './loopback-guard.ts';
import { json, type JsonResponse, type Route } from './route.ts';

/** The one method this route needs from the store, as an interface — `SessionForker`'s reason. */
export interface TranscriptSearch {
  searchTranscripts(query: TranscriptQuery): readonly SearchHit[];
}

/** How far the index has got — `TranscriptIndexer.progress`, narrowed to that. */
export interface IndexProgressSource {
  progress(): IndexProgress;
}

export class SearchRoute implements Route {
  public readonly method = 'GET';
  public readonly path = '/search';
  public readonly limit: RouteLimit = 'control';
  public readonly credential: Credential = 'token';

  private readonly index: TranscriptSearch;
  private readonly indexer: IndexProgressSource;

  constructor(index: TranscriptSearch, indexer: IndexProgressSource) {
    this.index = index;
    this.indexer = indexer;
  }

  /**
   * @returns 200 with `{ hits, index }`, best first; 400 `bad_filter` for a filter that does not
   * parse. Never 400 for the query itself — see the header.
   *
   * Synchronous underneath, because `node:sqlite` is (R17). The promise is the `Route` contract's,
   * not this route's, and there is no `await` in here to suggest a concurrency that does not exist.
   */
  public handle(request: RequestFacts): Promise<JsonResponse> {
    const parameters = query(request.url);
    const filters = parseSearchFilters(parameters);
    if (filters === undefined) return Promise.resolve(json(400, { error: 'bad_filter' }));
    const index = this.indexer.progress();
    const match = toMatchExpression(parameters['q'] ?? '');
    if (match === undefined) return Promise.resolve(json(200, { hits: [], index }));
    const limit = searchLimit(parameters['limit']);
    const hits = this.index.searchTranscripts({ match, limit, filters });
    return Promise.resolve(json(200, { hits, index }));
  }
}

/** The query parameters, as plain strings — `PreviewRoute`'s, and the same throwaway base. */
function query(url: string | undefined): Readonly<Record<string, string>> {
  if (url === undefined) return {};
  try {
    return Object.fromEntries(new URL(url, 'http://127.0.0.1').searchParams);
  } catch {
    return {};
  }
}
