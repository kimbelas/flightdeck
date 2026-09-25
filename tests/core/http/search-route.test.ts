// `GET /search` — P7-T1, P7-T2, SPEC §5.8.
//
// The route does three things. It turns what somebody typed into an FTS5 expression before it
// reaches SQLite — a query nobody screened is a `"` away from a syntax error. It reads SPEC §5.8's
// five filters and REFUSES one that does not parse, because a dropped filter is a wider answer
// that looks like the narrow one. And it carries the indexer's progress beside the hits, because
// the cold backfill takes hours (RESEARCH.md G.56).
import { describe, expect, it } from 'vitest';
import { NO_FILTERS } from '../../../contracts/search-filters.ts';
import { NOT_YET_INDEXED, type IndexProgress } from '../../../contracts/search-reply.ts';
import { DEFAULT_SEARCH_HITS, type SearchHit } from '../../../contracts/transcript-search.ts';
import { SearchRoute } from '../../../core/http/search-route.ts';
import type { RequestFacts } from '../../../core/http/loopback-guard.ts';
import type { TranscriptQuery } from '../../../core/ports/store.ts';

const HIT: SearchHit = {
  subscription: '365',
  sessionId: 'aaaaaaaa-0000-0000-0000-000000000000',
  projectKey: 'C--work',
  kind: 'you',
  at: 1000,
  snippet: 'deploy to cloudflare',
};

const FILLING: IndexProgress = {
  passedAt: 5000,
  transcripts: 1041,
  behind: 900,
  bytesTotal: 1_760_000_000,
  bytesIndexed: 23_000_000,
};

class StubIndex {
  public readonly asked: TranscriptQuery[] = [];
  private answer: readonly SearchHit[] = [HIT];

  public willAnswer(hits: readonly SearchHit[]): void {
    this.answer = hits;
  }

  public searchTranscripts(query: TranscriptQuery): readonly SearchHit[] {
    this.asked.push(query);
    return this.answer;
  }
}

class StubIndexer {
  public current: IndexProgress = FILLING;

  public progress(): IndexProgress {
    return this.current;
  }
}

function build(): { route: SearchRoute; index: StubIndex; indexer: StubIndexer } {
  const index = new StubIndex();
  const indexer = new StubIndexer();
  return { route: new SearchRoute(index, indexer), index, indexer };
}

function facts(query: string): RequestFacts {
  return { method: 'GET', url: `http://127.0.0.1:4950/search${query}`, headers: {} };
}

describe('SearchRoute', () => {
  it('is a GET on its own path, behind the token and the control budget', () => {
    const { route } = build();

    expect(route.method).toBe('GET');
    expect(route.path).toBe('/search');
    expect(route.credential).toBe('token');
    expect(route.limit).toBe('control');
  });

  it('answers 200, the hits and how far the index has got', async () => {
    const { route } = build();

    const reply = await route.handle(facts('?q=cloudflare'));

    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ hits: [HIT], index: FILLING });
  });

  it('carries the progress as it is now, including before the first pass has finished', async () => {
    const { route, indexer } = build();
    indexer.current = NOT_YET_INDEXED;

    expect((await route.handle(facts('?q=cloudflare'))).body).toEqual({
      hits: [HIT],
      index: NOT_YET_INDEXED,
    });
  });

  // The screen. Each of these is a syntax error or a different search if it reaches FTS5 as typed.
  it.each([
    // `+` is a SPACE in a query string, so this is two words before FTS5 is involved at all.
    { typed: 'cloudflare+workers', match: '"cloudflare" "workers"*' },
    // A hyphen inside a word is kept, so the quoted term stays one phrase FTS5 can tokenize.
    { typed: 'fork-session', match: '"fork-session"*' },
    { typed: 'NOT found', match: '"NOT" "found"*' },
    { typed: 'what%22s+this', match: '"whats" "this"*' },
  ])('turns $typed into a bag of words before SQLite sees it', async ({ typed, match }) => {
    const { route, index } = build();

    await route.handle(facts(`?q=${typed}`));

    expect(index.asked[0]?.match).toBe(match);
  });

  it('asks for the default number of hits, with no filters, when none was named', async () => {
    const { route, index } = build();

    await route.handle(facts('?q=cloudflare'));

    expect(index.asked[0]).toMatchObject({ limit: DEFAULT_SEARCH_HITS, filters: NO_FILTERS });
  });

  it('passes a limit the caller asked for', async () => {
    const { route, index } = build();

    await route.handle(facts('?q=cloudflare&limit=5'));

    expect(index.asked[0]?.limit).toBe(5);
  });

  it('passes every filter down, parsed', async () => {
    const { route, index } = build();

    await route.handle(
      facts(
        '?q=deploy&subscription=isg&project=C--work-app&since=1000&until=2000' +
          '&session=aaaaaaaa&tool=WebFetch',
      ),
    );

    expect(index.asked[0]?.filters).toEqual({
      subscription: 'isg',
      project: 'C--work-app',
      since: 1000,
      until: 2000,
      session: 'aaaaaaaa',
      tool: 'WebFetch',
    });
  });

  // A filter is built from a select, never typed — a malformed one is a bug, and answering it with
  // the unfiltered search would look exactly like the filtered one.
  it.each([
    '?q=deploy&subscription=work',
    '?q=deploy&project=C:%5Cwork',
    '?q=deploy&project=C--wo%25rk',
    '?q=deploy&since=yesterday',
    '?q=deploy&until=-5',
    '?q=deploy&session=ABCDEF12',
    '?q=deploy&tool=%3Cscript%3E',
  ])('refuses %s with 400 and asks nothing', async (query) => {
    const { route, index } = build();

    const reply = await route.handle(facts(query));

    expect(reply.status).toBe(400);
    expect(reply.body).toEqual({ error: 'bad_filter' });
    expect(index.asked).toEqual([]);
  });

  /**
   * An empty query is 200 with no hits, not 400.
   *
   * The box is typed into one character at a time, and a deck that had to special-case "too early
   * to ask" would ask anyway. Nothing reaches the index, which is the half that matters — and the
   * progress still comes back, so an empty box can say the index is filling.
   */
  it.each(['', '?q=', '?q=%20%20', '?q=%3F%21', '?limit=5'])(
    'answers 200 and nothing for %s, without asking the index',
    async (query) => {
      const { route, index } = build();

      const reply = await route.handle(facts(query));

      expect(reply.status).toBe(200);
      expect(reply.body).toEqual({ hits: [], index: FILLING });
      expect(index.asked).toEqual([]);
    },
  );

  it('answers nothing for a query longer than the cap', async () => {
    const { route, index } = build();

    await route.handle(facts(`?q=${'x'.repeat(500)}`));

    expect(index.asked).toEqual([]);
  });

  it('answers an empty list rather than nothing when the index found none', async () => {
    const { route, index } = build();
    index.willAnswer([]);

    expect((await route.handle(facts('?q=kubernetes'))).body).toEqual({
      hits: [],
      index: FILLING,
    });
  });

  it('survives a request with no url at all', async () => {
    const { route } = build();

    const reply = await route.handle({ method: 'GET', url: undefined, headers: {} });

    expect(reply.status).toBe(200);
  });
});
