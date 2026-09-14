// `summariseQuota` — the rule that turns ten sessions' readings into two gauges (P2-T3).
//
// The decision this file pins is the one the header could not be trusted to make: which of a
// subscription's readings represents the account. The obvious rule (newest wins) is wrong, it is
// wrong in a case that happens every time somebody starts a session, and "the gauge went blank when
// I opened a new terminal" is not a bug anyone would think to look for here.
import { describe, expect, it } from 'vitest';
import type { SessionVitalsLine } from '../../contracts/core-status.ts';
import {
  isStaleReading,
  parseQuotaSummary,
  summariseQuota,
  QUOTA_STALE_AFTER_MS,
  type QuotaSummary,
  type SubscriptionQuota,
} from '../../contracts/quota-summary.ts';

const NOW = 1_789_000_100_000;
const DAY_START = NOW - 11 * 3_600_000;

function line(overrides: Partial<SessionVitalsLine> = {}): SessionVitalsLine {
  return {
    sessionId: 'cb5e8102-f057-4d5c-ad98-eac21a12f37d',
    subscription: 'isg',
    at: NOW - 5000,
    sessionName: 'the-one',
    modelName: 'Opus 5',
    claudeVersion: '2.1.7',
    usedPercentage: 42,
    costUsd: 1.25,
    fiveHourPercentage: 23,
    fiveHourResetsAt: NOW + 7_200_000,
    sevenDayPercentage: 61,
    sevenDayResetsAt: NOW + 400_000_000,
    ...overrides,
  };
}

function summarise(lines: readonly SessionVitalsLine[]): QuotaSummary {
  return summariseQuota(lines, { at: NOW, spendSince: DAY_START });
}

function of(summary: QuotaSummary, subscription: string): SubscriptionQuota {
  const entry = summary.subscriptions.find((one) => one.subscription === subscription);
  if (entry === undefined) throw new Error(`no ${subscription} in the summary`);
  return entry;
}

describe('summariseQuota — which reading represents a subscription', () => {
  it('answers for every subscription, including one that has never reported', () => {
    // A block that vanished would make the header's width jump the first time a session started,
    // and "isg has been silent all day" is itself the thing the owner wants to see.
    const summary = summarise([line({ subscription: '365' })]);

    expect(summary.subscriptions.map((entry) => entry.subscription)).toEqual(['isg', '365']);
    expect(of(summary, 'isg').at).toBeUndefined();
    expect(of(summary, 'isg').fiveHour.usedPercentage).toBeUndefined();
  });

  it('takes the newest reading that HAS a number, not simply the newest reading', () => {
    // The trap. A session posts renders with `used_percentage: null` before its first turn
    // (RESEARCH.md F.3.5), so the newest reading on a busy subscription is routinely the empty one.
    const summary = summarise([
      line({ at: NOW - 60_000, fiveHourPercentage: 23 }),
      line({ sessionId: 'fresh', at: NOW - 1000, fiveHourPercentage: undefined }),
    ]);

    expect(of(summary, 'isg').fiveHour.usedPercentage).toBe(23);
    expect(of(summary, 'isg').fiveHour.at).toBe(NOW - 60_000);
  });

  it('still reports the newest reading of any kind as the subscription`s own `at`', () => {
    // Two different questions: "how old is this number" (the gauge's `at`) and "when did this
    // account last say anything" (the subscription's). The fresh empty render answers the second.
    const summary = summarise([
      line({ at: NOW - 60_000, fiveHourPercentage: 23 }),
      line({ sessionId: 'fresh', at: NOW - 1000, fiveHourPercentage: undefined }),
    ]);

    expect(of(summary, 'isg').at).toBe(NOW - 1000);
  });

  it('picks each window independently, because a payload can carry one and not the other', () => {
    const summary = summarise([
      line({ at: NOW - 90_000, fiveHourPercentage: 10, sevenDayPercentage: 50 }),
      line({
        sessionId: 'b',
        at: NOW - 2000,
        fiveHourPercentage: 88,
        sevenDayPercentage: undefined,
      }),
    ]);

    expect(of(summary, 'isg').fiveHour.usedPercentage).toBe(88);
    expect(of(summary, 'isg').sevenDay.usedPercentage).toBe(50);
  });

  it('carries each window`s own reset instant, in milliseconds', () => {
    // `resets_at` is Unix SECONDS on the wire and statusline-report.ts converts it. A summary that
    // lost the conversion would count down to 1970 or to the year 57 000, and only one of those is
    // visible at a glance.
    const summary = summarise([line()]);

    expect(of(summary, 'isg').fiveHour.resetsAt).toBe(NOW + 7_200_000);
    expect(of(summary, 'isg').sevenDay.resetsAt).toBe(NOW + 400_000_000);
  });

  it('takes the version off the newest session that reported one', () => {
    const summary = summarise([
      line({ at: NOW - 90_000, claudeVersion: '2.1.6' }),
      line({ sessionId: 'b', at: NOW - 2000, claudeVersion: '2.1.7' }),
    ]);

    expect(of(summary, 'isg').claudeVersion).toBe('2.1.7');
  });

  it('keeps the subscriptions apart — one account`s reading never fills the other`s gauge', () => {
    const summary = summarise([
      line({ subscription: 'isg', fiveHourPercentage: 23 }),
      line({ sessionId: 'b', subscription: '365', fiveHourPercentage: 91 }),
    ]);

    expect(of(summary, 'isg').fiveHour.usedPercentage).toBe(23);
    expect(of(summary, '365').fiveHour.usedPercentage).toBe(91);
  });
});

describe('summariseQuota — spend', () => {
  it('sums every session that reported inside the window', () => {
    const summary = summarise([line({ costUsd: 1.25 }), line({ sessionId: 'b', costUsd: 2.5 })]);

    expect(of(summary, 'isg').spendUsd).toBeCloseTo(3.75);
    expect(of(summary, 'isg').spendingSessions).toBe(2);
  });

  it('leaves out a session whose newest reading is older than the window', () => {
    const summary = summarise([
      line({ costUsd: 1.25 }),
      line({ sessionId: 'yesterday', at: DAY_START - 1, costUsd: 99 }),
    ]);

    expect(of(summary, 'isg').spendUsd).toBeCloseTo(1.25);
    expect(of(summary, 'isg').spendingSessions).toBe(1);
  });

  it('is `undefined` rather than `$0.00` when nothing has reported a cost', () => {
    // The rule the whole projection is built on: absent is not zero. "$0.00 spent today" is a
    // claim, and this screen has no basis for it.
    const summary = summarise([line({ costUsd: undefined })]);

    expect(of(summary, 'isg').spendUsd).toBeUndefined();
    expect(of(summary, 'isg').spendingSessions).toBe(0);
  });
});

describe('isStaleReading', () => {
  it('holds right up to the threshold and gives way one millisecond past it', () => {
    expect(isStaleReading(NOW - QUOTA_STALE_AFTER_MS, NOW)).toBe(false);
    expect(isStaleReading(NOW - QUOTA_STALE_AFTER_MS - 1, NOW)).toBe(true);
  });

  it('counts "no reading at all" as stale', () => {
    // Otherwise an empty gauge renders at full opacity and reads as a current 0 %.
    expect(isStaleReading(undefined, NOW)).toBe(true);
  });
});

describe('parseQuotaSummary — the frame off the wire', () => {
  const WHOLE = summarise([line(), line({ sessionId: 'b', subscription: '365' })]);

  /** Through JSON, because that is the only way this value ever arrives. */
  function overTheWire(value: unknown): unknown {
    return JSON.parse(JSON.stringify(value));
  }

  it('round-trips a whole summary', () => {
    expect(parseQuotaSummary(overTheWire(WHOLE))).toEqual(WHOLE);
  });

  it('refuses a body that is not a summary', () => {
    expect(parseQuotaSummary(undefined)).toBeUndefined();
    expect(parseQuotaSummary('quota')).toBeUndefined();
    expect(parseQuotaSummary([])).toBeUndefined();
    expect(parseQuotaSummary({ subscriptions: [] })).toBeUndefined();
    expect(parseQuotaSummary({ at: 1, subscriptions: 'both' })).toBeUndefined();
  });

  it('drops a subscription entry it cannot name rather than guessing at one', () => {
    const parsed = parseQuotaSummary({
      at: NOW,
      subscriptions: [{ subscription: 'personal', fiveHour: {} }, 42],
    });

    expect(parsed?.subscriptions).toEqual([]);
  });

  it('reads a missing gauge as empty, not as zero', () => {
    const parsed = parseQuotaSummary({ at: NOW, subscriptions: [{ subscription: 'isg' }] });

    expect(parsed?.subscriptions[0]?.fiveHour.usedPercentage).toBeUndefined();
    expect(parsed?.subscriptions[0]?.sevenDay).toEqual({
      usedPercentage: undefined,
      resetsAt: undefined,
      at: undefined,
    });
  });

  it('drops a percentage outside 0-100 rather than drawing a bar past its own track', () => {
    const parsed = parseQuotaSummary({
      at: NOW,
      subscriptions: [
        {
          subscription: 'isg',
          fiveHour: { usedPercentage: 140 },
          sevenDay: { usedPercentage: -3 },
        },
      ],
    });

    expect(parsed?.subscriptions[0]?.fiveHour.usedPercentage).toBeUndefined();
    expect(parsed?.subscriptions[0]?.sevenDay.usedPercentage).toBeUndefined();
  });

  it('keeps 0 and 100, which are both real readings', () => {
    const parsed = parseQuotaSummary({
      at: NOW,
      subscriptions: [
        { subscription: 'isg', fiveHour: { usedPercentage: 0 }, sevenDay: { usedPercentage: 100 } },
      ],
    });

    expect(parsed?.subscriptions[0]?.fiveHour.usedPercentage).toBe(0);
    expect(parsed?.subscriptions[0]?.sevenDay.usedPercentage).toBe(100);
  });
});
