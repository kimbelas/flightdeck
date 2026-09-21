// The recommendation, as the launch form prints it — P4-T3, CODING-STANDARDS §3.
//
// `recommendRouting` decided WHICH account and why; this decides only how that reads, the same
// split `QuotaGaugeViewModel` makes with `summariseQuota`. The verdict is a closed union precisely
// so the English lives on this side, in one place, assertable without rendering a page.
//
// **Every sentence names the numbers it was derived from.** "isg has more headroom" is advice the
// owner has to take on trust; "isg 40% free (7d) · 365 5% free (7d)" is advice they can check
// against the two gauges already in the header, which is the difference between a recommendation
// and an instruction. The window is named for the same reason — a reader looking at a 5-hour bar
// at 10 % needs to be told the advice came off the 7-day one, or it reads as a bug.
//
// **Overriding is not an error, and the sentence must not scold.** The picker keeps the owner's
// choice permanently once made (`LaunchForm`), so the only job left here is to keep stating what
// the other account looks like. `following` exists to change the emphasis, not to add a warning.
import {
  type QuotaRouting,
  type RoutingVerdict,
  type SubscriptionHeadroom,
} from '../../contracts/quota-routing.ts';
import type { ProfileFunction } from '../../contracts/launch-preset.ts';

export class RoutingViewModel {
  private readonly routing: QuotaRouting;
  private readonly chosen: ProfileFunction;

  constructor(routing: QuotaRouting, chosen: ProfileFunction) {
    this.routing = routing;
    this.chosen = chosen;
  }

  public get verdict(): RoutingVerdict {
    return this.routing.verdict;
  }

  /** What the picker should show before the owner has touched it, or `undefined` to leave it. */
  public get recommended(): ProfileFunction | undefined {
    return this.routing.recommended;
  }

  /** Whether the picker is currently on the recommendation. Drives emphasis, never a warning. */
  public get following(): boolean {
    return this.routing.recommended === undefined || this.routing.recommended === this.chosen;
  }

  /**
   * Whether any reading behind the advice is old enough to be worth qualifying.
   *
   * Reported, never used to withhold the advice (contracts/quota-routing.ts). An account with no
   * reading counts as stale, so `incomparable` is always qualified — which is correct: the reason
   * there is no recommendation is exactly that something has not reported.
   */
  public get stale(): boolean {
    return this.routing.headroom.some((entry) => entry.stale);
  }

  /** `quota-hint`, plus a modifier the smoke checks read as geometry rather than as prose. */
  public get className(): string {
    const following = this.following ? '' : ' quota-hint-overridden';
    return `quota-hint quota-hint-${this.routing.verdict}${following}`;
  }

  /**
   * The whole recommendation as one line.
   *
   * One line rather than a block, because it sits between a `select` and a `textarea` in a column
   * the owner is trying to get through quickly — advice that costs a paragraph to read is advice
   * that gets skipped, and the numbers behind it are already drawn twice in the header.
   */
  public get sentence(): string {
    const detail = this.headroomDetail;
    const head = this.headline;
    return detail === '' ? head : `${head} — ${detail}`;
  }

  /** The claim, without the numbers. Split out so the verdict switch stays inside 40 lines. */
  private get headline(): string {
    switch (this.routing.verdict) {
      case 'more_headroom':
        return this.following
          ? `most headroom: ${labelOf(this.routing.recommended)}`
          : `${labelOf(this.routing.recommended)} has more headroom`;
      case 'tie':
        return 'both accounts are level';
      case 'incomparable':
        return 'no recommendation — an account has not reported';
      case 'not_routable':
        return `${this.chosen} is isg by construction — nothing to swap`;
    }
  }

  /**
   * Both accounts' numbers, or `''` when there are none worth printing.
   *
   * Printed on every verdict that has them, including `tie` and an overridden `more_headroom`:
   * "these two are level" and "you are on the fuller one" are both answers, and both are only
   * checkable with the figures attached.
   */
  private get headroomDetail(): string {
    if (this.routing.verdict === 'not_routable') return '';
    const parts = this.routing.headroom.map(headroomLabel).filter((part) => part !== '');
    if (parts.length === 0) return '';
    return parts.join(' · ') + (this.stale ? ' · reading may be old' : '');
  }
}

/** `isg 40% free (7d)`, or `` for an account that has never reported. Never `0% free`. */
function headroomLabel(entry: SubscriptionHeadroom): string {
  if (entry.headroom === undefined) return `${entry.subscription} has not reported`;
  const window = entry.boundWindow === undefined ? '' : ` (${entry.boundWindow})`;
  return `${entry.subscription} ${String(Math.round(entry.headroom))}% free${window}`;
}

/** The function name, or a dash — `recommended` is `undefined` on three of the four verdicts. */
function labelOf(profileFn: ProfileFunction | undefined): string {
  return profileFn ?? '—';
}
