// One subscription's gauges, as the header prints them — P2-T3, CODING-STANDARDS §3.
//
// The twin of `SessionRowViewModel` and for the same reason: "how full is this window and how long
// until it resets" is a question worth answering without rendering a page. `summariseQuota` already
// decided *which reading* — that is core's, so both subscribers agree — and this decides only how
// it reads.
//
// **Three things here are past-tense traps, and all three are the same trap.** A gauge can be old:
// the statusLine posts per render, so a subscription nobody is working on stops reporting and its
// numbers stand still.
//
//   1. `resetsAt` can be in the past. A window that rolled over while nothing was running leaves a
//      deck counting down to an instant that has already gone by, and a naive subtraction prints
//      the countdown as a negative or, worse, as `0m` forever. `resetsIn` answers `undefined` and
//      the header says nothing rather than something wrong.
//   2. The percentage is as old as `at`. It is still the best number anybody has — a 5 h window
//      moves slowly — so it is shown, with its age, and dimmed past `QUOTA_STALE_AFTER_MS`.
//   3. A gauge with no reading at all is not a gauge at 0 %. `undefined` survives to the bar's
//      width, which is why `barPercent` is `undefined` rather than `0` and the track renders empty.
//
// **`now` is a parameter, never `Date.now()`.** The deck already ticks a clock for the "started 4 m
// ago" column (deck-view.tsx) and one clock is what keeps the countdown and the ages in step — and
// what makes every sentence below assertable against a fixed instant.
import {
  isStaleReading,
  type QuotaGauge,
  type SubscriptionQuota,
} from '../../contracts/quota-summary.ts';

/** How a gauge should read: `ok` under pressure, `warn` and `high` above it, `none` with no number. */
export type GaugeTone = 'none' | 'ok' | 'warn' | 'high';

/** Where the bar changes colour. Quota is the one number whose last 20 % is the whole story. */
const WARN_PERCENT = 75;
const HIGH_PERCENT = 90;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

export class QuotaGaugeViewModel {
  private readonly gauge: QuotaGauge;
  private readonly label: string;

  constructor(gauge: QuotaGauge, label: string) {
    this.gauge = gauge;
    this.label = label;
  }

  /** `5h` or `7d`. The window, not the reading. */
  public get windowLabel(): string {
    return this.label;
  }

  /** `42%`, or `—` for a window no session has reported. Never `0%` for "no reading". */
  public get percentLabel(): string {
    const used = this.gauge.usedPercentage;
    return used === undefined ? '—' : `${String(Math.round(used))}%`;
  }

  /** The bar's width as a percentage, or `undefined` to leave the track empty. See trap 3. */
  public get barPercent(): number | undefined {
    return this.gauge.usedPercentage;
  }

  public get tone(): GaugeTone {
    const used = this.gauge.usedPercentage;
    if (used === undefined) return 'none';
    if (used >= HIGH_PERCENT) return 'high';
    if (used >= WARN_PERCENT) return 'warn';
    return 'ok';
  }

  /**
   * How long until this window resets, as `2h 14m` — or `undefined`.
   *
   * `undefined` for three different absences that all mean the same thing on screen: no reading, no
   * `resets_at` in the payload, and a reset instant that has already passed (trap 1).
   */
  public resetsIn(now: number): string | undefined {
    const resetsAt = this.gauge.resetsAt;
    if (resetsAt === undefined || resetsAt <= now) return undefined;
    return untilLabel(resetsAt - now);
  }

  /** `stale` once the reading is old enough to be worth doubting, which the header dims on. */
  public isStale(now: number): boolean {
    return isStaleReading(this.gauge.at, now);
  }

  /**
   * The whole gauge as one sentence, for the `title`.
   *
   * It exists because the bar is four characters wide and every number on it is qualified: which
   * window, how old the reading is, and when it rolls over. A tooltip is where the qualification
   * fits, and leaving it out is how a 20-minute-old `42%` gets read as current.
   */
  public detail(now: number): string {
    const parts = [`${this.label} window: ${this.percentLabel} used`];
    const resets = this.resetsIn(now);
    if (resets !== undefined) parts.push(`resets in ${resets}`);
    parts.push(
      this.gauge.at === undefined ? 'no reading yet' : `as of ${agoLabel(now - this.gauge.at)} ago`,
    );
    return parts.join(' · ');
  }
}

export class SubscriptionQuotaViewModel {
  private readonly quota: SubscriptionQuota;

  constructor(quota: SubscriptionQuota) {
    this.quota = quota;
  }

  /** Stable across renders and unique per subscription — React's key, and the test's handle. */
  public get key(): string {
    return this.quota.subscription;
  }

  public get label(): string {
    return this.quota.subscription;
  }

  public get fiveHour(): QuotaGaugeViewModel {
    return new QuotaGaugeViewModel(this.quota.fiveHour, '5h');
  }

  public get sevenDay(): QuotaGaugeViewModel {
    return new QuotaGaugeViewModel(this.quota.sevenDay, '7d');
  }

  /** What `claude --version` says on this subscription, or `undefined` — the version chip. */
  public get claudeVersion(): string | undefined {
    return this.quota.claudeVersion;
  }

  /** `$4.21`, or `undefined` when nothing has reported a cost today. `$0.00` is a real answer. */
  public get spendLabel(): string | undefined {
    const spend = this.quota.spendUsd;
    return spend === undefined ? undefined : `$${spend.toFixed(2)}`;
  }

  /**
   * What the spend number is actually a sum of, for the `title`.
   *
   * Spelled out rather than trusted to the word "today": `costUsd` is a session's whole lifetime
   * cost, so a session that started yesterday and is still running is counted in full
   * (contracts/quota-summary.ts). A figure the owner might reconcile against a bill has to say what
   * it is.
   */
  public get spendDetail(): string {
    const sessions = this.quota.spendingSessions;
    if (sessions === 0) return 'No session on this subscription has reported a cost today.';
    return (
      `Total cost of ${String(sessions)} session(s) that reported today, ` +
      'counted in full — a session that started yesterday and is still running is included whole.'
    );
  }

  /** True when this subscription has never said anything at all. Different from "nothing today". */
  public get silent(): boolean {
    return this.quota.at === undefined;
  }
}

/** `45m`, `2h 14m`, `3d 4h` — coarse on purpose; a quota countdown to the second is noise. */
function untilLabel(ms: number): string {
  const minutes = Math.ceil(ms / MINUTE_MS);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ${String(minutes % 60).padStart(2, '0')}m`;
  return `${String(Math.floor(hours / 24))}d ${String(hours % 24)}h`;
}

/** Rounded down, unlike the countdown: an age of "1m" that is really 90 s overstates nothing. */
function agoLabel(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(ms / MINUTE_MS);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(ms / HOUR_MS);
  return `${String(hours)}h ${String(minutes % 60).padStart(2, '0')}m`;
}
