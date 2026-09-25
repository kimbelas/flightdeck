// What a search asks for and what comes back — P7-T1, SPEC §5.8.
//
// The phase gate is one sentence: *"Where did I do that Cloudflare Workers deploy?" returns the
// session in under a second.* So the answer is a list of SESSIONS with the line that matched, not
// a list of lines — somebody searching is looking for a conversation to go back to.
//
// **The query is passed to FTS5, so it is screened here rather than escaped later.** FTS5 has a
// query syntax of its own: `"` quotes a phrase, `*` is a prefix, `NEAR`, `AND`, `OR` and `NOT` are
// operators, and `^` anchors. A query nobody screened turns a typo into a syntax error and a `"`
// into a parse failure, and the honest fix is not to escape but to decide: **everything the owner
// types is a bag of words**, quoted term by term, with a trailing `*` on the last one so that
// typing continues to narrow as it is typed. Nobody gets an operator and nobody gets an error.
//
// **Every word has to appear** — FTS5's implicit conjunction, kept. That is what a search box does
// and what makes a second word narrow rather than widen, and it is why the box takes the WORDS
// from the phase gate's question rather than the question: a transcript that has to contain
// "where" and "did" as well is a sentence nobody wrote.
//
// **Nothing here is interpolated into SQL.** The screened string is a bound parameter like every
// other (SEC-DATA-3); the screening is about FTS5's grammar, not about SQL's.
import { SUBSCRIPTION_IDS, type SubscriptionId } from './session.ts';
import { PROSE_KINDS, type ProseKind } from './transcript-prose.ts';

/** Long enough for a sentence somebody remembers, short enough that no query is a workload. */
export const MAX_QUERY_CHARS = 200;

/** The most hits one request can ask for, and what it gets when it asks for none. */
export const MAX_SEARCH_HITS = 50;
export const DEFAULT_SEARCH_HITS = 20;

/** One session that matched, with the line that matched in it. */
export interface SearchHit {
  readonly subscription: SubscriptionId;
  readonly sessionId: string;
  /** The transcript's slug folder — how P7-T2 will filter by project without a second read. */
  readonly projectKey: string;
  readonly kind: ProseKind;
  /** When the matching line was written, epoch ms. `0` when the line carried no timestamp. */
  readonly at: number;
  /**
   * The matching text, with the match in it.
   *
   * Model- or user-written text. It is rendered as a React text node and never as markup
   * (SEC-UI-2), which is why it carries no highlight markers — a `<b>` in a snippet would be a
   * string from a transcript that something downstream is tempted to interpret.
   */
  readonly snippet: string;
}

/**
 * One typed query as an FTS5 MATCH expression, or `undefined` when there is nothing to search for.
 *
 * Every token is quoted, which turns FTS5's operators back into ordinary words: somebody searching
 * for `NOT found` means those two words. The last token gets a `*` so a query narrows while it is
 * being typed, which is what makes the gate's "under a second" felt rather than measured.
 *
 * `"` is stripped from inside a token rather than escaped, because a quote inside a word is not
 * something anybody searched for on purpose and doubling it would silently change the term.
 *
 * @throws never.
 */
export function toMatchExpression(query: string): string | undefined {
  if (typeof query !== 'string' || query.length > MAX_QUERY_CHARS) return undefined;
  const tokens = query
    .split(/\s+/u)
    // Stripped at the EDGES only: `deploy?` and `deploy` have to be the same search, and
    // `cloudflare-workers` has to stay one quoted phrase rather than becoming `cloudflareworkers`.
    // What is left inside is tokenized by FTS5, which is the thing that knows how.
    .map((token) =>
      token
        .replaceAll('"', '')
        .replace(/^[^\p{L}\p{N}]+/u, '')
        .replace(/[^\p{L}\p{N}]+$/u, ''),
    )
    // A token that was only punctuation is now empty, and an empty FTS5 term is a syntax error
    // rather than a match of nothing.
    .filter((token) => token !== '');
  if (tokens.length === 0) return undefined;
  const last = tokens.length - 1;
  return tokens.map((token, index) => `"${token}"${index === last ? '*' : ''}`).join(' ');
}

/** How many hits to return for a `limit` off the wire. Out of range falls back to the default. */
export function searchLimit(value: unknown): number {
  // Digits and nothing else. `Number.parseInt` would read `1.5` as 1 and `20 sessions` as 20,
  // which is a request nobody made being answered as though they had made a different one.
  const parsed = typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isInteger(parsed)) return DEFAULT_SEARCH_HITS;
  if (parsed < 1) return DEFAULT_SEARCH_HITS;
  return Math.min(parsed, MAX_SEARCH_HITS);
}

/**
 * How much of a matching turn a row shows.
 *
 * 240 characters — about three lines in the deck's font, which is enough to recognise a
 * conversation and not enough to push the next hit off the page. An 8 KB assistant turn drawn in
 * full would be one result per screen.
 */
export const SNIPPET_CHARS = 240;

/**
 * A window of `text` around the first term of `match`, with `…` where it was cut.
 *
 * Here rather than in SQL because FTS5's `snippet()` cannot run in the aggregate query that picks
 * one hit per session, and here rather than in the adapter because it is a pure decision about
 * what a row shows — testable without a database.
 *
 * **No highlight markup, deliberately.** The result is drawn as a React text node and never as
 * markup (SEC-UI-2); a `<b>` around the match would be a string out of a transcript that something
 * downstream is tempted to interpret.
 *
 * @param match the expression `toMatchExpression` built — the quoted terms are read back out of it
 * rather than being passed a second time, so the window cannot be cut around a different word from
 * the one that was searched for.
 * @throws never.
 */
export function snippetAround(text: string, match: string): string {
  if (text.length <= SNIPPET_CHARS) return text;
  const at = firstTermAt(text, match);
  // Centred on the match, then clamped to the ends: a match in the first line should not produce a
  // window that starts before the text does.
  const start = Math.max(0, Math.min(at - SNIPPET_CHARS / 3, text.length - SNIPPET_CHARS));
  const end = Math.min(text.length, start + SNIPPET_CHARS);
  const head = start > 0 ? '…' : '';
  const tail = end < text.length ? '…' : '';
  return `${head}${text.slice(start, end).trim()}${tail}`;
}

/** Where the earliest searched-for term appears in `text`, or 0 when none of them does. */
function firstTermAt(text: string, match: string): number {
  const lower = text.toLowerCase();
  let earliest = -1;
  for (const [, term] of match.matchAll(/"([^"]*)"/gu)) {
    const found = lower.indexOf((term ?? '').toLowerCase());
    if (found !== -1 && (earliest === -1 || found < earliest)) earliest = found;
  }
  return earliest === -1 ? 0 : earliest;
}

/** One hit off the wire, or `undefined`. The deck draws what it can read and drops the rest. */
export function parseSearchHit(value: unknown): SearchHit | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value));
  const subscription = SUBSCRIPTION_IDS.find((known) => known === fields['subscription']);
  const kind = PROSE_KINDS.find((known) => known === fields['kind']);
  const sessionId = fields['sessionId'];
  const projectKey = fields['projectKey'];
  const snippet = fields['snippet'];
  const at = fields['at'];
  if (subscription === undefined || kind === undefined) return undefined;
  if (typeof sessionId !== 'string' || typeof projectKey !== 'string') return undefined;
  if (typeof snippet !== 'string' || typeof at !== 'number') return undefined;
  return { subscription, sessionId, projectKey, kind, at, snippet };
}

/** Every hit in a `GET /search` body. @throws never. */
export function parseSearchHits(value: unknown): readonly SearchHit[] {
  if (!Array.isArray(value)) return [];
  const hits: SearchHit[] = [];
  for (const entry of value) {
    const hit = parseSearchHit(entry);
    if (hit !== undefined) hits.push(hit);
  }
  return hits;
}
