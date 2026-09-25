// Turning what somebody typed into something FTS5 will accept — P7-T1.
//
// **This is the screen, not an escape.** FTS5 has a grammar: `"` quotes, `*` is a prefix, `NEAR`,
// `AND`, `OR` and `NOT` are operators, `^` anchors, and a bare `(` is a syntax error. A search box
// that passed its contents through would turn *"what's the NOT found bug?"* into an exception, and
// the owner would have typed a perfectly ordinary question.
//
// So the rule is a decision rather than a fix-up: **everything typed is a bag of words**. Nobody
// gets an operator and nobody gets an error, and the last token is a prefix so a query narrows
// while it is being typed.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEARCH_HITS,
  MAX_QUERY_CHARS,
  MAX_SEARCH_HITS,
  parseSearchHits,
  searchLimit,
  SNIPPET_CHARS,
  snippetAround,
  toMatchExpression,
} from '../../contracts/transcript-search.ts';

describe('toMatchExpression', () => {
  it('quotes every word and makes the last one a prefix', () => {
    expect(toMatchExpression('cloudflare workers deploy')).toBe('"cloudflare" "workers" "deploy"*');
  });

  it('is a prefix on a single word too, so the first keystroke already narrows', () => {
    expect(toMatchExpression('cloud')).toBe('"cloud"*');
  });

  // The whole point. Each of these is a syntax error or a different search when passed through.
  it.each([
    { typed: 'NOT found', matched: '"NOT" "found"*' },
    { typed: 'a OR b', matched: '"a" "OR" "b"*' },
    { typed: 'deploy AND ship', matched: '"deploy" "AND" "ship"*' },
    { typed: 'foo NEAR bar', matched: '"foo" "NEAR" "bar"*' },
  ])('treats $typed as words rather than as operators', ({ typed, matched }) => {
    expect(toMatchExpression(typed)).toBe(matched);
  });

  // Doubling it would silently change the term; a quote inside a word is not a search anybody made.
  it('strips a quote rather than escaping it', () => {
    expect(toMatchExpression('what"s this')).toBe('"whats" "this"*');
  });

  // An empty FTS5 term is a syntax error rather than a match of nothing, so `deploy?` and `deploy`
  // have to be the same search.
  it.each(['deploy?', 'deploy!', '(deploy)', 'deploy.'])('drops punctuation around %s', (typed) => {
    expect(toMatchExpression(typed)).toBe('"deploy"*');
  });

  it('drops a token that is only punctuation', () => {
    expect(toMatchExpression('deploy -- now')).toBe('"deploy" "now"*');
  });

  it('keeps words that are not Latin, because the corpus has German and emoji in it', () => {
    expect(toMatchExpression('Größe ändern')).toBe('"Größe" "ändern"*');
  });

  it.each(['', '   ', '?!', '-- --'])(
    'answers undefined for %s, which is not a search',
    (typed) => {
      expect(toMatchExpression(typed)).toBeUndefined();
    },
  );

  // A cap rather than a truncation: a query longer than any sentence is not one somebody typed,
  // and silently searching for half of it would answer a question nobody asked.
  it('refuses a query longer than the cap', () => {
    expect(toMatchExpression('x'.repeat(MAX_QUERY_CHARS + 1))).toBeUndefined();
    expect(toMatchExpression('x'.repeat(MAX_QUERY_CHARS))).toBeDefined();
  });
});

describe('searchLimit', () => {
  it('takes a number the caller asked for', () => {
    expect(searchLimit('5')).toBe(5);
  });

  it('caps it, so one request cannot ask for the whole index', () => {
    expect(searchLimit(String(MAX_SEARCH_HITS + 1000))).toBe(MAX_SEARCH_HITS);
  });

  it.each([undefined, '', 'lots', '0', '-3', '1.5', Number.NaN])(
    'falls back to the default for %s',
    (value) => {
      expect(searchLimit(value)).toBe(DEFAULT_SEARCH_HITS);
    },
  );
});

describe('parseSearchHits', () => {
  const HIT = {
    subscription: '365',
    sessionId: 'aaaaaaaa-0000-0000-0000-000000000000',
    projectKey: 'C--work',
    kind: 'you',
    at: 1000,
    snippet: 'deploy to cloudflare',
  };

  it('reads a hit off the wire', () => {
    expect(parseSearchHits([HIT])).toEqual([HIT]);
  });

  // The deck draws what it can read and drops the rest, which is every parser in `contracts/`.
  it.each([
    { over: { subscription: 'other' }, why: 'a subscription nobody has' },
    { over: { kind: 'shouted' }, why: 'a kind this build does not draw' },
    { over: { at: '1000' }, why: 'an instant that is not a number' },
    { over: { snippet: 42 }, why: 'a snippet that is not text' },
    { over: { sessionId: undefined }, why: 'no session to go back to' },
  ])('drops a hit with $why', ({ over }) => {
    expect(parseSearchHits([{ ...HIT, ...over }])).toEqual([]);
  });

  it('keeps the readable hits beside an unreadable one', () => {
    expect(parseSearchHits([{ ...HIT, kind: 'shouted' }, HIT])).toEqual([HIT]);
  });

  it.each([undefined, null, {}, 'hits'])('answers an empty list for %s', (value) => {
    expect(parseSearchHits(value)).toEqual([]);
  });
});

describe('snippetAround', () => {
  const MATCH = '"cloudflare"*';

  it('leaves a short turn alone — there is nothing to cut', () => {
    expect(snippetAround('deploy to cloudflare', MATCH)).toBe('deploy to cloudflare');
  });

  it('cuts a window around the match rather than taking the first line', () => {
    const text = `${'padding '.repeat(200)}cloudflare${' tail'.repeat(200)}`;

    const snippet = snippetAround(text, MATCH);

    expect(snippet).toContain('cloudflare');
    expect(snippet.length).toBeLessThanOrEqual(SNIPPET_CHARS + 2);
  });

  it('says where it cut, at both ends', () => {
    const text = `${'padding '.repeat(200)}cloudflare${' tail'.repeat(200)}`;

    expect(snippetAround(text, MATCH)).toMatch(/^….*…$/u);
  });

  // A match in the first line must not produce a window that starts before the text does.
  it('does not mark the start as cut when the match is at the beginning', () => {
    const text = `cloudflare${' tail'.repeat(200)}`;

    expect(snippetAround(text, MATCH).startsWith('…')).toBe(false);
  });

  it('does not mark the end as cut when the match is at the end', () => {
    const text = `${'padding '.repeat(200)}cloudflare`;

    expect(snippetAround(text, MATCH).endsWith('…')).toBe(false);
  });

  // The terms are read back out of the expression that was searched with, so the window cannot be
  // cut around a different word from the one that matched.
  it('windows on the earliest term of a multi-word search', () => {
    const text = `${'a '.repeat(300)}workers${' b'.repeat(300)}cloudflare`;

    expect(snippetAround(text, '"workers" "cloudflare"*')).toContain('workers');
  });

  it('falls back to the beginning when no term is in the text at all', () => {
    const text = 'x'.repeat(1000);

    expect(snippetAround(text, MATCH).endsWith('…')).toBe(true);
  });

  // It is drawn as a React text node and never as markup (SEC-UI-2).
  it('adds no highlight markup', () => {
    const text = `${'padding '.repeat(200)}cloudflare${' tail'.repeat(200)}`;

    expect(snippetAround(text, MATCH)).not.toMatch(/[<>]/u);
  });
});
