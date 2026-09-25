// SPEC §5.8's filters on the wire — P7-T2. Both ends read the same table, so a round trip through
// `searchQueryString` and `parseSearchFilters` is the test that the two cannot drift apart.
import { describe, expect, it } from 'vitest';
import {
  NO_FILTERS,
  parseSearchFilters,
  searchQueryString,
  transcriptSlug,
  worktreeSlugPrefix,
  type SearchFilters,
} from '../../contracts/search-filters.ts';

function parsed(query: string): SearchFilters | undefined {
  return parseSearchFilters(Object.fromEntries(new URLSearchParams(query)));
}

const EVERY: SearchFilters = {
  subscription: 'isg',
  project: 'C--work-app',
  since: 1_700_000_000_000,
  until: 1_800_000_000_000,
  session: 'aaaaaaaa-0000-4000-8000-000000000001',
  tool: 'mcp__github__create_pr',
};

describe('the search filters', () => {
  it('reads no filters from a query that names none', () => {
    expect(parsed('q=deploy')).toEqual(NO_FILTERS);
  });

  it('reads an empty parameter as absent, not as a filter on the empty string', () => {
    expect(parsed('q=deploy&project=&tool=')).toEqual(NO_FILTERS);
  });

  it('round-trips every filter through the query string the deck builds', () => {
    expect(parsed(searchQueryString('deploy', EVERY))).toEqual(EVERY);
  });

  it('writes nothing for a filter that is not set, so an unfiltered search is just ?q=', () => {
    expect(searchQueryString('cloudflare workers', NO_FILTERS)).toBe('q=cloudflare+workers');
  });

  it('takes a short session id as well as a full one', () => {
    expect(parsed('session=aaaaaaaa')?.session).toBe('aaaaaaaa');
  });

  it.each([
    ['an unknown subscription', 'subscription=work'],
    ['a path where a slug belongs', 'project=C:%5Cwork'],
    ['a LIKE wildcard in a slug', 'project=C--w%25rk'],
    ['an underscore in a slug', 'project=C--w_rk'],
    ['a word where an instant belongs', 'since=yesterday'],
    ['a negative instant', 'until=-1'],
    ['a fractional instant', 'since=1.5'],
    ['an uppercase session id', 'session=AAAAAAAA'],
    ['half a session id', 'session=aaaa'],
    ['markup where a tool name belongs', 'tool=%3Cb%3E'],
  ])('refuses %s rather than dropping it', (reason, query) => {
    expect(reason).not.toBe('');
    expect(parsed(query)).toBeUndefined();
  });
});

describe('transcriptSlug', () => {
  // Read off this machine's own `projects/` folders — see the function.
  it.each([
    ['C:\\Users\\ada\\dev\\flightdeck', 'C--Users-ada-dev-flightdeck'],
    [
      'C:\\Users\\ada\\dev\\xpert-new\\.claude\\worktrees\\xweb-1941',
      'C--Users-ada-dev-xpert-new--claude-worktrees-xweb-1941',
    ],
    ['C:\\Users\\ada\\Local Sites\\acj', 'C--Users-ada-Local-Sites-acj'],
  ])('files %s under %s', (path, slug) => {
    expect(transcriptSlug(path)).toBe(slug);
  });

  it('puts a worktree of the root under the root’s slug plus the worktree prefix', () => {
    const root = transcriptSlug('C:\\dev\\app');

    expect(transcriptSlug('C:\\dev\\app\\.claude\\worktrees\\t1')).toBe(
      `${worktreeSlugPrefix(root)}t1`,
    );
  });

  it('always produces a slug the filter accepts', () => {
    const slug = transcriptSlug('C:\\Users\\Ada Lovelace\\my_app.v2');

    expect(parsed(`project=${slug}`)?.project).toBe(slug);
  });
});
