// `GET /search` — P7-T1, SPEC §5.8.
//
// The route does two things and the second is the one worth a file: it turns what somebody typed
// into an FTS5 expression before it reaches SQLite. A query nobody screened is a `"` away from a
// syntax error, and the owner would have typed an ordinary question to get it.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SEARCH_HITS, type SearchHit } from '../../../contracts/transcript-search.ts';
import { SearchRoute } from '../../../core/http/search-route.ts';
import type { RequestFacts } from '../../../core/http/loopback-guard.ts';

const HIT: SearchHit = {
  subscription: '365',
  sessionId: 'aaaaaaaa-0000-0000-0000-000000000000',
  projectKey: 'C--work',
  kind: 'you',
  at: 1000,
  snippet: 'deploy to cloudflare',
};

class StubIndex {
  public readonly asked: { readonly match: string; readonly limit: number }[] = [];
  private answer: readonly SearchHit[] = [HIT];

  public willAnswer(hits: readonly SearchHit[]): void {
    this.answer = hits;
  }

  public searchTranscripts(match: string, limit: number): readonly SearchHit[] {
    this.asked.push({ match, limit });
    return this.answer;
  }
}

function build(): { route: SearchRoute; index: StubIndex } {
  const index = new StubIndex();
  return { route: new SearchRoute(index), index };
}

function facts(query: string): RequestFacts {
  return { url: `http://127.0.0.1:4950/search${query}` } as unknown as RequestFacts;
}

describe('SearchRoute', () => {
  it('is a GET on its own path, behind the token and the control budget', () => {
    const { route } = build();

    expect(route.method).toBe('GET');
    expect(route.path).toBe('/search');
    expect(route.credential).toBe('token');
    expect(route.limit).toBe('control');
  });

  it('answers 200 and the hits', async () => {
    const { route } = build();

    const reply = await route.handle(facts('?q=cloudflare'));

    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ hits: [HIT] });
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

  it('asks for the default number of hits when none was named', async () => {
    const { route, index } = build();

    await route.handle(facts('?q=cloudflare'));

    expect(index.asked[0]?.limit).toBe(DEFAULT_SEARCH_HITS);
  });

  it('passes a limit the caller asked for', async () => {
    const { route, index } = build();

    await route.handle(facts('?q=cloudflare&limit=5'));

    expect(index.asked[0]?.limit).toBe(5);
  });

  /**
   * An empty query is 200 with no hits, not 400.
   *
   * The box is typed into one character at a time, and a deck that had to special-case "too early
   * to ask" would ask anyway. Nothing reaches the index, which is the half that matters.
   */
  it.each(['', '?q=', '?q=%20%20', '?q=%3F%21', '?limit=5'])(
    'answers 200 and nothing for %s, without asking the index',
    async (query) => {
      const { route, index } = build();

      const reply = await route.handle(facts(query));

      expect(reply.status).toBe(200);
      expect(reply.body).toEqual({ hits: [] });
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

    expect((await route.handle(facts('?q=kubernetes'))).body).toEqual({ hits: [] });
  });

  it('survives a request with no url at all', async () => {
    const { route } = build();

    const reply = await route.handle({} as unknown as RequestFacts);

    expect(reply.status).toBe(200);
  });
});
