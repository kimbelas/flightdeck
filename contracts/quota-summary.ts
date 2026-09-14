// Both subscriptions' quota, as the deck's header draws it — P2-T3.
//
// **The mismatch this file exists to resolve.** Quota is a property of a SUBSCRIPTION — one 5-hour
// window and one 7-day window per account — and `VitalsRegistry` is keyed by SESSION. Ten sessions
// on `365` report ten readings of the same two windows, at ten different instants, and some of
// them carry no numbers at all. Somebody has to pick which reading the gauge shows. Doing that in
// a component would make the rule invisible and untestable, so it is here, pure, with the reasons
// written down.
//
// **The rule is newest-that-has-a-number, per gauge — not newest reading.** The obvious rule
// (newest `at` wins) is wrong in a case that happens every time a session starts: a fresh session
// posts renders with `used_percentage: null` before its first turn (RESEARCH.md F.3.5), so the
// newest reading on a subscription is routinely the one with nothing in it. Taking it would blank
// a gauge that four other sessions can still answer. Each gauge therefore carries its own `at`,
// and `SubscriptionQuota.at` stays the newest reading of any kind — "when did this subscription
// last say anything", which is a different question from "how old is this number".
//
// **Staleness is reported, never hidden.** A reading is still worth showing an hour later — a 5 h
// window moves slowly — so nothing is dropped for age. The age travels with the number and the
// header dims past `QUOTA_STALE_AFTER_MS`, because the honest statement is "42 % as of 20 minutes
// ago" and the dishonest one is "42 %".
//
// **`spendUsd` is a sum of session lifetimes, not a ledger.** `costUsd` is what Claude Code says a
// session has cost in total (DECISIONS.md D5), so "today" here means *every session that has
// reported today, counted in full* — a session that started yesterday and is still running
// contributes all of it. That is the most this data supports, and `spendingSessions` is published
// beside it so the number's provenance is on screen rather than in this comment.
import type { SessionVitalsLine } from './core-status.ts';
import { SUBSCRIPTION_IDS, type SubscriptionId } from './session.ts';

/** One rate-limit window as a gauge: a number, when it resets, and how old the reading is. */
export interface QuotaGauge {
  /** 0–100, or `undefined` when no session on this subscription has reported one. */
  readonly usedPercentage: number | undefined;
  /** Epoch **milliseconds**. Already converted from the payload's seconds (statusline-report.ts). */
  readonly resetsAt: number | undefined;
  /** When the reading behind `usedPercentage` arrived, epoch ms. `undefined` with no reading. */
  readonly at: number | undefined;
}

export const NO_GAUGE: QuotaGauge = {
  usedPercentage: undefined,
  resetsAt: undefined,
  at: undefined,
};

export interface SubscriptionQuota {
  readonly subscription: SubscriptionId;
  /** The newest reading of any kind, epoch ms — `undefined` if this subscription has sent none. */
  readonly at: number | undefined;
  readonly fiveHour: QuotaGauge;
  readonly sevenDay: QuotaGauge;
  /** The Claude Code version this subscription's newest reporting session is running. */
  readonly claudeVersion: string | undefined;
  /** Summed `costUsd`, or `undefined` when no session reported one in the window. See the header. */
  readonly spendUsd: number | undefined;
  /** How many sessions that sum is made of. Printed, so the number is not mistaken for a ledger. */
  readonly spendingSessions: number;
}

export interface QuotaSummary {
  /** When core built this, epoch ms. */
  readonly at: number;
  /** Always every subscription, in `SUBSCRIPTION_IDS` order — "no reading yet" is information. */
  readonly subscriptions: readonly SubscriptionQuota[];
}

/**
 * How old a gauge may be before the header dims it.
 *
 * Five minutes, not five seconds. The statusLine posts on every render, so a subscription with a
 * session on screen is never more than a second or two stale; the thing this threshold actually
 * detects is "nothing is running on this account right now", and a window that is a couple of
 * minutes cold is still the best number anybody has.
 */
export const QUOTA_STALE_AFTER_MS = 300_000;

export interface QuotaWindowOptions {
  /** When this summary is being built, epoch ms. */
  readonly at: number;
  /** Only sessions whose newest reading is at or after this instant count towards `spendUsd`. */
  readonly spendSince: number;
}

/**
 * The per-session table, reduced to one pair of gauges per subscription.
 *
 * Pure and total: it reads `SessionVitalsLine` and nothing else, which is the same shape
 * `GET /status` publishes, so the CLI table and the deck header cannot disagree about a
 * subscription.
 *
 * @throws never.
 */
export function summariseQuota(
  lines: readonly SessionVitalsLine[],
  options: QuotaWindowOptions,
): QuotaSummary {
  return {
    at: options.at,
    subscriptions: SUBSCRIPTION_IDS.map((subscription) =>
      summariseOne(
        lines.filter((line) => line.subscription === subscription),
        subscription,
        options.spendSince,
      ),
    ),
  };
}

/**
 * Whether a reading is old enough to be worth saying so about.
 *
 * `undefined` — no reading at all — counts as stale: a gauge with nothing in it must not read as
 * fresh just because it has no age to compare.
 */
export function isStaleReading(at: number | undefined, now: number): boolean {
  return at === undefined || now - at > QUOTA_STALE_AFTER_MS;
}

/** One subscription's lines. Empty is an ordinary answer, and produces empty gauges, not zeroes. */
function summariseOne(
  lines: readonly SessionVitalsLine[],
  subscription: SubscriptionId,
  spendSince: number,
): SubscriptionQuota {
  const spending = lines.filter((line) => line.at >= spendSince && line.costUsd !== undefined);
  return {
    subscription,
    at: newest(lines)?.at,
    fiveHour: gaugeOf(lines, fiveHour),
    sevenDay: gaugeOf(lines, sevenDay),
    claudeVersion: newest(lines.filter((line) => line.claudeVersion !== undefined))?.claudeVersion,
    spendUsd:
      spending.length === 0
        ? undefined
        : spending.reduce((sum, line) => sum + (line.costUsd ?? 0), 0),
    spendingSessions: spending.length,
  };
}

/** Which two fields of a line make up one window. Flat on the line; paired here. See core-status. */
type WindowOf = (line: SessionVitalsLine) => QuotaGauge;

const fiveHour: WindowOf = (line) => ({
  usedPercentage: line.fiveHourPercentage,
  resetsAt: line.fiveHourResetsAt,
  at: line.at,
});

const sevenDay: WindowOf = (line) => ({
  usedPercentage: line.sevenDayPercentage,
  resetsAt: line.sevenDayResetsAt,
  at: line.at,
});

/** The newest line that actually has this window's percentage. See the header for why not simply
 * the newest line. */
function gaugeOf(lines: readonly SessionVitalsLine[], window: WindowOf): QuotaGauge {
  const answered = lines.filter((line) => window(line).usedPercentage !== undefined);
  const line = newest(answered);
  return line === undefined ? NO_GAUGE : window(line);
}

function newest<T extends { readonly at: number }>(lines: readonly T[]): T | undefined {
  return lines.reduce<T | undefined>(
    (best, line) => (best === undefined || line.at > best.at ? line : best),
    undefined,
  );
}

/**
 * One summary off the wire, or `undefined` if it is not one.
 *
 * The deck reads this from a stream frame, so it is `unknown` until proven (CODING-STANDARDS §11
 * rule 1) — the same rule `parseDeckSnapshot` follows on the frame beside it. A subscription entry
 * that does not parse is dropped rather than coerced, because a gauge reading `0 %` when core
 * meant something else is the one failure this whole screen exists to avoid.
 *
 * @throws never.
 */
export function parseQuotaSummary(value: unknown): QuotaSummary | undefined {
  const fields = asRecord(value);
  if (fields === undefined) return undefined;
  const at = numberAt(fields, 'at');
  const subscriptions = fields['subscriptions'];
  if (at === undefined || !Array.isArray(subscriptions)) return undefined;
  return {
    at,
    subscriptions: subscriptions
      .map(subscriptionQuotaOf)
      .filter((quota): quota is SubscriptionQuota => quota !== undefined),
  };
}

function subscriptionQuotaOf(value: unknown): SubscriptionQuota | undefined {
  const fields = asRecord(value);
  if (fields === undefined) return undefined;
  const subscription = SUBSCRIPTION_IDS.find((id) => id === fields['subscription']);
  if (subscription === undefined) return undefined;
  return {
    subscription,
    at: numberAt(fields, 'at'),
    fiveHour: gaugeFrom(fields['fiveHour']),
    sevenDay: gaugeFrom(fields['sevenDay']),
    claudeVersion: stringAt(fields, 'claudeVersion'),
    spendUsd: numberAt(fields, 'spendUsd'),
    spendingSessions: numberAt(fields, 'spendingSessions') ?? 0,
  };
}

/** A missing or malformed gauge is an empty one — the header already draws "no reading yet". */
function gaugeFrom(value: unknown): QuotaGauge {
  const fields = asRecord(value);
  if (fields === undefined) return NO_GAUGE;
  const usedPercentage = numberAt(fields, 'usedPercentage');
  return {
    // Out of range is dropped rather than clamped: a bar past its own track is a bug worth seeing
    // as "—" instead of as a full gauge.
    usedPercentage:
      usedPercentage === undefined || usedPercentage < 0 || usedPercentage > 100
        ? undefined
        : usedPercentage,
    resetsAt: numberAt(fields, 'resetsAt'),
    at: numberAt(fields, 'at'),
  };
}

/** As in the other contracts: an annotated return keeps `any` from escaping `Object.entries`. */
function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}

function stringAt(source: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** `undefined` is not zero, here as everywhere. */
function numberAt(source: Readonly<Record<string, unknown>>, key: string): number | undefined {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
