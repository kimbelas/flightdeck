// The five filters a search can carry — P7-T2, SPEC §5.8.
//
// SPEC names them in one line: *project, subscription, date, tool, session.* Each is a narrowing of
// the same FTS5 query, never a second search, so they live here beside the query's own screen and
// both ends read the parameter names from one table — a deck that spelled `since` as `from` would
// be a filter core never saw, and a search that silently came back WIDER than asked.
//
// **A filter that does not parse is refused, not dropped.** The query itself is never a 400
// (`search-route.ts`), because it is typed a character at a time. A filter is not typed: the deck
// builds it from a select, so a malformed one is a bug, and dropping it would answer a narrower
// question with a wider answer that looks exactly like the narrow one.
//
// **Nothing here reaches SQL as text.** Every value is a bound parameter (SEC-DATA-3); the shapes
// below exist so that what is bound is something the index could hold, and so that a slug used in
// a `LIKE` cannot carry a `%` or a `_` — the one place a bound parameter still has a grammar.
import { SUBSCRIPTION_IDS, type SubscriptionId } from './session.ts';
import { TOOL_NAME } from './transcript-tools.ts';

export interface SearchFilters {
  readonly subscription: SubscriptionId | undefined;
  /**
   * A transcript slug folder (`C--work-app`) — the project's ROOT.
   *
   * Its worktrees match too: Claude Code files a worktree's transcripts under the root's slug plus
   * `--claude-worktrees-<name>`, and "where did I do that" asked of a project means every tree of
   * it. See `transcriptSlug` for the spelling.
   */
  readonly project: string | undefined;
  /** Epoch ms, inclusive: only lines written at or after this. */
  readonly since: number | undefined;
  /** Epoch ms, exclusive: only lines written before this — the "older than 30 days" range. */
  readonly until: number | undefined;
  /** A full session uuid, or the eight-hex short id that starts one. */
  readonly session: string | undefined;
  /** A tool the session called at least once — `Bash`, `WebFetch`, `mcp__github__create_pr`. */
  readonly tool: string | undefined;
}

export const NO_FILTERS: SearchFilters = {
  subscription: undefined,
  project: undefined,
  since: undefined,
  until: undefined,
  session: undefined,
  tool: undefined,
};

/** The query-string names, both ends. `q` and `limit` are P7-T1's and keep their spelling. */
export const SEARCH_PARAMS = {
  query: 'q',
  limit: 'limit',
  subscription: 'subscription',
  project: 'project',
  since: 'since',
  until: 'until',
  session: 'session',
  tool: 'tool',
} as const;

/**
 * Letters, digits and `-` only, because that is all Claude Code leaves in a slug — and because the
 * slug is bound into a `LIKE`, where `%` and `_` would be wildcards rather than characters.
 */
const SLUG = /^[A-Za-z0-9-]{1,400}$/u;
/** A uuid or its first block. Lowercase hex, as every session id that crosses a boundary is. */
const SESSION = /^[0-9a-f]{8}(?:-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/u;
/** Epoch ms as digits. Thirteen is today; fifteen is the year 5138, and anything longer is noise. */
const INSTANT = /^\d{1,15}$/u;

/** The filters off a query string, or `undefined` when one of them is not a filter at all. */
export function parseSearchFilters(
  parameters: Readonly<Record<string, string>>,
): SearchFilters | undefined {
  const read = (name: keyof typeof SEARCH_PARAMS): string | undefined => {
    const value = parameters[SEARCH_PARAMS[name]];
    return value === undefined || value === '' ? undefined : value;
  };
  const subscription = read('subscription');
  const known = SUBSCRIPTION_IDS.find((id) => id === subscription);
  const filters: SearchFilters = {
    subscription: known,
    project: read('project'),
    since: instantOf(read('since')),
    until: instantOf(read('until')),
    session: read('session'),
    tool: read('tool'),
  };
  if (subscription !== undefined && known === undefined) return undefined;
  if (read('since') !== undefined && filters.since === undefined) return undefined;
  if (read('until') !== undefined && filters.until === undefined) return undefined;
  return shaped(filters) ? filters : undefined;
}

/** Whether every string filter has a shape the index could hold. */
function shaped(filters: SearchFilters): boolean {
  if (filters.project !== undefined && !SLUG.test(filters.project)) return false;
  if (filters.session !== undefined && !SESSION.test(filters.session)) return false;
  return filters.tool === undefined || TOOL_NAME.test(filters.tool);
}

function instantOf(value: string | undefined): number | undefined {
  return value !== undefined && INSTANT.test(value) ? Number(value) : undefined;
}

/**
 * The query string for one search — the deck's half of `parseSearchFilters`.
 *
 * An absent filter is an absent parameter, never `project=` — so what core reads back is exactly
 * what was chosen, and the URL of an unfiltered search is still just `?q=…`.
 */
export function searchQueryString(query: string, filters: SearchFilters): string {
  const parameters = new URLSearchParams({ [SEARCH_PARAMS.query]: query });
  const entries: readonly [keyof typeof SEARCH_PARAMS, string | number | undefined][] = [
    ['subscription', filters.subscription],
    ['project', filters.project],
    ['since', filters.since],
    ['until', filters.until],
    ['session', filters.session],
    ['tool', filters.tool],
  ];
  for (const [name, value] of entries) {
    if (value !== undefined) parameters.set(SEARCH_PARAMS[name], String(value));
  }
  return parameters.toString();
}

/**
 * The folder Claude Code files a directory's transcripts under.
 *
 * **Every character that is not a letter or a digit becomes `-`**, read off this machine's own
 * `projects/` folders: `xpert-new\.claude\worktrees\xweb-1941` is
 * `…-xpert-new--claude-worktrees-xweb-1941` (the `.` went too) and `Local Sites` is `Local-Sites`.
 * `observed-reader.ts`'s `projectSlug` replaces only separators and the colon, which is the same
 * answer for every folder imported today and a different one for a folder with a dot or a space
 * in its name.
 */
export function transcriptSlug(path: string): string {
  return path.replaceAll(/[^A-Za-z0-9]/gu, '-');
}

/**
 * The slug a worktree of `rootSlug` is filed under — the prefix the project filter also matches.
 *
 * `--claude-worktrees-` is `\.claude\worktrees\` through `transcriptSlug`: both separators and the
 * dot. Anything else under the root (`app\src`) is a directory nobody starts a session in by
 * accident, and matching every slug that merely STARTS with the root would make `xpert` match
 * `xpert-new`.
 */
export function worktreeSlugPrefix(rootSlug: string): string {
  return `${rootSlug}--claude-worktrees-`;
}
