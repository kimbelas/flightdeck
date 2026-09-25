// Running totals into amounts per week — P7-T3, D5.
//
// **A `cost-state` total is cumulative over a RUN, not over a transcript.** Every figure on the
// line — `totalCostUSD`, the lines, each model's tokens — counts from the moment one claude
// process started (`startTime`) and climbs until it exits. A session resumed into the same file is
// a second process: its first `cost-state` carries a new `startTime` and is back near zero. That
// was measured, not supposed — one transcript on this machine went $85.69 → $8.23 at a new
// `startTime`, and it is the only reset in 679 lines (RESEARCH.md G.59). So:
//
//   - taking the LAST total per transcript loses the first run ($85.69 of it, here);
//   - taking the MAXIMUM loses the smaller run, whichever it is;
//   - SUMMING every line counts a run once per line it wrote — and 36 lines repeat the total before.
//
// What is right is the increment: each reading minus the one before it in the same run, and the
// whole reading when it starts a new run. The increments add up to Claude Code's own totals and
// each one has an instant, which is what lets "per week" exist at all.
//
// **Pure, and it carries its state in and out.** The ledger reads a transcript a slice at a time
// across five-minute ticks and core restarts, so the run a slice continues is stored beside the
// byte cursor and handed back here. Nothing about a file, a clock or a store is known in this file.
import { weekStartOf } from '../../contracts/spend-summary.ts';
import type { TranscriptRecord } from '../../contracts/transcript-record.ts';

/** A cost reading, as `transcript-record.ts` projects the line. */
export type CostReading = Extract<TranscriptRecord, { kind: 'cost' }>;

/** What a slice of history spent. `SpendFigures` without `sessions`, which only a query can count. */
export interface SpendAmount {
  readonly costUsd: number;
  readonly linesAdded: number;
  readonly linesRemoved: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
}

/** Where one transcript's current run has got to — the last reading's totals, and its start. */
export interface SpendRun extends SpendAmount {
  /** `startTime` of the run, or `undefined` before the first reading or when a line had none. */
  readonly startedAt: number | undefined;
}

/** One week's increment out of a fold. */
export interface WeekAmount extends SpendAmount {
  readonly weekStart: number;
}

export const NOTHING_SPENT: SpendAmount = {
  costUsd: 0,
  linesAdded: 0,
  linesRemoved: 0,
  tokensIn: 0,
  tokensOut: 0,
};

/** The run a transcript is in before anything has been read out of it. */
export const NO_RUN: SpendRun = { ...NOTHING_SPENT, startedAt: undefined };

export class SpendFold {
  private current: SpendRun;
  private readonly weeks = new Map<number, SpendAmount>();

  /** @param run where this transcript's run got to at the end of the last slice. */
  constructor(run: SpendRun) {
    this.current = run;
  }

  /** The run as it stands after every reading so far — what to store beside the cursor. */
  public get run(): SpendRun {
    return this.current;
  }

  /**
   * One reading, folded in.
   *
   * @param fallbackAt the instant to file it under when the line gave none. Never used on this
   * machine — every one of 679 lines had `startTime` and `totalDuration` — and still needed,
   * because a line without them is a line from a release nobody has measured.
   */
  public add(reading: CostReading, fallbackAt: number): void {
    const totals = totalsOf(reading);
    const increment = this.startsRun(reading, totals) ? totals : minus(totals, this.current);
    const weekStart = weekStartOf(reading.at ?? fallbackAt);
    this.weeks.set(weekStart, plus(this.weeks.get(weekStart) ?? NOTHING_SPENT, increment));
    this.current = { ...totals, startedAt: reading.startedAt };
  }

  /** What each week gained, oldest first. A week a zero reading landed in is still listed. */
  public increments(): readonly WeekAmount[] {
    return [...this.weeks]
      .map(([weekStart, amount]) => ({ weekStart, ...amount }))
      .sort((left, right) => left.weekStart - right.weekStart);
  }

  /**
   * Whether this reading is the first of a new run rather than the next of this one.
   *
   * A different `startTime` is the evidence. A total that went DOWN is the second, for a line
   * that carried no `startTime` at all: within one run nothing on the line ever decreases.
   */
  private startsRun(reading: CostReading, totals: SpendAmount): boolean {
    const held = this.current.startedAt;
    if (held !== undefined && reading.startedAt !== undefined && held !== reading.startedAt) {
      return true;
    }
    return totals.costUsd < this.current.costUsd;
  }
}

/** A reading's run totals, with the tokens summed across models. */
function totalsOf(reading: CostReading): SpendAmount {
  let tokensIn = 0;
  let tokensOut = 0;
  for (const model of reading.spend) {
    tokensIn += model.inputTokens + model.cacheReadTokens + model.cacheCreationTokens;
    tokensOut += model.outputTokens;
  }
  return {
    costUsd: reading.costUsd,
    linesAdded: reading.linesAdded,
    linesRemoved: reading.linesRemoved,
    tokensIn,
    tokensOut,
  };
}

/**
 * `left - right`, field by field, never below zero.
 *
 * The floor is for a field that moved backwards while the cost did not — not observed, and if a
 * release ever does it the honest answer for that field is "nothing new", not a negative week.
 */
function minus(left: SpendAmount, right: SpendAmount): SpendAmount {
  return {
    costUsd: Math.max(0, left.costUsd - right.costUsd),
    linesAdded: Math.max(0, left.linesAdded - right.linesAdded),
    linesRemoved: Math.max(0, left.linesRemoved - right.linesRemoved),
    tokensIn: Math.max(0, left.tokensIn - right.tokensIn),
    tokensOut: Math.max(0, left.tokensOut - right.tokensOut),
  };
}

export function plus(left: SpendAmount, right: SpendAmount): SpendAmount {
  return {
    costUsd: left.costUsd + right.costUsd,
    linesAdded: left.linesAdded + right.linesAdded,
    linesRemoved: left.linesRemoved + right.linesRemoved,
    tokensIn: left.tokensIn + right.tokensIn,
    tokensOut: left.tokensOut + right.tokensOut,
  };
}
