// Scaffolding for the two `spend-ledger` files — `transcript-indexer-harness.ts`'s split (P7-T3).
//
// Fakes throughout: the file is `FakeTranscriptFile`, whose `sliceLimit` is what turns "a line
// longer than a slice" into one assignment, and the store is `FakeSpendStore`, which adds weeks
// the way the SQL does.
import { setImmediate } from 'node:timers';
import { weekStartOf } from '../../../contracts/spend-summary.ts';
import { SpendLedger } from '../../../core/application/spend-ledger.ts';
import { ReadPolicy } from '../../../core/domain/read-policy.ts';
import type { CatalogueEntry } from '../../../core/ports/transcript-catalogue.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeScheduler } from '../../fakes/fake-scheduler.ts';
import { FakeSpendStore } from '../../fakes/fake-spend-store.ts';
import { FakeTranscriptFile } from '../../fakes/fake-transcript-file.ts';

export const CONFIG = 'C:\\home\\.claude-365';
export const SESSION = 'aaaaaaaa-0000-0000-0000-000000000000';
export const PATH = `${CONFIG}\\projects\\C--work\\${SESSION}.jsonl`;
export const STARTED = new Date(2026, 8, 21, 9).getTime();
export const WEEK = weekStartOf(STARTED);

export function entry(over: Partial<CatalogueEntry> = {}): CatalogueEntry {
  return {
    path: PATH,
    subscription: '365',
    sessionId: SESSION,
    projectKey: 'C--work',
    bytes: 1_000_000_000,
    ...over,
  };
}

/** A `cost-state` line as Claude Code writes one — no `timestamp`, `startTime + totalDuration`. */
export function cost(totalCostUSD: number, startTime = STARTED, totalDuration = 60_000): string {
  return JSON.stringify({
    type: 'cost-state',
    totalCostUSD,
    totalLinesAdded: 2,
    totalLinesRemoved: 1,
    startTime,
    totalDuration,
    modelUsage: {},
  });
}

export function prompt(text: string): string {
  return JSON.stringify({ type: 'user', message: { content: text } });
}

export interface Built {
  readonly ledger: SpendLedger;
  readonly store: FakeSpendStore;
  readonly files: FakeTranscriptFile;
  readonly scheduler: FakeScheduler;
  readonly logger: FakeLogger;
}

export function build(entries: readonly CatalogueEntry[] = [entry()]): Built {
  const store = new FakeSpendStore();
  const files = new FakeTranscriptFile();
  const scheduler = new FakeScheduler();
  const logger = new FakeLogger();
  const ledger = new SpendLedger({
    catalogue: { list: () => Promise.resolve(entries) },
    files,
    store,
    policy: new ReadPolicy([CONFIG]),
    scheduler,
    clock: new FakeClock(),
    logger,
  });
  return { ledger, store, files, scheduler, logger };
}

export async function settle(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

/** More transcripts than one pass's budget, each holding one reading. */
export function manyFiles(count: number): Built {
  const content = `${cost(1)}\n`;
  const entries = Array.from({ length: count }, (unused, index) =>
    entry({
      path: `${CONFIG}\\projects\\C--work\\${String(index)}.jsonl`,
      bytes: Buffer.byteLength(content),
    }),
  );
  const built = build(entries);
  for (const each of entries) built.files.append(each.path, content);
  return built;
}

export function spent(store: FakeSpendStore): number {
  return store.spendByWeek(0).reduce((sum, cell) => sum + cell.amount.costUsd, 0);
}
