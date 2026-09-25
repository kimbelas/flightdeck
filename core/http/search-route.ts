// `GET /search` — the index, asked a question (P7-T1, SPEC §5.8).
//
// **A route in this task rather than in P7-T2**, deliberately and narrowly. An index nobody can
// query is a table that cannot be observed to be right, and the phase gate is a sentence about
// what comes back — *"Where did I do that Cloudflare Workers deploy?" returns the session in under
// a second.* So the minimum that makes the index answerable ships with the index. **The filters
// SPEC §5.8 lists — project, subscription, date, tool, session — are P7-T2's**, and none of them
// is here: a half-built filter is worse than an absent one, because the next task has to decide
// whether to trust it.
//
// **The query is screened into an FTS5 expression before it reaches the store** — FTS5 has a
// grammar, and `"` or `NOT` typed by somebody looking for those words is a syntax error rather
// than a search (contracts/transcript-search.ts). What reaches SQLite is still a bound parameter
// (SEC-DATA-3); the screening is about FTS5's grammar, not about SQL's.
//
// **An empty query is 200 with no hits, not 400.** The search box is typed into one character at a
// time, and a deck that had to special-case "too early to ask" would ask anyway.
import {
  searchLimit,
  toMatchExpression,
  type SearchHit,
} from '../../contracts/transcript-search.ts';
import type { RouteLimit } from './limits.ts';
import type { Credential, RequestFacts } from './loopback-guard.ts';
import { json, type JsonResponse, type Route } from './route.ts';

/** The one method this route needs, as an interface — `SessionForker`'s reason. */
export interface TranscriptSearch {
  searchTranscripts(match: string, limit: number): readonly SearchHit[];
}

export class SearchRoute implements Route {
  public readonly method = 'GET';
  public readonly path = '/search';
  public readonly limit: RouteLimit = 'control';
  public readonly credential: Credential = 'token';

  private readonly index: TranscriptSearch;

  constructor(index: TranscriptSearch) {
    this.index = index;
  }

  /**
   * @returns 200 and the hits, best first. Never 400 for a query — see the header.
   *
   * Synchronous underneath, because `node:sqlite` is (R17). The promise is the `Route` contract's,
   * not this route's, and there is no `await` in here to suggest a concurrency that does not exist.
   */
  public handle(request: RequestFacts): Promise<JsonResponse> {
    const parameters = query(request.url);
    const match = toMatchExpression(parameters['q'] ?? '');
    if (match === undefined) return Promise.resolve(json(200, { hits: [] }));
    const hits = this.index.searchTranscripts(match, searchLimit(parameters['limit']));
    return Promise.resolve(json(200, { hits }));
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
