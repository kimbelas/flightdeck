// The spend summary's wire shape and its week arithmetic — P7-T3.
//
// The week tests build their instants with the LOCAL `Date` constructor, never from an ISO string:
// a week starts at local midnight on a Monday, and a test that pinned a UTC instant would pass in
// one timezone and fail in the next.
import { describe, expect, it } from 'vitest';
import {
  MAX_SPEND_PROJECTS,
  NO_SPEND,
  SPEND_WEEKS,
  addFigures,
  parseSpendSummary,
  recentWeekStarts,
  totalOf,
  weekStartOf,
  type SpendFigures,
} from '../../contracts/spend-summary.ts';

/** Friday 25 September 2026, mid-afternoon, local time. */
const FRIDAY = new Date(2026, 8, 25, 15, 30).getTime();
const MONDAY = new Date(2026, 8, 21).getTime();

function figures(over: Partial<SpendFigures> = {}): SpendFigures {
  return { ...NO_SPEND, ...over };
}

describe('weekStartOf', () => {
  it('is local midnight on the Monday that starts the week', () => {
    expect(weekStartOf(FRIDAY)).toBe(MONDAY);
  });

  it('puts Sunday night in the week it ends, not the one after', () => {
    const sunday = new Date(2026, 8, 27, 23, 59).getTime();

    expect(weekStartOf(sunday)).toBe(MONDAY);
  });

  it('puts the first minute of a Monday in the new week', () => {
    const next = new Date(2026, 8, 28).getTime();

    expect(weekStartOf(next)).toBe(next);
  });

  // Calendar arithmetic, not `- 7 * 24 h`: the last Sunday of October is a 25-hour day in Europe.
  it('still lands on a midnight across a daylight-saving change', () => {
    const afterChange = new Date(2026, 10, 1, 12).getTime();

    expect(new Date(weekStartOf(afterChange)).getHours()).toBe(0);
    expect(new Date(weekStartOf(afterChange)).getDay()).toBe(1);
  });
});

describe('recentWeekStarts', () => {
  it('is SPEND_WEEKS Mondays, oldest first, ending with this one', () => {
    const starts = recentWeekStarts(FRIDAY);

    expect(starts).toHaveLength(SPEND_WEEKS);
    expect(starts.at(-1)).toBe(MONDAY);
    expect(starts[0]).toBe(new Date(2026, 7, 3).getTime());
    for (const start of starts) expect(new Date(start).getDay()).toBe(1);
  });

  it('takes a count', () => {
    expect(recentWeekStarts(FRIDAY, 2)).toEqual([new Date(2026, 8, 14).getTime(), MONDAY]);
  });
});

describe('addFigures and totalOf', () => {
  it('adds every field, sessions included', () => {
    const sum = addFigures(
      figures({ costUsd: 1.5, sessions: 2, linesAdded: 3, tokensOut: 10 }),
      figures({ costUsd: 0.25, sessions: 1, linesRemoved: 4, tokensIn: 7 }),
    );

    expect(sum).toEqual({
      costUsd: 1.75,
      sessions: 3,
      linesAdded: 3,
      linesRemoved: 4,
      tokensIn: 7,
      tokensOut: 10,
    });
  });

  it('totals a share list, and an empty one is nothing spent', () => {
    expect(totalOf([])).toEqual(NO_SPEND);
    expect(
      totalOf([
        { subscription: '365', figures: figures({ costUsd: 2 }) },
        { subscription: 'isg', figures: figures({ costUsd: 3 }) },
      ]).costUsd,
    ).toBe(5);
  });
});

describe('parseSpendSummary', () => {
  const WIRE = {
    at: 1000,
    weeks: [
      {
        weekStart: MONDAY,
        subscriptions: [{ subscription: 'isg', figures: { costUsd: 12.5, sessions: 3 } }],
      },
    ],
    projects: [
      {
        projectKey: 'C--dev-ledger',
        subscriptions: [{ subscription: '365', figures: { costUsd: 0.12, sessions: 1 } }],
      },
    ],
    otherProjects: 2,
    coverage: { transcripts: 40, behind: 3, passes: 1 },
  };

  it('reads a summary back', () => {
    const summary = parseSpendSummary(WIRE);

    expect(summary?.weeks[0]?.subscriptions[0]?.figures.costUsd).toBe(12.5);
    expect(summary?.projects[0]?.projectKey).toBe('C--dev-ledger');
    expect(summary?.otherProjects).toBe(2);
    expect(summary?.coverage).toEqual({ transcripts: 40, behind: 3, passes: 1 });
  });

  it('keeps cents — `$0.12` is a real answer, and flooring it would say nothing was spent', () => {
    const project = parseSpendSummary(WIRE)?.projects[0];

    expect(project?.subscriptions[0]?.figures.costUsd).toBe(0.12);
  });

  it('refuses what is not a summary', () => {
    for (const value of [null, [], 'x', { at: 'now', weeks: [], projects: [] }, { at: 1 }]) {
      expect(parseSpendSummary(value)).toBeUndefined();
    }
  });

  it('drops entries it cannot read rather than the whole summary', () => {
    const summary = parseSpendSummary({
      ...WIRE,
      weeks: [{ weekStart: 'monday' }, ...WIRE.weeks],
      projects: [{ projectKey: '' }, { projectKey: 7 }, ...WIRE.projects],
    });

    expect(summary?.weeks).toHaveLength(1);
    expect(summary?.projects).toHaveLength(1);
  });

  it('drops a subscription this build does not know, and a negative or absent figure is zero', () => {
    const summary = parseSpendSummary({
      ...WIRE,
      weeks: [
        {
          weekStart: MONDAY,
          subscriptions: [
            { subscription: 'personal', figures: { costUsd: 1 } },
            { subscription: '365', figures: { costUsd: -4, sessions: 2.7 } },
          ],
        },
      ],
      coverage: undefined,
    });

    expect(summary?.weeks[0]?.subscriptions).toEqual([
      { subscription: '365', figures: figures({ sessions: 2 }) },
    ]);
    expect(summary?.coverage).toEqual({ transcripts: 0, behind: 0, passes: 0 });
  });

  it('keeps at most the window and the project cap, whatever arrives', () => {
    const weeks = Array.from({ length: SPEND_WEEKS + 3 }, (unused, index) => ({
      weekStart: index,
      subscriptions: [],
    }));
    const projects = Array.from({ length: MAX_SPEND_PROJECTS + 5 }, (unused, index) => ({
      projectKey: `C--p${String(index)}`,
      subscriptions: [],
    }));

    const summary = parseSpendSummary({ ...WIRE, weeks, projects });

    expect(summary?.weeks).toHaveLength(SPEND_WEEKS);
    // The NEWEST weeks survive — the window ends this week.
    expect(summary?.weeks.at(-1)?.weekStart).toBe(SPEND_WEEKS + 2);
    expect(summary?.projects).toHaveLength(MAX_SPEND_PROJECTS);
  });
});
