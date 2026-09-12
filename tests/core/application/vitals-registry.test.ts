// P1-T6. "Did this render say anything?" — the question that keeps a per-repaint feed out of the
// log and, from P1-T8, out of the store.
import { describe, expect, it } from 'vitest';
import { NO_QUOTA, type StatuslineReport } from '../../../contracts/statusline-report.ts';
import { VitalsRegistry } from '../../../core/application/vitals-registry.ts';

const SESSION = 'cb5e8102-f057-4d5c-ad98-eac21a12f37d';

function report(overrides: Partial<StatuslineReport> = {}): StatuslineReport {
  return {
    sessionId: SESSION,
    transcriptPath: 'C:\\x\\.claude-isg\\t.jsonl',
    sessionName: 'one',
    modelId: 'claude-haiku-4-5-20251001',
    modelName: 'Haiku 4.5',
    claudeVersion: '2.1.267',
    costUsd: 0.02,
    usedPercentage: 20,
    contextWindowSize: 200_000,
    fiveHour: { usedPercentage: 23, resetsAt: 1_789_080_600_000 },
    sevenDay: NO_QUOTA,
    ...overrides,
  };
}

describe('VitalsRegistry — what counts as news', () => {
  it('calls the first report of a session news', () => {
    const registry = new VitalsRegistry();

    expect(registry.record(report(), 'isg', 1000)).toBe(true);
  });

  it('says nothing changed when nothing did', () => {
    // The common case by a long way: the block posts on every repaint.
    const registry = new VitalsRegistry();
    registry.record(report(), 'isg', 1000);

    expect(registry.record(report(), 'isg', 2000)).toBe(false);
  });

  it('notices context, cost, model, name and either quota moving', () => {
    const moves: Partial<StatuslineReport>[] = [
      { usedPercentage: 21 },
      { costUsd: 0.03 },
      { modelId: 'claude-opus-5' },
      { sessionName: 'two' },
      { fiveHour: { usedPercentage: 24, resetsAt: 1_789_080_600_000 } },
      { sevenDay: { usedPercentage: 1, resetsAt: undefined } },
    ];

    for (const move of moves) {
      const registry = new VitalsRegistry();
      registry.record(report(), 'isg', 1000);

      expect(registry.record(report(move), 'isg', 2000)).toBe(true);
    }
  });

  it('ignores the fields that move on every render', () => {
    // A render that only advanced the clock is not news. `resetsAt` moves when a window rolls over
    // and the percentage moves with it, so the percentage is the one worth watching.
    const registry = new VitalsRegistry();
    registry.record(report(), 'isg', 1000);

    const same = registry.record(
      report({ fiveHour: { usedPercentage: 23, resetsAt: 9_999_999_999_000 } }),
      'isg',
      2000,
    );

    expect(same).toBe(false);
  });

  it('treats the first real percentage after a fresh session as news', () => {
    // undefined to 20 is exactly the transition the deck is waiting for, and a comparison that
    // coerced either side to 0 would miss it (F.3.5).
    const registry = new VitalsRegistry();
    registry.record(report({ usedPercentage: undefined }), 'isg', 1000);

    expect(registry.record(report({ usedPercentage: 20 }), 'isg', 2000)).toBe(true);
  });
});

describe('VitalsRegistry — what it holds', () => {
  it('keeps the newest report and when it arrived', () => {
    const registry = new VitalsRegistry();
    registry.record(report(), 'isg', 1000);
    registry.record(report({ usedPercentage: 55 }), 'isg', 2000);

    expect(registry.get(SESSION)).toMatchObject({
      subscription: 'isg',
      at: 2000,
      report: { usedPercentage: 55 },
    });
  });

  it('knows nothing about a session that has not reported', () => {
    expect(new VitalsRegistry().get(SESSION)).toBeUndefined();
  });

  it('keeps every session apart', () => {
    const registry = new VitalsRegistry();
    registry.record(report(), 'isg', 1000);
    registry.record(report({ sessionId: 'aaaaaaaa-0000-0000-0000-000000000000' }), '365', 1000);

    expect(registry.size).toBe(2);
    expect(registry.all()).toHaveLength(2);
  });

  it('evicts the session nobody has heard from in the longest', () => {
    const registry = new VitalsRegistry();
    for (let index = 0; index < 205; index += 1) {
      registry.record(report({ sessionId: uuidFor(index) }), 'isg', 1000);
    }

    expect(registry.size).toBe(200);
    expect(registry.get(uuidFor(0))).toBeUndefined();
    expect(registry.get(uuidFor(204))).toBeDefined();
  });

  it('counts an update as being heard from, so a busy session is not evicted', () => {
    const registry = new VitalsRegistry();
    registry.record(report({ sessionId: uuidFor(0) }), 'isg', 1000);
    for (let index = 1; index < 200; index += 1) {
      registry.record(report({ sessionId: uuidFor(index) }), 'isg', 1000);
    }

    registry.record(report({ sessionId: uuidFor(0), costUsd: 9 }), 'isg', 2000);
    registry.record(report({ sessionId: uuidFor(500) }), 'isg', 3000);

    expect(registry.get(uuidFor(0))).toBeDefined();
    expect(registry.get(uuidFor(1))).toBeUndefined();
  });
});

function uuidFor(index: number): string {
  return `${index.toString(16).padStart(8, '0')}-0000-0000-0000-000000000000`;
}
