// The spend ledger: what it reads, and where its cursor stops — P7-T3.
//
// The budget and the timers are `spend-ledger-timers.test.ts`; both share `spend-ledger-harness.ts`.
import { describe, expect, it } from 'vitest';
import {
  build,
  cost,
  entry,
  prompt,
  spent,
  PATH,
  SESSION,
  STARTED,
  WEEK,
} from './spend-ledger-harness.ts';

describe('SpendLedger — what it reads', () => {
  it('folds the cost-state lines of a transcript into its week, and skips everything else', async () => {
    const { ledger, store, files } = build();
    files.append(PATH, [prompt('hello'), cost(1.5), prompt('more'), cost(4), ''].join('\n'));

    await ledger.read();

    expect(store.spendByWeek(0)).toEqual([
      {
        key: WEEK,
        subscription: '365',
        sessions: 1,
        amount: { costUsd: 4, linesAdded: 2, linesRemoved: 1, tokensIn: 0, tokensOut: 0 },
      },
    ]);
    expect(store.batches[0]).toMatchObject({ projectKey: 'C--work', sessionId: SESSION });
  });

  it('does not take a prompt that QUOTES the record type for a reading', async () => {
    const { ledger, store, files } = build();
    // Escaped inside a string, so the token does not match; and if it did, the parse would say so.
    files.append(PATH, `${prompt('what is a "cost-state" line?')}\n`);

    await ledger.read();

    expect(store.batches[0]?.weeks).toEqual([]);
  });

  it('keeps a resumed session`s first run — the measured $85.69 then $8.23', async () => {
    const { ledger, store, files } = build();
    files.append(PATH, `${cost(85.69)}\n${cost(8.23, STARTED + 3_600_000)}\n`);

    await ledger.read();

    expect(spent(store)).toBeCloseTo(93.92);
  });

  // SEC-FS-2. The indexer's refusal, for the same reason.
  it('refuses a path outside the config directories, and opens nothing', async () => {
    const { ledger, store, files, logger } = build([entry({ path: 'C:\\Windows\\x.jsonl' })]);

    await ledger.read();

    expect(files.reads).toBe(0);
    expect(store.batches).toEqual([]);
    expect(logger.logged('spend_path_refused')).toBe(true);
  });

  it('records nothing for a file it could not read', async () => {
    const { ledger, store, files } = build();
    files.append(PATH, `${cost(1)}\n`);
    files.makeUnreadable(PATH);

    await ledger.read();

    expect(store.batches).toEqual([]);
  });
});

describe('SpendLedger — the cursor', () => {
  it('reads only what was appended, and adds it to the run it continues', async () => {
    const { ledger, store, files } = build();
    files.append(PATH, `${cost(2)}\n`);
    await ledger.read();

    files.append(PATH, `${cost(5, STARTED, 120_000)}\n`);
    await ledger.read();

    expect(spent(store)).toBe(5);
    expect(store.batches[1]?.weeks.map((week) => week.costUsd)).toEqual([3]);
  });

  it('skips a file no longer than its cursor without opening it', async () => {
    const { ledger, files } = build([entry({ bytes: 5 })]);
    files.append(PATH, `${cost(2)}\n`);
    await ledger.read();
    const reads = files.reads;

    await ledger.read();

    expect(files.reads).toBe(reads);
  });

  it('stops before a half-written line, and reads it whole next time', async () => {
    const { ledger, store, files } = build();
    const line = cost(7);
    files.append(PATH, `${cost(1)}\n${line.slice(0, 40)}`);
    await ledger.read();
    expect(spent(store)).toBe(1);

    files.append(PATH, `${line.slice(40)}\n`);
    await ledger.read();

    expect(spent(store)).toBe(7);
  });

  // The indexer pins its cursor to the first byte of a line longer than a slice, forever. A
  // 3.2 MB line exists on this machine (P1-T7), and a `cost-state` behind it would never count.
  it('steps over a line longer than a slice rather than stopping at it for ever', async () => {
    const { ledger, store, files } = build();
    files.sliceLimit = 200_000;
    files.append(PATH, `${prompt('x'.repeat(450_000))}\n${cost(3)}\n`);

    for (let pass = 0; pass < 4; pass += 1) await ledger.read();

    expect(spent(store)).toBe(3);
  });

  it('forgets what a replaced file contributed and folds the new one from nothing', async () => {
    const { ledger, store, files } = build();
    files.append(PATH, `${cost(40)}\n`);
    await ledger.read();

    files.replace(PATH, `${cost(6)}\n`);
    await ledger.read();

    expect(spent(store)).toBe(6);
  });
});
