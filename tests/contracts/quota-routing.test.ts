// `recommendRouting` — which account the next session belongs on (P4-T3).
//
// The decision this file pins is the one that is easy to get backwards and impossible to notice on
// screen: headroom is 100 minus the FULLER window. An account at 5h 10 % / 7d 95 % draws an almost
// empty 5-hour bar, which is the bar the owner watches, and has five points of room before it stops
// taking work for days. A rule that read the 5-hour gauge alone would recommend it, confidently,
// every time — and the owner would find out at the point the session stopped.
//
// The other three cases here are all the same refusal in different clothes: `tie`, `incomparable`
// and `not_routable` each mean "leave the picker alone", and each has to mean it for its own
// reason, because the deck writes a different sentence for each.
import { describe, expect, it } from 'vitest';
import {
  NO_GAUGE,
  type QuotaGauge,
  type QuotaSummary,
  type SubscriptionQuota,
  QUOTA_STALE_AFTER_MS,
} from '../../contracts/quota-summary.ts';
import {
  recommendRouting,
  ROUTING_MARGIN_POINTS,
  type SubscriptionHeadroom,
  type QuotaRouting,
} from '../../contracts/quota-routing.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import type { ProfileFunction } from '../../contracts/launch-preset.ts';

const NOW = 1_789_000_100_000;

function gauge(usedPercentage: number | undefined, at = NOW - 1000): QuotaGauge {
  return usedPercentage === undefined
    ? NO_GAUGE
    : { usedPercentage, resetsAt: NOW + 7_200_000, at };
}

interface Reading {
  readonly fiveHour?: number | undefined;
  readonly sevenDay?: number | undefined;
  readonly at?: number;
  /** Absent entirely — the account has never said anything, which is not the same as 0 %. */
  readonly silent?: boolean;
}

function subscription(id: SubscriptionId, reading: Reading): SubscriptionQuota {
  return {
    subscription: id,
    at: reading.silent === true ? undefined : (reading.at ?? NOW - 1000),
    fiveHour: reading.silent === true ? NO_GAUGE : gauge(reading.fiveHour, reading.at),
    sevenDay: reading.silent === true ? NO_GAUGE : gauge(reading.sevenDay, reading.at),
    claudeVersion: '2.1.7',
    spendUsd: 1.5,
    spendingSessions: 1,
  };
}

/** A summary built from what each account is reporting. `365` first in the argument, not the wire. */
function summary(threeSixtyFive: Reading, isg: Reading): QuotaSummary {
  return {
    at: NOW,
    subscriptions: [subscription('isg', isg), subscription('365', threeSixtyFive)],
  };
}

function route(
  threeSixtyFive: Reading,
  isg: Reading,
  chosen: ProfileFunction = 'claude-365',
): QuotaRouting {
  return recommendRouting(summary(threeSixtyFive, isg), { now: NOW, chosen });
}

function sideOf(
  headroom: readonly SubscriptionHeadroom[],
  id: SubscriptionId,
): SubscriptionHeadroom {
  const side = headroom.find((entry) => entry.subscription === id);
  if (side === undefined) throw new Error(`no ${id} in the headroom table`);
  return side;
}

describe('recommendRouting — headroom comes off the fuller window', () => {
  it('recommends the account whose WORST window is emptier, not the one with the emptier 5h', () => {
    // The whole task in one case. 365 looks free on the gauge the owner watches (5h 10 %) and is
    // nearly out of week (7d 95 %); isg is unremarkable on both. The 5-hour reading alone would
    // send the session to 365 and it would stop.
    const routing = route({ fiveHour: 10, sevenDay: 95 }, { fiveHour: 55, sevenDay: 60 });

    expect(routing.verdict).toBe('more_headroom');
    expect(routing.recommended).toBe('claude-isg');
    expect(sideOf(routing.headroom, '365').headroom).toBe(5);
    expect(sideOf(routing.headroom, '365').boundWindow).toBe('7d');
    expect(sideOf(routing.headroom, 'isg').headroom).toBe(40);
    expect(sideOf(routing.headroom, 'isg').boundWindow).toBe('7d');
  });

  it('names the 5h window when that is the one binding', () => {
    const routing = route({ fiveHour: 90, sevenDay: 20 }, { fiveHour: 10, sevenDay: 30 });

    expect(routing.recommended).toBe('claude-isg');
    expect(sideOf(routing.headroom, '365').boundWindow).toBe('5h');
    expect(sideOf(routing.headroom, '365').headroom).toBe(10);
  });

  it('recommends 365 when 365 is the emptier one — the rule has no favourite', () => {
    const routing = route({ fiveHour: 5, sevenDay: 10 }, { fiveHour: 80, sevenDay: 80 });

    expect(routing.recommended).toBe('claude-365');
    expect(routing.marginPoints).toBe(70);
  });

  it('compares on one window when only one has answered — a fresh session posts nulls (F.3.5)', () => {
    // Both windows arrive in one payload, so a lone answered window is a real constraint rather
    // than half of one. Refusing to compare here would blank the recommendation on the first
    // render of the day, which is exactly when it is wanted.
    const routing = route({ fiveHour: 12, sevenDay: undefined }, { fiveHour: 70, sevenDay: 72 });

    expect(routing.verdict).toBe('more_headroom');
    expect(routing.recommended).toBe('claude-365');
    expect(sideOf(routing.headroom, '365').boundWindow).toBe('5h');
    expect(sideOf(routing.headroom, '365').headroom).toBe(88);
  });
});

describe('recommendRouting — the three ways it declines to move the picker', () => {
  it('calls a gap under the margin a tie, and recommends nothing', () => {
    // A `quota` frame arrives on every statusLine render. Without the margin, two readings a
    // second apart would move the pre-selection under the owner's cursor.
    const routing = route({ fiveHour: 50, sevenDay: 50 }, { fiveHour: 52, sevenDay: 53 });

    expect(routing.verdict).toBe('tie');
    expect(routing.recommended).toBeUndefined();
    expect(routing.marginPoints).toBe(3);
  });

  it('recommends at exactly the margin, and not one point under it', () => {
    const atMargin = route({ fiveHour: 40, sevenDay: 40 }, { fiveHour: 40, sevenDay: 45 });
    const underIt = route({ fiveHour: 40, sevenDay: 40 }, { fiveHour: 40, sevenDay: 44 });

    expect(atMargin.marginPoints).toBe(ROUTING_MARGIN_POINTS);
    expect(atMargin.verdict).toBe('more_headroom');
    expect(atMargin.recommended).toBe('claude-365');
    expect(underIt.verdict).toBe('tie');
  });

  it('will not compare against an account that has never reported — silence is not 100% free', () => {
    // The tempting bug: treat a missing reading as an empty account and route every session to
    // whichever one nobody has used. An account nothing has run on all day is also the one whose
    // 7-day window nobody has looked at.
    const routing = route({ fiveHour: 96, sevenDay: 97 }, { silent: true });

    expect(routing.verdict).toBe('incomparable');
    expect(routing.recommended).toBeUndefined();
    expect(routing.marginPoints).toBeUndefined();
    expect(sideOf(routing.headroom, 'isg').headroom).toBeUndefined();
    expect(sideOf(routing.headroom, 'isg').boundWindow).toBeUndefined();
  });

  it('answers not_routable for the two functions that are isg by construction (D44)', () => {
    // The picker must not offer a swap it cannot make: `claude-isg-ticket` pins opusplan[1m] and
    // `claude-isg-orch` pins an agent, and both export ~\.claude-isg whatever the gauges say.
    for (const chosen of ['claude-isg-ticket', 'claude-isg-orch'] as const) {
      const routing = route({ fiveHour: 5, sevenDay: 5 }, { fiveHour: 90, sevenDay: 90 }, chosen);

      expect(routing.verdict).toBe('not_routable');
      expect(routing.recommended).toBeUndefined();
      expect(routing.marginPoints).toBeUndefined();
    }
  });

  it('still publishes both accounts on every verdict, in the routable order', () => {
    // The gauges are worth drawing beside a `tie` and beside a pinned function: "these two are
    // level" is an answer, and an empty table would read as "no data".
    for (const routing of [
      route({ fiveHour: 50, sevenDay: 50 }, { fiveHour: 51, sevenDay: 51 }),
      route({ fiveHour: 50, sevenDay: 50 }, { silent: true }),
      route({ fiveHour: 5, sevenDay: 5 }, { fiveHour: 90, sevenDay: 90 }, 'claude-isg-orch'),
    ]) {
      expect(routing.headroom.map((entry) => entry.profileFn)).toEqual([
        'claude-365',
        'claude-isg',
      ]);
    }
  });
});

describe('recommendRouting — staleness qualifies, it never withdraws', () => {
  it('still recommends off an old reading, and says it is old', () => {
    // A 5-hour window moves slowly, so a twenty-minute-old number is the best one in existence.
    // Dropping it would leave the picker silent on the idle machine where the first session of the
    // day is about to be started — the one moment the recommendation is worth the most.
    const old = NOW - QUOTA_STALE_AFTER_MS - 60_000;
    const routing = route(
      { fiveHour: 10, sevenDay: 10, at: old },
      { fiveHour: 80, sevenDay: 80, at: old },
    );

    expect(routing.verdict).toBe('more_headroom');
    expect(routing.recommended).toBe('claude-365');
    expect(sideOf(routing.headroom, '365').stale).toBe(true);
    expect(sideOf(routing.headroom, 'isg').stale).toBe(true);
  });

  it('marks a fresh reading fresh and an account with no reading stale', () => {
    const routing = route({ fiveHour: 30, sevenDay: 30 }, { silent: true });

    expect(sideOf(routing.headroom, '365').stale).toBe(false);
    expect(sideOf(routing.headroom, 'isg').stale).toBe(true);
  });

  it('answers with no picker at all — `flightdeck-core status` has none', () => {
    // The CLI prints a recommendation from a terminal, where nothing is selected. Passing a fake
    // selection to get an answer would make `not_routable` reachable from a screen that cannot
    // launch anything; omitting `chosen` skips that branch and leaves the comparison intact.
    const routing = recommendRouting(
      summary({ fiveHour: 10, sevenDay: 10 }, { fiveHour: 80, sevenDay: 80 }),
      { now: NOW },
    );

    expect(routing.verdict).toBe('more_headroom');
    expect(routing.recommended).toBe('claude-365');
  });

  it('reads the same answer twice — it is pure, and it never reads a clock', () => {
    const same = summary({ fiveHour: 20, sevenDay: 25 }, { fiveHour: 70, sevenDay: 71 });
    const first = recommendRouting(same, { now: NOW, chosen: 'claude-365' });
    const second = recommendRouting(same, { now: NOW, chosen: 'claude-365' });

    expect(second).toEqual(first);
  });
});
