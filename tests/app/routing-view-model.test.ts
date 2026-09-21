// `RoutingViewModel` — the recommendation as one line under the picker (P4-T3).
//
// The rule itself is pinned in tests/contracts/quota-routing.test.ts. What is asserted here is the
// part a reader acts on: that every verdict says which account and NAMES THE NUMBERS, so the advice
// can be checked against the two gauges in the header rather than taken on trust. A sentence that
// said "isg has more headroom" and nothing else would pass a weaker version of every test below and
// be worth nothing on screen.
import { describe, expect, it } from 'vitest';
import {
  NO_GAUGE,
  type QuotaGauge,
  type QuotaSummary,
  type SubscriptionQuota,
} from '../../contracts/quota-summary.ts';
import { recommendRouting } from '../../contracts/quota-routing.ts';
import type { ProfileFunction } from '../../contracts/launch-preset.ts';
import { RoutingViewModel } from '../../app/deck/routing-view-model.ts';

const NOW = 1_789_000_100_000;

interface Reading {
  readonly fiveHour?: number;
  readonly sevenDay?: number;
  readonly at?: number;
  readonly silent?: boolean;
}

function summary(threeSixtyFive: Reading, isg: Reading): QuotaSummary {
  return {
    at: NOW,
    subscriptions: [entry('isg', isg), entry('365', threeSixtyFive)],
  };
}

function entry(id: 'isg' | '365', reading: Reading): SubscriptionQuota {
  const at = reading.at ?? NOW - 1000;
  const gauge = (used: number | undefined): QuotaGauge =>
    used === undefined || reading.silent === true
      ? NO_GAUGE
      : { usedPercentage: used, resetsAt: NOW + 7_200_000, at };
  return {
    subscription: id,
    at: reading.silent === true ? undefined : at,
    fiveHour: gauge(reading.fiveHour),
    sevenDay: gauge(reading.sevenDay),
    claudeVersion: '2.1.7',
    spendUsd: 1,
    spendingSessions: 1,
  };
}

function view(
  threeSixtyFive: Reading,
  isg: Reading,
  chosen: ProfileFunction = 'claude-365',
): RoutingViewModel {
  const routing = recommendRouting(summary(threeSixtyFive, isg), { now: NOW, chosen });
  return new RoutingViewModel(routing, chosen);
}

describe('RoutingViewModel — the advice names the numbers behind it', () => {
  it('prints both accounts, their free percentage and the window it judged on', () => {
    // The 5-hour bar on 365 reads 10% used. Without "(7d)" in the sentence, advice to use isg
    // contradicts the gauge the owner is looking at and reads as a bug.
    const hint = view({ fiveHour: 10, sevenDay: 95 }, { fiveHour: 55, sevenDay: 60 });

    expect(hint.sentence).toContain('claude-isg');
    expect(hint.sentence).toContain('365 5% free (7d)');
    expect(hint.sentence).toContain('isg 40% free (7d)');
  });

  it('reads as a confirmation when the picker is already on the recommendation', () => {
    const hint = view({ fiveHour: 5, sevenDay: 5 }, { fiveHour: 80, sevenDay: 80 }, 'claude-365');

    expect(hint.following).toBe(true);
    expect(hint.sentence).toContain('most headroom: claude-365');
    expect(hint.className).not.toContain('quota-hint-overridden');
  });

  it('keeps stating the other account when the owner has overridden — without scolding', () => {
    // Overriding is allowed (SPEC §5.2). The sentence changes emphasis and the hint brightens; it
    // does not become an error, and nothing on this object refuses the launch.
    const hint = view({ fiveHour: 90, sevenDay: 90 }, { fiveHour: 10, sevenDay: 10 }, 'claude-365');

    expect(hint.following).toBe(false);
    expect(hint.sentence).toContain('claude-isg has more headroom');
    expect(hint.sentence).toContain('365 10% free');
    expect(hint.className).toContain('quota-hint-overridden');
  });

  it('says the two are level on a tie, with both figures', () => {
    const hint = view({ fiveHour: 50, sevenDay: 50 }, { fiveHour: 52, sevenDay: 52 });

    expect(hint.verdict).toBe('tie');
    expect(hint.recommended).toBeUndefined();
    expect(hint.sentence).toContain('both accounts are level');
    expect(hint.sentence).toContain('365 50% free');
    expect(hint.sentence).toContain('isg 48% free');
  });

  it('names the account that has not reported rather than showing it at 0%', () => {
    const hint = view({ fiveHour: 30, sevenDay: 30 }, { silent: true });

    expect(hint.verdict).toBe('incomparable');
    expect(hint.sentence).toContain('no recommendation');
    expect(hint.sentence).toContain('isg has not reported');
    expect(hint.sentence).not.toContain('isg 0%');
  });

  it('explains a pinned function instead of offering a swap it cannot make (D44)', () => {
    const hint = view(
      { fiveHour: 5, sevenDay: 5 },
      { fiveHour: 95, sevenDay: 95 },
      'claude-isg-ticket',
    );

    expect(hint.verdict).toBe('not_routable');
    expect(hint.sentence).toContain('claude-isg-ticket is isg by construction');
    // No figures: the two gauges are irrelevant to a function that cannot move between them, and
    // printing them would invite the owner to act on a comparison the picker will not honour.
    expect(hint.sentence).not.toContain('% free');
  });

  it('qualifies an old reading rather than withholding the advice', () => {
    const old = NOW - 3_600_000;
    const hint = view(
      { fiveHour: 10, sevenDay: 10, at: old },
      { fiveHour: 80, sevenDay: 80, at: old },
    );

    expect(hint.stale).toBe(true);
    expect(hint.recommended).toBe('claude-365');
    expect(hint.sentence).toContain('reading may be old');
  });

  it('says nothing about age when both readings are fresh', () => {
    const hint = view({ fiveHour: 10, sevenDay: 10 }, { fiveHour: 80, sevenDay: 80 });

    expect(hint.stale).toBe(false);
    expect(hint.sentence).not.toContain('reading may be old');
  });
});
