// Which subscription to start the next session on — P4-T3, SPEC §5.2, DECISIONS.md D46.
//
// `summariseQuota` answers "how full is each account". This answers the question the owner actually
// asks several times a day, which is a different one: "which of the two should I start this on".
// It is pure and in `contracts/` for the reason `summariseQuota` is — the launch form and
// `flightdeck-core status` both print a recommendation, and two screens recommending different
// accounts is worse than neither recommending anything.
//
// **Headroom is 100 minus the FULLER window, not minus the 5-hour one.** This is the whole rule and
// it is the one that is easy to get backwards. An account at 5h 10 % / 7d 95 % looks empty on the
// gauge the owner watches and has five points of room before it stops accepting work for days. The
// binding constraint is whichever window is closer to its limit, so that is the one that decides,
// and the routing names the window it decided on (`boundWindow`) rather than making the owner
// reconcile a recommendation against two bars that disagree.
//
// **Only two of the four profile functions may be swapped** (`ROUTABLE_PROFILE_FUNCTIONS`, D44).
// `claude-isg-ticket` pins `opusplan[1m]` and `claude-isg-orch` pins an agent; both export
// `~\.claude-isg` by construction. "Run this on whichever account has more headroom" is not a
// question that can be asked about them at all, so the answer here is `not_routable` — a named
// outcome the deck writes a sentence for, not a missing recommendation the picker quietly ignores.
//
// **A silent account is not an empty one.** No reading does not mean 100 % free, and the temptation
// to treat it that way is strong precisely when it is most wrong: an account nothing has run on all
// day is also the one whose 7-day window nobody has looked at. Two accounts cannot be compared
// unless both have answered, so one silent account produces `incomparable` and no pre-selection.
//
// **Staleness qualifies a recommendation, it never withdraws one.** A 5-hour window moves slowly
// and a twenty-minute-old reading is still the best number in existence; dropping it would leave
// the picker with no recommendation exactly on the idle machine where the owner is about to start
// the first session of the day. The age travels out with the answer and the deck says "as of 20m
// ago", the same bargain `QuotaGauge` already makes with the header.
import { isStaleReading, type QuotaSummary, type SubscriptionQuota } from './quota-summary.ts';
import {
  ROUTABLE_PROFILE_FUNCTIONS,
  subscriptionOfProfileFunction,
  type ProfileFunction,
} from './launch-preset.ts';
import type { SubscriptionId } from './session.ts';

/**
 * How far apart two accounts must be before a swap is worth recommending.
 *
 * A judgement, not a measurement — said plainly, because everything else in this file is measured.
 * The percentages are integers covering a window that moves in jumps as turns land, so a gap of a
 * point or two is a statement about which account happened to run the last turn rather than about
 * where the next one belongs. Recommending a swap on that would move the pre-selection under the
 * owner's cursor every few seconds, since a `quota` frame arrives on every statusLine render.
 *
 * Below this, the two are reported as a `tie` and the picker keeps whatever it is showing.
 */
export const ROUTING_MARGIN_POINTS = 5;

/** Which window decided a recommendation — the fuller one. Published, so the advice is checkable. */
export type BoundWindow = '5h' | '7d';

/** One account's side of the comparison, and the function that starts a session on it. */
export interface SubscriptionHeadroom {
  readonly profileFn: ProfileFunction;
  readonly subscription: SubscriptionId;
  /** 0–100, or `undefined` when neither window has a reading. Not zero — see the header. */
  readonly headroom: number | undefined;
  /** Which window `headroom` came off, or `undefined` with no reading at all. */
  readonly boundWindow: BoundWindow | undefined;
  /** Whether the reading behind it is old enough to be worth saying so about. */
  readonly stale: boolean;
}

/**
 * Why the routing says what it says.
 *
 * A closed union, the habit `PresetRefusal` set: this file names the cause and the deck writes the
 * English, so no sentence on screen was composed here. Every member is reachable, which is the
 * other half of that habit.
 */
export const ROUTING_VERDICTS = ['more_headroom', 'tie', 'incomparable', 'not_routable'] as const;
export type RoutingVerdict = (typeof ROUTING_VERDICTS)[number];

export interface QuotaRouting {
  readonly verdict: RoutingVerdict;
  /**
   * The function to pre-select, or `undefined` when nothing should move.
   *
   * `undefined` on every verdict but `more_headroom`. A tie, an unreadable pair and a pinned
   * function are three different reasons to leave the picker alone, and they are three different
   * sentences, but they are the same instruction.
   */
  readonly recommended: ProfileFunction | undefined;
  /** Both accounts, always both and always in `ROUTABLE_PROFILE_FUNCTIONS` order. */
  readonly headroom: readonly SubscriptionHeadroom[];
  /** The gap in points between the two, or `undefined` when they cannot be compared. */
  readonly marginPoints: number | undefined;
}

export interface RoutingOptions {
  /** When the question is being asked, epoch ms — for `stale`, never for the comparison itself. */
  readonly now: number;
  /**
   * What the picker is showing, when something is doing the picking.
   *
   * Passed in rather than assumed, because the answer genuinely depends on it: a routing asked
   * about `claude-isg-ticket` is `not_routable` whatever the gauges say, and that is information
   * the form needs in order to explain itself rather than a case to filter out beforehand.
   *
   * **Optional, because `flightdeck-core status` has no picker.** "Which account has more headroom"
   * is a question worth answering with nothing selected at all, and the CLI answering it through a
   * fake selection would be a lie that happened to produce the right string. Absent, the
   * `not_routable` short-circuit simply does not apply and the comparison is the whole answer.
   */
  readonly chosen?: ProfileFunction | undefined;
}

/**
 * The recommendation.
 *
 * Pure and total: same summary and same `chosen` in, same answer out, no clock read and no throw.
 *
 * @throws never.
 */
export function recommendRouting(summary: QuotaSummary, options: RoutingOptions): QuotaRouting {
  const headroom = ROUTABLE_PROFILE_FUNCTIONS.map((profileFn) =>
    headroomOf(summary, profileFn, options.now),
  );
  const chosen = options.chosen;
  if (chosen !== undefined && !ROUTABLE_PROFILE_FUNCTIONS.includes(chosen)) {
    return { verdict: 'not_routable', recommended: undefined, headroom, marginPoints: undefined };
  }
  return { ...compare(headroom), headroom };
}

/** The two sides, already computed, reduced to a verdict. Split out to stay inside 40 lines. */
function compare(headroom: readonly SubscriptionHeadroom[]): Omit<QuotaRouting, 'headroom'> {
  const [best, rest] = [...headroom].sort(byHeadroomDescending);
  if (best?.headroom === undefined || rest?.headroom === undefined) {
    return { verdict: 'incomparable', recommended: undefined, marginPoints: undefined };
  }
  const marginPoints = best.headroom - rest.headroom;
  if (marginPoints < ROUTING_MARGIN_POINTS) {
    return { verdict: 'tie', recommended: undefined, marginPoints };
  }
  return { verdict: 'more_headroom', recommended: best.profileFn, marginPoints };
}

/**
 * One account's headroom, off the fuller of its two windows.
 *
 * A window with no reading does not count against the account — the two arrive together from one
 * payload (RESEARCH.md F.3.5), so a lone answered window is a real constraint rather than half of
 * one, and refusing to compare on it would blank the recommendation on a fresh session's first
 * render. An account with NEITHER window answered has no headroom value at all, which is the case
 * `incomparable` is made of.
 */
function headroomOf(
  summary: QuotaSummary,
  profileFn: ProfileFunction,
  now: number,
): SubscriptionHeadroom {
  const subscription = subscriptionOfProfileFunction(profileFn);
  const fullest = fullestWindow(
    summary.subscriptions.find((entry) => entry.subscription === subscription),
  );
  return {
    profileFn,
    subscription,
    headroom: fullest === undefined ? undefined : 100 - fullest.used,
    boundWindow: fullest?.window,
    stale: fullest === undefined || isStaleReading(fullest.at, now),
  };
}

interface WindowReading {
  readonly window: BoundWindow;
  readonly used: number;
  readonly at: number | undefined;
}

/** The answered window closest to its limit, or `undefined` when neither answered. */
function fullestWindow(quota: SubscriptionQuota | undefined): WindowReading | undefined {
  if (quota === undefined) return undefined;
  const pairs = [
    { window: '5h', gauge: quota.fiveHour },
    { window: '7d', gauge: quota.sevenDay },
  ] as const;
  return pairs
    .flatMap<WindowReading>(({ window, gauge }) =>
      gauge.usedPercentage === undefined
        ? []
        : [{ window, used: gauge.usedPercentage, at: gauge.at }],
    )
    .reduce<WindowReading | undefined>(
      (worst, entry) => (worst === undefined || entry.used > worst.used ? entry : worst),
      undefined,
    );
}

/** Most headroom first; an account with no reading sorts last, so `incomparable` is one check. */
function byHeadroomDescending(left: SubscriptionHeadroom, right: SubscriptionHeadroom): number {
  if (left.headroom === undefined) return right.headroom === undefined ? 0 : 1;
  if (right.headroom === undefined) return -1;
  return right.headroom - left.headroom;
}
