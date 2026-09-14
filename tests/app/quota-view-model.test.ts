// The header's gauges, decided outside React — P2-T3, CODING-STANDARDS §3.
//
// Every test below is about a reading being OLD, because that is the state this screen spends most
// of its time in: the statusLine posts per render, so a subscription nobody is working on stops
// reporting and its numbers stand still. A countdown that keeps counting past its own reset instant
// is the failure that would survive a demo and be wrong all night.
import { describe, expect, it } from 'vitest';
import {
  NO_GAUGE,
  type QuotaGauge,
  type SubscriptionQuota,
} from '../../contracts/quota-summary.ts';
import {
  QuotaGaugeViewModel,
  SubscriptionQuotaViewModel,
} from '../../app/deck/quota-view-model.ts';

const NOW = 1_789_000_100_000;
const MINUTE = 60_000;
const HOUR = 3_600_000;

function gauge(overrides: Partial<QuotaGauge> = {}): QuotaGaugeViewModel {
  return new QuotaGaugeViewModel(
    { usedPercentage: 42, resetsAt: NOW + 2 * HOUR, at: NOW - 3000, ...overrides },
    '5h',
  );
}

function subscription(overrides: Partial<SubscriptionQuota> = {}): SubscriptionQuotaViewModel {
  return new SubscriptionQuotaViewModel({
    subscription: 'isg',
    at: NOW - 3000,
    fiveHour: { usedPercentage: 42, resetsAt: NOW + 2 * HOUR, at: NOW - 3000 },
    sevenDay: { usedPercentage: 61, resetsAt: NOW + 4 * 24 * HOUR, at: NOW - 3000 },
    claudeVersion: '2.1.7',
    spendUsd: 4.2,
    spendingSessions: 3,
    ...overrides,
  });
}

describe('QuotaGaugeViewModel — the countdown', () => {
  it('counts down to a reset that is still ahead', () => {
    expect(gauge({ resetsAt: NOW + 2 * HOUR + 14 * MINUTE }).resetsIn(NOW)).toBe('2h 14m');
    expect(gauge({ resetsAt: NOW + 45 * MINUTE }).resetsIn(NOW)).toBe('45m');
    expect(gauge({ resetsAt: NOW + 3 * 24 * HOUR + 4 * HOUR }).resetsIn(NOW)).toBe('3d 4h');
  });

  it('says nothing at all once the reset instant has passed', () => {
    // The trap. A window that rolled over while nothing was running leaves an old `resets_at` in
    // the newest reading; subtracting gives a negative, and a naive `Math.max(0, …)` would pin the
    // header at `0m` forever — a countdown that has visibly stopped, which reads as a frozen deck.
    expect(gauge({ resetsAt: NOW - 1 }).resetsIn(NOW)).toBeUndefined();
    expect(gauge({ resetsAt: NOW }).resetsIn(NOW)).toBeUndefined();
  });

  it('says nothing when the payload carried no reset instant', () => {
    expect(gauge({ resetsAt: undefined }).resetsIn(NOW)).toBeUndefined();
  });
});

describe('QuotaGaugeViewModel — absent is not zero', () => {
  it('shows a dash and leaves the bar unfilled for a window nobody has reported', () => {
    const empty = new QuotaGaugeViewModel(NO_GAUGE, '5h');

    expect(empty.percentLabel).toBe('—');
    expect(empty.barPercent).toBeUndefined();
    expect(empty.tone).toBe('none');
  });

  it('shows a real zero as a real zero', () => {
    // The other half of the same rule: `0 %` used is a fact, and a projection that could not tell
    // it from "no reading" would be the one that made the distinction pointless.
    const zero = gauge({ usedPercentage: 0 });

    expect(zero.percentLabel).toBe('0%');
    expect(zero.barPercent).toBe(0);
    expect(zero.tone).toBe('ok');
  });

  it('changes tone where the last of the quota is', () => {
    expect(gauge({ usedPercentage: 74 }).tone).toBe('ok');
    expect(gauge({ usedPercentage: 75 }).tone).toBe('warn');
    expect(gauge({ usedPercentage: 90 }).tone).toBe('high');
  });
});

describe('QuotaGaugeViewModel — staleness', () => {
  it('is fresh while the reading is recent and stale once it is not', () => {
    expect(gauge({ at: NOW - MINUTE }).isStale(NOW)).toBe(false);
    expect(gauge({ at: NOW - 20 * MINUTE }).isStale(NOW)).toBe(true);
  });

  it('puts the age in the tooltip, because the bar itself cannot carry it', () => {
    expect(gauge({ at: NOW - 20 * MINUTE }).detail(NOW)).toBe(
      '5h window: 42% used · resets in 2h 00m · as of 20m ago',
    );
  });

  it('says so plainly when there is no reading behind the gauge', () => {
    expect(new QuotaGaugeViewModel(NO_GAUGE, '7d').detail(NOW)).toBe(
      '7d window: — used · no reading yet',
    );
  });
});

describe('SubscriptionQuotaViewModel', () => {
  it('formats spend as money and says what the money is a sum of', () => {
    const entry = subscription();

    expect(entry.spendLabel).toBe('$4.20');
    expect(entry.spendDetail).toContain('3 session(s)');
    expect(entry.spendDetail).toContain('counted in full');
  });

  it('has no spend label at all when nothing reported a cost today', () => {
    const entry = subscription({ spendUsd: undefined, spendingSessions: 0 });

    expect(entry.spendLabel).toBeUndefined();
    expect(entry.spendDetail).toContain('No session');
  });

  it('is `silent` only when the subscription has never said anything', () => {
    // Different from "nothing today": a subscription that reported this morning and went quiet
    // still has numbers worth showing, dimmed by the gauge rather than by the whole block.
    expect(subscription().silent).toBe(false);
    expect(subscription({ at: undefined }).silent).toBe(true);
  });

  it('hands both windows out with their own labels', () => {
    expect(subscription().fiveHour.windowLabel).toBe('5h');
    expect(subscription().sevenDay.windowLabel).toBe('7d');
    expect(subscription().sevenDay.percentLabel).toBe('61%');
  });

  it('carries the version for the chip, and nothing when no session reported one', () => {
    expect(subscription().claudeVersion).toBe('2.1.7');
    expect(subscription({ claudeVersion: undefined }).claudeVersion).toBeUndefined();
  });
});
