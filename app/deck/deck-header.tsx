'use client';

// The deck's top bar. Core health, the count, both subscriptions' quota, and the two things that
// create work.
//
// The chip says `live` rather than `core up` since P1-T9, and the difference is the product: it is
// green while the event stream is open, so it answers "is what I am looking at current?" rather
// than "did a request succeed a minute ago?". `refresh` stays for the one thing the stream does
// not carry — a subscription core could not read publishes no event (SessionStreamRoute).
//
// **The gauges landed in P2-T3, on the stream rather than on a poll.** Quota is per subscription
// and `vitals[]` is per session, so which reading represents an account is a real decision; it is
// core's, in `summariseQuota`, tested, and the same for every subscriber. What is left here is
// markup: every number below comes off `SubscriptionQuotaViewModel` already formatted, because a
// countdown against a reset instant that has already passed is a bug worth a unit test and not a
// ternary in JSX.
//
// **Nothing here is `0` standing in for "unknown".** A subscription that has never reported gets an
// empty track and a dash, not a gauge at zero — the same rule `contracts/statusline-report.ts` was
// written for, carried all the way to the bar's width.
import type { JSX } from 'react';
import type { QuotaSummary } from '../../contracts/quota-summary.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import { SubscriptionQuotaViewModel, type QuotaGaugeViewModel } from './quota-view-model.ts';

interface DeckHeaderProps {
  readonly coreUp: boolean;
  readonly sessionCount: number;
  readonly quota: QuotaSummary | undefined;
  /** The deck's one clock (deck-view.tsx), so the countdowns and the row ages tick together. */
  readonly now: number;
  readonly loading: boolean;
  readonly onRefresh: () => void;
  readonly onOpenShell: () => void;
  /**
   * Opens the installation panel — P4-T5.
   *
   * The version chip was a label from P2-T3 until this task; it is a button now, because what the
   * owner wants when they look at a version number is `doctor`, `update` and `respawn`, and those
   * had nowhere to live.
   */
  readonly onOpenInstall: (subscription: SubscriptionId) => void;
}

export function DeckHeader({
  coreUp,
  sessionCount,
  quota,
  now,
  loading,
  onRefresh,
  onOpenShell,
  onOpenInstall,
}: DeckHeaderProps): JSX.Element {
  const subscriptions = (quota?.subscriptions ?? []).map(
    (entry) => new SubscriptionQuotaViewModel(entry),
  );
  return (
    <header className="deck-head">
      <h1>Flightdeck</h1>
      <span className={`chip ${coreUp ? 'chip-live' : 'chip-refused'}`}>
        {coreUp ? 'live' : 'core down'}
      </span>
      <span className="muted">{sessionCount} sessions</span>
      <div className="quotas">
        {subscriptions.map((entry) => (
          <SubscriptionQuotaBlock
            key={entry.key}
            quota={entry}
            now={now}
            onOpenInstall={onOpenInstall}
          />
        ))}
      </div>
      <button type="button" onClick={onRefresh} disabled={loading}>
        {loading ? 'refreshing…' : 'refresh'}
      </button>
      <button type="button" className="ghost" onClick={onOpenShell}>
        + shell
      </button>
    </header>
  );
}

interface SubscriptionQuotaBlockProps {
  readonly onOpenInstall: (subscription: SubscriptionId) => void;
  readonly quota: SubscriptionQuotaViewModel;
  readonly now: number;
}

/**
 * One subscription: its name, its two gauges, what it has spent today and what Claude Code it runs.
 *
 * Rendered even when the subscription has never reported. "No reading yet" is information — it is
 * how the owner sees that `isg` has not been touched today — and a block that disappeared would
 * make the header's width jump every time a session started.
 */
function SubscriptionQuotaBlock({
  quota,
  now,
  onOpenInstall,
}: SubscriptionQuotaBlockProps): JSX.Element {
  const spend = quota.spendLabel;
  return (
    <div className={`quota${quota.silent ? ' quota-silent' : ''}`}>
      <span className="quota-sub">{quota.label}</span>
      <GaugeBar gauge={quota.fiveHour} now={now} />
      <GaugeBar gauge={quota.sevenDay} now={now} />
      <span className="quota-spend" title={quota.spendDetail}>
        {spend ?? '—'}
      </span>
      {quota.claudeVersion !== undefined && (
        <button
          type="button"
          className="chip chip-version"
          title={`Claude Code on ${quota.label} — doctor, updates, respawn`}
          aria-label={`installation ${quota.label}`}
          onClick={() => {
            onOpenInstall(quota.label === 'isg' ? 'isg' : '365');
          }}
        >
          {quota.claudeVersion}
        </button>
      )}
    </div>
  );
}

interface GaugeBarProps {
  readonly gauge: QuotaGaugeViewModel;
  readonly now: number;
}

/**
 * One window: a label, a track, the percentage and the countdown.
 *
 * The countdown is omitted rather than dashed when there is none. A window with no `resets_at`, and
 * one whose reset has already passed, are both "there is nothing to count down to", and printing
 * `—` for that reads as a missing value rather than as an absent one.
 */
function GaugeBar({ gauge, now }: GaugeBarProps): JSX.Element {
  const fill = gauge.barPercent;
  const resets = gauge.resetsIn(now);
  return (
    <span
      className={`gauge gauge-${gauge.tone}${gauge.isStale(now) ? ' gauge-stale' : ''}`}
      title={gauge.detail(now)}
    >
      <span className="gauge-label">{gauge.windowLabel}</span>
      <span className="gauge-track">
        {fill !== undefined && (
          <span className="gauge-fill" style={{ width: `${String(fill)}%` }} />
        )}
      </span>
      <span className="gauge-percent">{gauge.percentLabel}</span>
      {resets !== undefined && <span className="gauge-resets">{resets}</span>}
    </span>
  );
}
