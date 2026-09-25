// The transcript search's client state — P7-T2, SPEC §5.8.
//
// **Its own store, not a slice of `DeckStore`.** Everything `DeckStore` holds is about the sessions
// that exist now and arrives on the stream; a search is about work that finished weeks ago and is
// asked for a keystroke at a time. Nothing in a session snapshot changes when somebody types
// `cloudflare`, and nothing here changes when a session starts, so the two have no state to share
// — the keyboard helper's client is outside the store for the same reason (P5a-T7).
//
// **The gate is felt, not only measured.** *"Where did I do that Cloudflare Workers deploy?"
// returns the session in under a second.* Core answers in milliseconds (G.56); what can make it
// feel slower is the deck. So the box searches as it is typed — after a short pause, so `c`, `cl`
// and `clo` are one request rather than three — a filter searches at once, and every reply that
// arrives after a newer request was sent is DROPPED: a slow answer to `clo` must never overwrite a
// fast answer to `cloudflare`. The round trip is timed and shown, so "under a second" is on screen.
import { CORE_SEARCH_PATH, CORE_SEARCH_TOOLS_PATH } from '../../contracts/deck-routes.ts';
import { searchQueryString, type SearchFilters } from '../../contracts/search-filters.ts';
import { parseSearchReply, type IndexProgress } from '../../contracts/search-reply.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import type { SearchHit } from '../../contracts/transcript-search.ts';
import { parseToolNames } from '../../contracts/transcript-tools.ts';
import type { DeckApi } from './deck-api.ts';

/** The date filter as a choice rather than two instants — what a select can hold. */
export const DATE_RANGES = ['any', 'day', 'week', 'month', 'older'] as const;
export type DateRange = (typeof DATE_RANGES)[number];

/** What the owner has chosen. `undefined` everywhere means "any". */
export interface SearchChoice {
  readonly query: string;
  readonly subscription: SubscriptionId | undefined;
  /** A transcript slug (`transcriptSlug`) — the value of the project select. */
  readonly project: string | undefined;
  readonly range: DateRange;
  readonly tool: string | undefined;
  /** A session id or its short form — set by a hit's "only this session". */
  readonly session: string | undefined;
}

export type SearchStatus = 'idle' | 'searching' | 'done' | 'failed';

export interface SearchState {
  readonly choice: SearchChoice;
  readonly status: SearchStatus;
  readonly hits: readonly SearchHit[];
  /** How far core's index has got, off the last reply. `undefined` until one has arrived. */
  readonly index: IndexProgress | undefined;
  /** The tool select's options, off `GET /search/tools`. */
  readonly tools: readonly string[];
  /** The last search's round trip in ms, as the browser measured it. */
  readonly tookMs: number | undefined;
}

/** A clock and a timer — the browser's, or a test's. `StreamTransport.wait`'s shape. */
export interface SearchClock {
  now(): number;
  /** @returns a cancel. Calling it after the task has run is a no-op. */
  wait(ms: number, task: () => void): () => void;
}

/** Long enough to swallow the keystrokes of one word, short enough not to be noticed. */
export const TYPING_PAUSE_MS = 150;

const DAY_MS = 86_400_000;
/** `cleanupPeriodDays`' default: past this, the index is the only copy (SPEC §5.8). */
const CLEANUP_DAYS = 30;

export const NO_CHOICE: SearchChoice = {
  query: '',
  subscription: undefined,
  project: undefined,
  range: 'any',
  tool: undefined,
  session: undefined,
};

/**
 * The wire filters for a choice, at `now`.
 *
 * `older` is `until` rather than `since`: it is the range the transcripts themselves no longer
 * cover — `cleanupPeriodDays` deletes them after thirty days — and the one the index exists for.
 */
export function filtersFor(choice: SearchChoice, now: number): SearchFilters {
  const days = { any: undefined, day: 1, week: 7, month: CLEANUP_DAYS, older: undefined };
  const within = days[choice.range];
  return {
    subscription: choice.subscription,
    project: choice.project,
    since: within === undefined ? undefined : now - within * DAY_MS,
    until: choice.range === 'older' ? now - CLEANUP_DAYS * DAY_MS : undefined,
    session: choice.session,
    tool: choice.tool,
  };
}

export class TranscriptSearchStore {
  private readonly api: DeckApi;
  private readonly clock: SearchClock;
  private readonly listeners = new Set<() => void>();
  private state: SearchState = {
    choice: NO_CHOICE,
    status: 'idle',
    hits: [],
    index: undefined,
    tools: [],
    tookMs: undefined,
  };
  /** Bumped per request; a reply carrying an older number is dropped — see the header. */
  private sequence = 0;
  private cancelPause: (() => void) | undefined;

  constructor(api: DeckApi, clock: SearchClock) {
    this.api = api;
    this.clock = clock;
  }

  /** For `useSyncExternalStore`. An arrow so it can be handed over unbound. */
  public readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public readonly snapshot = (): SearchState => this.state;

  /**
   * Reads the tool list and the index's progress — once, when the panel mounts.
   *
   * The progress comes from an EMPTY search, which core answers without touching the index: the
   * panel can say "still filling" before anybody has typed, which is when it matters most.
   */
  public async open(): Promise<void> {
    const [tools] = await Promise.all([this.api.get(CORE_SEARCH_TOOLS_PATH), this.search()]);
    if (tools?.status === 200) this.set({ tools: parseToolNames(tools.body) });
  }

  /** The box, a keystroke at a time. Searches after `TYPING_PAUSE_MS` of quiet. */
  public type(query: string): void {
    this.set({ choice: { ...this.state.choice, query } });
    this.cancelPause?.();
    this.cancelPause = this.clock.wait(TYPING_PAUSE_MS, () => {
      this.cancelPause = undefined;
      void this.search();
    });
  }

  /** A filter. Searches at once — a select is one deliberate change, not a word being typed. */
  public async choose(changes: Partial<Omit<SearchChoice, 'query'>>): Promise<void> {
    this.set({ choice: { ...this.state.choice, ...changes } });
    this.cancelPause?.();
    this.cancelPause = undefined;
    await this.search();
  }

  /** Every filter back to "any", the query kept. */
  public async clearFilters(): Promise<void> {
    const { subscription, project, range, tool, session } = NO_CHOICE;
    await this.choose({ subscription, project, range, tool, session });
  }

  /**
   * One request for the current choice.
   *
   * @returns once the reply is in, or dropped because a newer request went out after this one.
   */
  public async search(): Promise<void> {
    this.sequence += 1;
    const mine = this.sequence;
    const started = this.clock.now();
    const { choice } = this.state;
    this.set({ status: choice.query.trim() === '' ? this.state.status : 'searching' });
    const path = `${CORE_SEARCH_PATH}?${searchQueryString(choice.query, filtersFor(choice, started))}`;
    const reply = await this.api.get(path);
    if (mine !== this.sequence) return;
    if (reply?.status !== 200) {
      this.set({ status: 'failed', hits: [] });
      return;
    }
    const { hits, index } = parseSearchReply(reply.body);
    const typed = choice.query.trim() !== '';
    this.set({
      status: typed ? 'done' : 'idle',
      hits,
      index,
      tookMs: typed ? this.clock.now() - started : undefined,
    });
  }

  private set(changes: Partial<SearchState>): void {
    this.state = { ...this.state, ...changes };
    for (const listener of this.listeners) listener();
  }
}
