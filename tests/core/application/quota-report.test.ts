// `QuotaReport` — the registry to the frame, and the one thing it decides itself (P2-T3).
//
// The projection is tested next door (tests/contracts/quota-summary.test.ts). What is left here is
// what a pure function could not own: the day boundary that "spend today" is measured from, and the
// fact that this reads the registry rather than a second copy of it.
import { describe, expect, it } from 'vitest';
import { QuotaReport } from '../../../core/application/quota-report.ts';
import { VitalsRegistry } from '../../../core/application/vitals-registry.ts';
import type { StatuslineReport } from '../../../contracts/statusline-report.ts';
import type { Clock } from '../../../core/ports/clock.ts';

/** 2026-09-14 14:30 local, whatever local is on the machine running this. */
const NOW = new Date(2026, 8, 14, 14, 30, 0);

class FixedClock implements Clock {
  private readonly at: Date;

  constructor(at: Date) {
    this.at = at;
  }

  public now(): Date {
    return new Date(this.at.getTime());
  }
}

function report(overrides: Partial<StatuslineReport> = {}): StatuslineReport {
  return {
    sessionId: 'cb5e8102-f057-4d5c-ad98-eac21a12f37d',
    transcriptPath: 'C:\\Users\\someone\\.claude-isg\\projects\\p\\t.jsonl',
    sessionName: 'the-one',
    modelId: 'claude-opus-5',
    modelName: 'Opus 5',
    claudeVersion: '2.1.7',
    costUsd: 1.25,
    usedPercentage: 42,
    contextWindowSize: 200_000,
    fiveHour: { usedPercentage: 23, resetsAt: NOW.getTime() + 7_200_000 },
    sevenDay: { usedPercentage: 61, resetsAt: NOW.getTime() + 400_000_000 },
    ...overrides,
  };
}

function of(registry: VitalsRegistry, at = NOW): QuotaReport {
  return new QuotaReport({ vitals: registry, clock: new FixedClock(at) });
}

describe('QuotaReport', () => {
  it('answers for both subscriptions from an empty registry', () => {
    const summary = of(new VitalsRegistry()).summary();

    expect(summary.subscriptions.map((entry) => entry.subscription)).toEqual(['isg', '365']);
    expect(summary.subscriptions[0]?.fiveHour.usedPercentage).toBeUndefined();
    expect(summary.at).toBe(NOW.getTime());
  });

  it('reads what the registry holds, per subscription', () => {
    const registry = new VitalsRegistry();
    registry.record(report(), 'isg', NOW.getTime() - 4000);
    registry.record(
      report({
        sessionId: 'd1b2f43c-1111-4222-a333-444444444444',
        fiveHour: { usedPercentage: 91, resetsAt: undefined },
      }),
      '365',
      NOW.getTime() - 2000,
    );

    const summary = of(registry).summary();

    expect(summary.subscriptions[0]?.fiveHour.usedPercentage).toBe(23);
    expect(summary.subscriptions[0]?.claudeVersion).toBe('2.1.7');
    expect(summary.subscriptions[1]?.fiveHour.usedPercentage).toBe(91);
  });

  it('measures "today" from LOCAL midnight, not from UTC midnight', () => {
    // A UTC boundary would roll this number over at 8 pm or 1 am depending on the season, which the
    // owner would read as a lost session rather than as a timezone. The reading below is from 00:05
    // local — after local midnight, and on the *previous* UTC day for anyone west of Greenwich.
    const registry = new VitalsRegistry();
    const justAfterMidnight = new Date(2026, 8, 14, 0, 5, 0).getTime();
    registry.record(report(), 'isg', justAfterMidnight);

    const summary = of(registry).summary();

    expect(summary.subscriptions[0]?.spendUsd).toBeCloseTo(1.25);
    expect(summary.subscriptions[0]?.spendingSessions).toBe(1);
  });

  it('leaves out a session whose newest reading was before local midnight', () => {
    const registry = new VitalsRegistry();
    const lastNight = new Date(2026, 8, 13, 23, 55, 0).getTime();
    registry.record(report(), 'isg', lastNight);

    const summary = of(registry).summary();

    expect(summary.subscriptions[0]?.spendUsd).toBeUndefined();
    expect(summary.subscriptions[0]?.spendingSessions).toBe(0);
    // The gauge is still shown: yesterday's percentage is old, not wrong, and the age travels with
    // it so the header can dim it (contracts/quota-summary.ts).
    expect(summary.subscriptions[0]?.fiveHour.usedPercentage).toBe(23);
    expect(summary.subscriptions[0]?.fiveHour.at).toBe(lastNight);
  });

  it('never publishes the transcript path, which is the one field that names the owner', () => {
    // SEC-DATA-2. The registry holds a whole `StatuslineReport`; `vitals-lines.ts` is the boundary
    // that drops this, and the boundary is only worth anything if it is asserted on.
    const registry = new VitalsRegistry();
    registry.record(report(), 'isg', NOW.getTime());

    expect(JSON.stringify(of(registry).summary())).not.toContain('.claude-isg');
    expect(JSON.stringify(of(registry).summary())).not.toContain('transcript');
  });
});
