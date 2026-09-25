// Running totals into amounts per week — P7-T3.
//
// The table at the top of `spend-fold.ts` is three wrong answers and one right one; each of the
// first three has a test here that the obvious implementation of it would fail.
import { describe, expect, it } from 'vitest';
import { weekStartOf } from '../../../contracts/spend-summary.ts';
import { NO_RUN, SpendFold, type CostReading } from '../../../core/domain/spend-fold.ts';

const RUN_ONE = new Date(2026, 8, 21, 9).getTime();
const RUN_TWO = new Date(2026, 8, 23, 9).getTime();
const HOUR = 60 * 60 * 1000;
const THIS_WEEK = weekStartOf(RUN_ONE);
const NEXT_WEEK = weekStartOf(new Date(2026, 8, 28, 9).getTime());

function reading(costUsd: number, over: Partial<CostReading> = {}): CostReading {
  return {
    kind: 'cost',
    costUsd,
    linesAdded: 0,
    linesRemoved: 0,
    spend: [],
    at: RUN_ONE + HOUR,
    startedAt: RUN_ONE,
    ...over,
  };
}

function costs(fold: SpendFold): readonly number[] {
  return fold.increments().map((week) => Math.round(week.costUsd * 100) / 100);
}

describe('SpendFold — a run is the unit a total is cumulative over', () => {
  it('counts a run once however many readings it wrote (not a sum of lines)', () => {
    const fold = new SpendFold(NO_RUN);

    fold.add(reading(4), 0);
    fold.add(reading(10, { at: RUN_ONE + 2 * HOUR }), 0);
    // 36 of 679 real lines repeat the run and total of the one before (RESEARCH.md G.59).
    fold.add(reading(10, { at: RUN_ONE + 2 * HOUR }), 0);

    expect(costs(fold)).toEqual([10]);
  });

  it('keeps the first run when a resume starts a second one (not the last total)', () => {
    const fold = new SpendFold(NO_RUN);

    // The measured case: $85.69, then a resume at a new startTime whose first total is $8.23.
    fold.add(reading(85.69), 0);
    fold.add(reading(8.23, { startedAt: RUN_TWO, at: RUN_TWO + HOUR }), 0);

    expect(costs(fold)).toEqual([93.92]);
  });

  it('keeps the smaller run too (not the maximum)', () => {
    const fold = new SpendFold(NO_RUN);

    fold.add(reading(3), 0);
    fold.add(reading(20, { startedAt: RUN_TWO, at: RUN_TWO + HOUR }), 0);

    expect(costs(fold)).toEqual([23]);
  });

  it('treats a total that went DOWN as a new run when the line carried no startTime', () => {
    const fold = new SpendFold(NO_RUN);

    fold.add(reading(9, { startedAt: undefined }), 0);
    fold.add(reading(2, { startedAt: undefined }), 0);

    expect(costs(fold)).toEqual([11]);
  });
});

describe('SpendFold — per week', () => {
  it('files each increment under the week its reading was taken in', () => {
    const fold = new SpendFold(NO_RUN);

    fold.add(reading(5), 0);
    // The same run, a week later: a session left open over a weekend.
    fold.add(reading(12, { at: new Date(2026, 8, 29, 10).getTime() }), 0);

    expect(fold.increments()).toMatchObject([
      { weekStart: THIS_WEEK, costUsd: 5 },
      { weekStart: NEXT_WEEK, costUsd: 7 },
    ]);
  });

  it('files a reading with no instant under the fallback — the ledger passes the clock', () => {
    const fold = new SpendFold(NO_RUN);

    fold.add(reading(1, { at: undefined }), new Date(2026, 8, 30).getTime());

    expect(fold.increments()[0]?.weekStart).toBe(NEXT_WEEK);
  });

  it('lists a week a zero reading landed in, so a session that did nothing is still activity', () => {
    const fold = new SpendFold(NO_RUN);

    fold.add(reading(0), 0);

    expect(fold.increments()).toEqual([
      {
        weekStart: THIS_WEEK,
        costUsd: 0,
        linesAdded: 0,
        linesRemoved: 0,
        tokensIn: 0,
        tokensOut: 0,
      },
    ]);
  });
});

describe('SpendFold — lines and tokens ride the same arithmetic', () => {
  it('sums tokens across models and takes the increment of every field', () => {
    const fold = new SpendFold(NO_RUN);
    const model = {
      model: 'claude-opus-5',
      costUsd: 1,
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 100,
      cacheCreationTokens: 1,
    };

    fold.add(reading(1, { linesAdded: 3, linesRemoved: 1, spend: [model] }), 0);
    fold.add(
      reading(2, {
        linesAdded: 8,
        linesRemoved: 1,
        spend: [model, { ...model, model: 'claude-haiku-4-5', inputTokens: 40, outputTokens: 2 }],
      }),
      0,
    );

    expect(fold.increments()).toEqual([
      {
        weekStart: THIS_WEEK,
        costUsd: 2,
        linesAdded: 8,
        linesRemoved: 1,
        tokensIn: 111 + 141,
        tokensOut: 7,
      },
    ]);
  });

  it('never reports a negative week for a field that moved backwards inside a run', () => {
    const fold = new SpendFold(NO_RUN);

    fold.add(reading(1, { linesAdded: 10 }), 0);
    fold.add(reading(2, { linesAdded: 4 }), 0);

    expect(fold.increments()[0]?.linesAdded).toBe(10);
  });
});

describe('SpendFold — state carried across slices', () => {
  it('continues the run the last slice ended in', () => {
    const first = new SpendFold(NO_RUN);
    first.add(reading(6), 0);

    const second = new SpendFold(first.run);
    second.add(reading(9, { at: RUN_ONE + 3 * HOUR }), 0);

    expect(costs(second)).toEqual([3]);
    expect(second.run).toMatchObject({ costUsd: 9, startedAt: RUN_ONE });
  });

  it('hands the run back untouched when a slice held no reading', () => {
    const held = { ...NO_RUN, costUsd: 4, startedAt: RUN_ONE };

    const fold = new SpendFold(held);

    expect(fold.run).toBe(held);
    expect(fold.increments()).toEqual([]);
  });
});
