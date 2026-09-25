// The spend ledger's budget and its two timers — P7-T3.
import { describe, expect, it } from 'vitest';
import { SPEND_CATCH_UP_MS, SPEND_INTERVAL_MS } from '../../../core/application/spend-ledger.ts';
import { build, cost, entry, manyFiles, settle, spent, PATH } from './spend-ledger-harness.ts';

describe('SpendLedger — the budget and the timers', () => {
  it('reads a long transcript to its end in one pass, a slice at a time', async () => {
    const content = `${cost(1)}\n${cost(2)}\n${cost(5)}\n`;
    const { ledger, store, files } = build([entry({ bytes: Buffer.byteLength(content) })]);
    files.sliceLimit = Buffer.byteLength(cost(1)) + 5;
    files.append(PATH, content);

    const coverage = await ledger.read();

    expect(coverage).toEqual({ transcripts: 1, behind: 0, passes: 1 });
    expect(ledger.progress()).toBe(coverage);
    expect(store.batches).toHaveLength(3);
    expect(spent(store)).toBe(5);
  });

  it('does not re-read a slice that could not move the cursor, in the same pass', async () => {
    const { ledger, files } = build();
    files.sliceLimit = 10;
    files.append(PATH, `${cost(1)}\n`);

    const coverage = await ledger.read();

    expect(files.reads).toBe(1);
    expect(coverage.behind).toBe(0);
  });

  it('counts a file left over when the pass budget runs out as behind, and opens it not', async () => {
    const { ledger, files } = manyFiles(130);

    const coverage = await ledger.read();

    expect(coverage.transcripts).toBe(130);
    expect(coverage.behind).toBe(2);
    expect(files.reads).toBe(128);
  });

  it('does not count a file the budget never reached as behind when it has nothing new', async () => {
    const { ledger } = manyFiles(130);
    await ledger.read();
    await ledger.read();

    const third = await ledger.read();

    expect(third.behind).toBe(0);
  });

  it('starts an interval and reads once immediately', async () => {
    const { ledger, store, files, scheduler } = build();
    files.append(PATH, `${cost(1)}\n`);

    ledger.start();
    ledger.start();
    await settle();

    expect(scheduler.repeatingCount).toBe(1);
    expect(store.batches).toHaveLength(1);
    ledger.stop();
    expect(scheduler.repeatingCount).toBe(0);
  });

  it('catches up in seconds while it is behind, and stops catching up once it is not', async () => {
    const { ledger, scheduler } = manyFiles(300);

    ledger.start();
    await settle();
    expect(scheduler.pendingCount).toBe(1);

    for (let step = 0; step < 10 && scheduler.pendingCount > 0; step += 1) {
      scheduler.advance(SPEND_CATCH_UP_MS);
      await settle();
    }

    expect(ledger.progress().behind).toBe(0);
    expect(scheduler.pendingCount).toBe(0);
    ledger.stop();
  });

  it('schedules no catch-up when it was never started, and cancels one on stop', async () => {
    const { ledger, scheduler } = manyFiles(260);

    await ledger.read();
    expect(scheduler.pendingCount).toBe(0);

    ledger.start();
    await settle();
    expect(scheduler.pendingCount).toBe(1);
    ledger.stop();
    expect(scheduler.pendingCount).toBe(0);
  });

  it('runs one pass at a time', async () => {
    const { ledger, files } = build();
    files.append(PATH, `${cost(1)}\n`);

    const [first, second] = await Promise.all([ledger.read(), ledger.read()]);

    expect(first.passes).toBe(1);
    // The second was dropped and answered with what was held before the first finished.
    expect(second.passes).toBe(0);
  });

  it('logs a store that cannot be written and keeps going next pass', async () => {
    const { ledger, store, files, logger } = build();
    files.append(PATH, `${cost(1)}\n`);
    store.refuseWrites();

    const coverage = await ledger.read();

    expect(coverage.passes).toBe(0);
    expect(logger.logged('spend_failed')).toBe(true);
  });

  it('ticks on the interval it names', () => {
    expect(SPEND_INTERVAL_MS).toBe(300_000);
  });
});
