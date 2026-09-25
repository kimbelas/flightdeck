// What the cost panel draws — P7-T3.
import { describe, expect, it } from 'vitest';
import type { ProjectRecord } from '../../contracts/project.ts';
import {
  NO_SPEND,
  type SpendFigures,
  type SpendSummary,
  type SubscriptionSpend,
} from '../../contracts/spend-summary.ts';
import { SpendViewModel } from '../../app/deck/spend-view-model.ts';

const MONDAY_14 = new Date(2026, 8, 14).getTime();
const MONDAY_21 = new Date(2026, 8, 21).getTime();

const LEDGER: ProjectRecord = {
  path: 'C:\\Users\\owner\\Documents\\ledger',
  name: 'ledger',
  importedAt: 1,
};

function share(subscription: '365' | 'isg', over: Partial<SpendFigures>): SubscriptionSpend {
  return { subscription, figures: { ...NO_SPEND, ...over } };
}

function summary(over: Partial<SpendSummary> = {}): SpendSummary {
  return {
    at: MONDAY_21,
    weeks: [
      { weekStart: MONDAY_14, subscriptions: [share('isg', { costUsd: 5, sessions: 1 })] },
      {
        weekStart: MONDAY_21,
        subscriptions: [
          share('isg', { costUsd: 2.5, sessions: 1 }),
          share('365', { costUsd: 7.5, sessions: 3 }),
        ],
      },
    ],
    projects: [
      {
        projectKey: 'C--Users-owner-Documents-ledger',
        subscriptions: [
          share('365', { costUsd: 7.5, sessions: 3, linesAdded: 40, linesRemoved: 2 }),
        ],
      },
      {
        projectKey: 'C--Users-owner-Documents-ledger--claude-worktrees-fix-7',
        subscriptions: [share('isg', { costUsd: 2.5, sessions: 1 })],
      },
      { projectKey: 'C--Users-owner-Desktop', subscriptions: [share('isg', { costUsd: 5 })] },
    ],
    otherProjects: 0,
    coverage: { transcripts: 40, behind: 0, passes: 3 },
    ...over,
  };
}

describe('SpendViewModel — weeks', () => {
  it('labels each week by its Monday and sums both accounts', () => {
    const weeks = new SpendViewModel(summary(), []).weeks;

    expect(weeks.map((week) => [week.label, week.cost, week.sessions])).toEqual([
      ['Sep 14', '$5.00', 1],
      ['Sep 21', '$10.00', 4],
    ]);
  });

  it('draws bars against the tallest week, in a fixed account order', () => {
    const weeks = new SpendViewModel(summary(), []).weeks;

    // `SUBSCRIPTION_IDS` order, whatever order the week listed them in.
    expect(weeks[1]?.bars).toEqual([
      { subscription: 'isg', percent: 25, cost: '$2.50' },
      { subscription: '365', percent: 75, cost: '$7.50' },
    ]);
    expect(weeks[0]?.bars).toEqual([{ subscription: 'isg', percent: 50, cost: '$5.00' }]);
  });

  it('marks the newest week as the current one', () => {
    const weeks = new SpendViewModel(summary(), []).weeks;

    expect(weeks.map((week) => week.current)).toEqual([false, true]);
  });

  it('draws empty bars rather than dividing by zero when nothing was spent', () => {
    const model = new SpendViewModel(
      summary({ weeks: [{ weekStart: MONDAY_21, subscriptions: [share('365', {})] }] }),
      [],
    );

    expect(model.weeks[0]?.bars[0]?.percent).toBe(0);
  });
});

describe('SpendViewModel — totals', () => {
  it('totals the window per account, and over both', () => {
    const model = new SpendViewModel(summary(), []);

    expect(model.totals).toEqual([
      { subscription: 'isg', cost: '$7.50' },
      { subscription: '365', cost: '$7.50' },
    ]);
    expect(model.total).toBe('$15.00');
  });

  it('is empty only when no week has anything in it', () => {
    expect(new SpendViewModel(summary(), []).empty).toBe(false);
    expect(
      new SpendViewModel(summary({ weeks: [{ weekStart: MONDAY_21, subscriptions: [] }] }), [])
        .empty,
    ).toBe(true);
  });
});

describe('SpendViewModel — projects', () => {
  it('names a slug by the imported folder it belongs to, case-blind', () => {
    const projects = new SpendViewModel(summary(), [
      { ...LEDGER, path: 'c:\\users\\owner\\documents\\ledger' },
    ]).projects;

    expect(projects[0]).toMatchObject({ label: 'ledger', imported: true, cost: '$7.50' });
  });

  it('names a worktree under .claude by its project and the tree', () => {
    const projects = new SpendViewModel(summary(), [LEDGER]).projects;

    expect(projects[1]).toMatchObject({ label: 'ledger · fix-7', imported: true });
  });

  it('shows the slug itself for a folder nobody imported', () => {
    const projects = new SpendViewModel(summary(), [LEDGER]).projects;

    expect(projects[2]).toMatchObject({ label: 'C--Users-owner-Desktop', imported: false });
  });

  it('says which account paid, how many sessions and what changed', () => {
    const line = new SpendViewModel(summary(), [LEDGER]).projects[0];

    expect(line?.split).toBe('365 $7.50');
    expect(line?.sessions).toBe(3);
    expect(line?.lines).toBe('+40 −2');
  });

  it('counts the folders it left out', () => {
    expect(new SpendViewModel(summary(), []).more).toBeUndefined();
    expect(new SpendViewModel(summary({ otherProjects: 1 }), []).more).toBe('and 1 more folder');
    expect(new SpendViewModel(summary({ otherProjects: 4 }), []).more).toBe('and 4 more folders');
  });
});

describe('SpendViewModel — coverage', () => {
  it('says the ledger has not read anything yet', () => {
    const model = new SpendViewModel(
      summary({ coverage: { transcripts: 0, behind: 0, passes: 0 } }),
      [],
    );

    expect(model.coverage).toMatch(/not read the transcripts yet/u);
    expect(model.filling).toBe(true);
  });

  it('says it is still reading, and that the numbers are low because of it', () => {
    const model = new SpendViewModel(
      summary({ coverage: { transcripts: 40, behind: 7, passes: 1 } }),
      [],
    );

    expect(model.coverage).toBe(
      'Still reading: 7 of 40 transcripts have more to read, so these numbers are low.',
    );
    expect(model.filling).toBe(true);
  });

  it('says everything was read, and when a session lands', () => {
    const model = new SpendViewModel(summary(), []);

    expect(model.coverage).toMatch(/^Every one of 40 transcripts read\./u);
    expect(model.filling).toBe(false);
  });
});
