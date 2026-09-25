// The summary `GET /analytics/spend` answers with — P7-T3.
import { describe, expect, it } from 'vitest';
import {
  MAX_SPEND_PROJECTS,
  SPEND_WEEKS,
  recentWeekStarts,
  weekStartOf,
  type SpendCoverage,
} from '../../../contracts/spend-summary.ts';
import { SpendReport } from '../../../core/application/spend-report.ts';
import { NOTHING_SPENT, type WeekAmount } from '../../../core/domain/spend-fold.ts';
import type { SpendBatch } from '../../../core/ports/spend-store.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeSpendStore } from '../../fakes/fake-spend-store.ts';

const NOW = new Date(2026, 8, 25, 15).getTime();
const THIS_WEEK = weekStartOf(NOW);
const LAST_WEEK = weekStartOf(new Date(2026, 8, 16).getTime());
const COVERAGE: SpendCoverage = { transcripts: 12, behind: 3, passes: 2 };

function week(weekStart: number, costUsd: number): WeekAmount {
  return { ...NOTHING_SPENT, weekStart, costUsd, tokensOut: 10 };
}

function batch(
  path: string,
  weeks: readonly WeekAmount[],
  over: Partial<SpendBatch> = {},
): SpendBatch {
  return {
    path,
    subscription: '365',
    sessionId: path,
    projectKey: 'C--dev-ledger',
    cursor: { offset: 1, identity: 'x' },
    run: { ...NOTHING_SPENT, startedAt: undefined },
    weeks,
    restarted: false,
    at: NOW,
    ...over,
  };
}

function build(): { report: SpendReport; store: FakeSpendStore } {
  const store = new FakeSpendStore();
  const report = new SpendReport({
    store,
    ledger: { progress: () => COVERAGE },
    clock: new FakeClock(NOW),
  });
  return { report, store };
}

describe('SpendReport — weeks', () => {
  it('is every week of the window, oldest first, including the empty ones', () => {
    const { report, store } = build();
    store.recordSpend(batch('a', [week(THIS_WEEK, 4)]));

    const summary = report.summary();

    expect(summary.weeks.map((each) => each.weekStart)).toEqual(recentWeekStarts(NOW));
    expect(summary.weeks).toHaveLength(SPEND_WEEKS);
    expect(summary.weeks[0]?.subscriptions).toEqual([]);
    expect(summary.weeks.at(-1)?.subscriptions).toEqual([
      {
        subscription: '365',
        figures: { ...NOTHING_SPENT, costUsd: 4, tokensOut: 10, sessions: 1 },
      },
    ]);
  });

  it('splits a week by subscription', () => {
    const { report, store } = build();
    store.recordSpend(batch('a', [week(LAST_WEEK, 4)]));
    store.recordSpend(batch('b', [week(LAST_WEEK, 6)], { subscription: 'isg' }));

    const shares = report.summary().weeks.at(-2)?.subscriptions ?? [];

    expect(shares.map((share) => [share.subscription, share.figures.costUsd])).toEqual([
      ['365', 4],
      ['isg', 6],
    ]);
  });

  it('leaves out what is older than the window', () => {
    const { report, store } = build();
    const long = weekStartOf(new Date(2026, 0, 5).getTime());
    store.recordSpend(batch('a', [week(long, 400)]));

    const summary = report.summary();

    expect(summary.weeks.every((each) => each.subscriptions.length === 0)).toBe(true);
    expect(summary.projects).toEqual([]);
  });
});

describe('SpendReport — projects', () => {
  it('is costliest first over the window, with each session counted once', () => {
    const { report, store } = build();
    // One transcript that reported in two weeks is ONE session in its project.
    store.recordSpend(batch('a', [week(LAST_WEEK, 1), week(THIS_WEEK, 2)]));
    store.recordSpend(batch('b', [week(THIS_WEEK, 30)], { projectKey: 'C--dev-atlas' }));

    const projects = report.summary().projects;

    expect(projects.map((project) => project.projectKey)).toEqual([
      'C--dev-atlas',
      'C--dev-ledger',
    ]);
    expect(projects[1]?.subscriptions[0]?.figures).toMatchObject({ costUsd: 3, sessions: 1 });
  });

  it('breaks a tie by key, so two opens draw the same order', () => {
    const { report, store } = build();
    store.recordSpend(batch('a', [week(THIS_WEEK, 5)], { projectKey: 'C--b' }));
    store.recordSpend(batch('b', [week(THIS_WEEK, 5)], { projectKey: 'C--a' }));

    expect(report.summary().projects.map((project) => project.projectKey)).toEqual([
      'C--a',
      'C--b',
    ]);
  });

  it('names at most the cap, and counts the rest', () => {
    const { report, store } = build();
    for (let index = 0; index < MAX_SPEND_PROJECTS + 3; index += 1) {
      store.recordSpend(
        batch(`p${String(index)}`, [week(THIS_WEEK, index + 1)], {
          projectKey: `C--p${String(index)}`,
        }),
      );
    }

    const summary = report.summary();

    expect(summary.projects).toHaveLength(MAX_SPEND_PROJECTS);
    expect(summary.otherProjects).toBe(3);
    expect(summary.projects[0]?.projectKey).toBe(`C--p${String(MAX_SPEND_PROJECTS + 2)}`);
  });
});

describe('SpendReport — what else it says', () => {
  it('carries the ledger`s progress and the instant it was put together', () => {
    const { report } = build();

    const summary = report.summary();

    expect(summary.coverage).toBe(COVERAGE);
    expect(summary.at).toBe(NOW);
  });
});
