// What the machine has spent, per project, subscription and week — P7-T3, SPEC §6(9).
//
// P7's goal is one clause of this: *cost visible per project, subscription and week.* The header's
// `spendUsd` (P2-T3) answers "today, for the sessions that reported since midnight", and the
// observed reading (P3-T5) answers "this folder, ever, if you press the button". Neither answers
// "what did last week cost, and where did it go", which is what this is.
//
// **Every number is Claude Code's own** (D5). A `cost-state` line carries `totalCostUSD`, the lines
// and the per-model tokens as the CLI computed them; nothing here multiplies a token count by a
// rate. What Flightdeck adds is the arithmetic between two of those lines — a running total per
// claude process becomes an amount per week — and `core/domain/spend-fold.ts` is where that lives.
//
// **A session's spend lands when its run ENDS.** Measured over the 423 transcripts on this machine:
// 679 `cost-state` lines, 283 of them the file's very last line and 533 within its last five
// (RESEARCH.md G.59). Claude Code writes one when a process exits or detaches, not per turn. So a
// session working right now is not in here yet — its live figure is the header's, off the status
// line — and a run that spans a Sunday midnight lands in the week it ended in.
import { SUBSCRIPTION_IDS, type SubscriptionId } from './session.ts';

/** How many weeks a summary covers, this one included. Eight: two months, one screen of bars. */
export const SPEND_WEEKS = 8;

/**
 * How many projects a summary names before it folds the rest into a count.
 *
 * Twelve. This machine has 19 slug folders across both subscriptions; the long tail of a one-off
 * folder with $0.40 in it is not what anybody opens a cost panel to read.
 */
export const MAX_SPEND_PROJECTS = 12;

/** What one slice of the history adds up to. Every field is a sum except `sessions`. */
export interface SpendFigures {
  /** US dollars, as Claude Code computed them (D5). Not whole — `$0.12` is a real answer. */
  readonly costUsd: number;
  /** Transcripts that reported in this slice. A distinct count, never a sum of two slices'. */
  readonly sessions: number;
  readonly linesAdded: number;
  readonly linesRemoved: number;
  /**
   * Input tokens, across every model: sent, read from cache and written to it.
   *
   * One number rather than three, because on this machine the cache read is 99 % of it and a
   * panel that drew three columns would draw one number and two rounding errors.
   */
  readonly tokensIn: number;
  readonly tokensOut: number;
}

export const NO_SPEND: SpendFigures = {
  costUsd: 0,
  sessions: 0,
  linesAdded: 0,
  linesRemoved: 0,
  tokensIn: 0,
  tokensOut: 0,
};

/** One subscription's share of a week, or of a project. */
export interface SubscriptionSpend {
  readonly subscription: SubscriptionId;
  readonly figures: SpendFigures;
}

export interface WeekSpend {
  /** Local midnight on the Monday that starts it, epoch ms — `weekStartOf`'s answer. */
  readonly weekStart: number;
  /** Only the subscriptions that spent anything. An empty list is a real week with nothing in it. */
  readonly subscriptions: readonly SubscriptionSpend[];
}

export interface ProjectSpend {
  /**
   * The transcript folder — `C--Users-…-flightdeck`, Claude Code's spelling of the cwd.
   *
   * The key rather than a path because it is all a transcript says: the slug is lossy (every
   * separator, dot and `-` look the same), so a path is never reconstructed from it. The deck
   * names it, by matching it against the imported folders' own slugs (`projectSlug`).
   */
  readonly projectKey: string;
  readonly subscriptions: readonly SubscriptionSpend[];
}

/** How much of the history the ledger has read — P7-T1's lesson: say the index is still filling. */
export interface SpendCoverage {
  /** Transcripts the last walk found, across both subscriptions. */
  readonly transcripts: number;
  /** Of those, the ones with bytes still unread when the pass's budget ran out. */
  readonly behind: number;
  /** Passes completed since core started. `0` means nothing has been read yet in this boot. */
  readonly passes: number;
}

export interface SpendSummary {
  /** When it was put together, epoch ms. */
  readonly at: number;
  /** Exactly `SPEND_WEEKS` of them, oldest first, with empty weeks included — a gap is data. */
  readonly weeks: readonly WeekSpend[];
  /** Over the whole window, costliest first, at most `MAX_SPEND_PROJECTS`. */
  readonly projects: readonly ProjectSpend[];
  /** How many more projects spent something in the window and were folded out of `projects`. */
  readonly otherProjects: number;
  readonly coverage: SpendCoverage;
}

/**
 * The Monday that starts the week `at` falls in, at local midnight, epoch ms.
 *
 * Local rather than UTC, for the header's reason: `spendUsd` is "since local midnight", and a week
 * that turned over at 02:00 on a Monday in Berlin would put Sunday night's work in the wrong bar.
 * Calendar arithmetic rather than `- 7 * 24 h`, so a week containing a DST change is still one.
 */
export function weekStartOf(at: number): number {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  // `getDay` is 0 for Sunday; the week starts on Monday (ISO 8601).
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day.getTime();
}

/** The `count` week starts ending with this week's, oldest first. */
export function recentWeekStarts(now: number, count = SPEND_WEEKS): readonly number[] {
  const starts: number[] = [];
  const cursor = new Date(weekStartOf(now));
  for (let week = 0; week < count; week += 1) {
    starts.unshift(cursor.getTime());
    cursor.setDate(cursor.getDate() - 7);
  }
  return starts;
}

/** Two slices, added. `sessions` too — callers only add slices that cannot share a transcript. */
export function addFigures(left: SpendFigures, right: SpendFigures): SpendFigures {
  return {
    costUsd: left.costUsd + right.costUsd,
    sessions: left.sessions + right.sessions,
    linesAdded: left.linesAdded + right.linesAdded,
    linesRemoved: left.linesRemoved + right.linesRemoved,
    tokensIn: left.tokensIn + right.tokensIn,
    tokensOut: left.tokensOut + right.tokensOut,
  };
}

/** Every subscription's figures in a share list, added — a week's or a project's total. */
export function totalOf(shares: readonly SubscriptionSpend[]): SpendFigures {
  return shares.reduce((sum, share) => addFigures(sum, share.figures), NO_SPEND);
}

/** One reply off `GET /analytics/spend`. @throws never. */
export function parseSpendSummary(value: unknown): SpendSummary | undefined {
  const fields = asRecord(value);
  if (fields === undefined) return undefined;
  const at = fields['at'];
  const weeks = fields['weeks'];
  const projects = fields['projects'];
  if (typeof at !== 'number' || !Number.isFinite(at)) return undefined;
  if (!Array.isArray(weeks) || !Array.isArray(projects)) return undefined;
  return {
    at,
    weeks: weeks.flatMap(weekOf).slice(-SPEND_WEEKS),
    projects: projects.flatMap(projectOf).slice(0, MAX_SPEND_PROJECTS),
    otherProjects: whole(fields['otherProjects']),
    coverage: coverageOf(fields['coverage']),
  };
}

function weekOf(value: unknown): readonly WeekSpend[] {
  const fields = asRecord(value);
  const weekStart = fields?.['weekStart'];
  if (typeof weekStart !== 'number' || !Number.isFinite(weekStart)) return [];
  return [{ weekStart, subscriptions: sharesOf(fields?.['subscriptions']) }];
}

function projectOf(value: unknown): readonly ProjectSpend[] {
  const fields = asRecord(value);
  const projectKey = fields?.['projectKey'];
  if (typeof projectKey !== 'string' || projectKey === '') return [];
  return [
    {
      projectKey: projectKey.slice(0, MAX_KEY_CHARS),
      subscriptions: sharesOf(fields?.['subscriptions']),
    },
  ];
}

function sharesOf(value: unknown): readonly SubscriptionSpend[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    const fields = asRecord(entry);
    const subscription = SUBSCRIPTION_IDS.find((id) => id === fields?.['subscription']);
    if (subscription === undefined) return [];
    return [{ subscription, figures: figuresOf(fields?.['figures']) }];
  });
}

function figuresOf(value: unknown): SpendFigures {
  const fields = asRecord(value);
  return {
    costUsd: positive(fields?.['costUsd']),
    sessions: whole(fields?.['sessions']),
    linesAdded: whole(fields?.['linesAdded']),
    linesRemoved: whole(fields?.['linesRemoved']),
    tokensIn: whole(fields?.['tokensIn']),
    tokensOut: whole(fields?.['tokensOut']),
  };
}

function coverageOf(value: unknown): SpendCoverage {
  const fields = asRecord(value);
  return {
    transcripts: whole(fields?.['transcripts']),
    behind: whole(fields?.['behind']),
    passes: whole(fields?.['passes']),
  };
}

/** A slug is a cwd with its separators replaced; `MAX_PROJECT_PATH_CHARS` is the same order. */
const MAX_KEY_CHARS = 260;

function whole(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** Cost is not whole, and flooring it would report nothing spent — `observed-behaviour.ts`'s rule. */
function positive(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}
