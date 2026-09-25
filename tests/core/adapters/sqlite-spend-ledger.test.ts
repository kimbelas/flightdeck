// The spend ledger's tables, on a real file — P7-T3.
//
// The half `FakeSpendStore` cannot cover: the upsert that ADDS a week rather than replacing it,
// `COUNT(DISTINCT path)`, the transaction and the migration. Each is SQL, and each is a way for a
// cost panel to be quietly wrong by a factor.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteStore } from '../../../core/adapters/sqlite/sqlite-store.ts';
import { NOTHING_SPENT, type WeekAmount } from '../../../core/domain/spend-fold.ts';
import type { SpendBatch } from '../../../core/ports/spend-store.ts';

let directory = '';
const opened: SqliteStore[] = [];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'flightdeck-spend-'));
});

afterEach(() => {
  // Windows will not delete a directory something holds a handle on — `sqlite-search.test.ts`.
  for (const store of opened.splice(0)) store.close();
  rmSync(directory, { recursive: true, force: true });
});

function open(): SqliteStore {
  const store = new SqliteStore(join(directory, 'flightdeck.db'));
  opened.push(store);
  return store;
}

const PATH = 'C:\\home\\.claude-365\\projects\\C--work\\aaaaaaaa-0000-0000-0000-000000000000.jsonl';
const OTHER =
  'C:\\home\\.claude-isg\\projects\\C--work\\bbbbbbbb-0000-0000-0000-000000000000.jsonl';
const WEEK_ONE = 1_000_000;
const WEEK_TWO = 2_000_000;

function week(weekStart: number, costUsd: number): WeekAmount {
  return {
    weekStart,
    costUsd,
    linesAdded: 3,
    linesRemoved: 1,
    tokensIn: 1000,
    tokensOut: 20,
  };
}

function batch(over: Partial<SpendBatch> = {}): SpendBatch {
  return {
    path: PATH,
    subscription: '365',
    sessionId: 'aaaaaaaa-0000-0000-0000-000000000000',
    projectKey: 'C--work',
    cursor: { offset: 120, identity: 'dev:1:2026' },
    run: { ...NOTHING_SPENT, costUsd: 4.5, startedAt: 77 },
    weeks: [week(WEEK_ONE, 4.5)],
    restarted: false,
    at: 5000,
    ...over,
  };
}

describe('SqliteSpendLedger — the mark', () => {
  it('has none for a transcript it never read', () => {
    expect(open().spend.spendMark(PATH)).toBeUndefined();
  });

  it('keeps the cursor and the run it was in, across a reopen', () => {
    open().spend.recordSpend(batch());
    opened.splice(0).forEach((store) => {
      store.close();
    });

    expect(open().spend.spendMark(PATH)).toEqual({
      cursor: { offset: 120, identity: 'dev:1:2026' },
      run: { ...NOTHING_SPENT, costUsd: 4.5, startedAt: 77 },
    });
  });

  it('reads a run with no startTime back as undefined, not zero', () => {
    const { spend } = open();
    spend.recordSpend(batch({ run: { ...NOTHING_SPENT, startedAt: undefined } }));

    expect(spend.spendMark(PATH)?.run.startedAt).toBeUndefined();
  });
});

describe('SqliteSpendLedger — the weeks', () => {
  it('ADDS a slice to the week it already holds', () => {
    const { spend } = open();
    spend.recordSpend(batch());
    spend.recordSpend(batch({ weeks: [week(WEEK_ONE, 0.25)] }));

    const cells = spend.spendByWeek(0);

    expect(cells).toHaveLength(1);
    expect(cells[0]?.amount).toEqual({
      costUsd: 4.75,
      linesAdded: 6,
      linesRemoved: 2,
      tokensIn: 2000,
      tokensOut: 40,
    });
  });

  it('forgets a restarted transcript`s weeks before adding the new ones', () => {
    const { spend } = open();
    spend.recordSpend(batch({ weeks: [week(WEEK_ONE, 9), week(WEEK_TWO, 9)] }));
    spend.recordSpend(batch({ restarted: true, weeks: [week(WEEK_TWO, 1)] }));

    expect(spend.spendByWeek(0).map((cell) => [cell.key, cell.amount.costUsd])).toEqual([
      [WEEK_TWO, 1],
    ]);
  });

  it('groups by week and subscription, counting each transcript once', () => {
    const { spend } = open();
    spend.recordSpend(batch({ weeks: [week(WEEK_ONE, 1), week(WEEK_TWO, 2)] }));
    spend.recordSpend(
      batch({ path: OTHER, subscription: 'isg', sessionId: 'b', weeks: [week(WEEK_TWO, 5)] }),
    );

    expect(
      spend.spendByWeek(0).map((cell) => [cell.key, cell.subscription, cell.sessions]),
    ).toEqual([
      [WEEK_ONE, '365', 1],
      [WEEK_TWO, '365', 1],
      [WEEK_TWO, 'isg', 1],
    ]);
  });

  it('groups by project over the window, and a transcript in two weeks is one session', () => {
    const { spend } = open();
    spend.recordSpend(batch({ weeks: [week(WEEK_ONE, 1), week(WEEK_TWO, 2)] }));

    const cells = spend.spendByProject(0);

    expect(cells).toEqual([
      {
        key: 'C--work',
        subscription: '365',
        sessions: 1,
        amount: { costUsd: 3, linesAdded: 6, linesRemoved: 2, tokensIn: 2000, tokensOut: 40 },
      },
    ]);
  });

  it('answers only from the week it is asked from', () => {
    const { spend } = open();
    spend.recordSpend(batch({ weeks: [week(WEEK_ONE, 1), week(WEEK_TWO, 2)] }));

    expect(spend.spendByWeek(WEEK_TWO).map((cell) => cell.key)).toEqual([WEEK_TWO]);
    expect(spend.spendByProject(WEEK_TWO)[0]?.amount.costUsd).toBe(2);
  });
});

describe('SqliteSpendLedger — the transaction', () => {
  it('writes nothing when any part of a slice fails', () => {
    const store = open();
    store.close();

    expect(() => {
      store.spend.recordSpend(batch());
    }).toThrow();
  });
});
