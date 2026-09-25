// An in-memory `SpendStore` — the fake for the spend ledger's tables (P7-T3).
//
// It keeps the one rule the real store's SQL keeps that a test could get wrong by accident: a
// week's increment is ADDED to what is held, and a restarted file forgets its old weeks first.
// The summaries group the same way the two GROUP BYs do, with `sessions` as a distinct count.
import type { SubscriptionId } from '../../contracts/session.ts';
import { NOTHING_SPENT, plus, type SpendAmount } from '../../core/domain/spend-fold.ts';
import type { SpendBatch, SpendCell, SpendMark, SpendStore } from '../../core/ports/spend-store.ts';

interface WeekRow {
  readonly path: string;
  readonly weekStart: number;
  readonly subscription: SubscriptionId;
  readonly projectKey: string;
  readonly amount: SpendAmount;
}

export class FakeSpendStore implements SpendStore {
  /** Every batch recorded, in order, for a test that wants to see what one pass wrote. */
  public readonly batches: SpendBatch[] = [];
  private readonly marks = new Map<string, SpendMark>();
  private readonly weeks = new Map<string, WeekRow>();
  private writable = true;

  /** Makes every write throw, as a full disk or a locked file would. */
  public refuseWrites(): void {
    this.writable = false;
  }

  public spendMark(path: string): SpendMark | undefined {
    return this.marks.get(path);
  }

  public recordSpend(batch: SpendBatch): void {
    if (!this.writable) throw new Error('store is not writable');
    if (batch.restarted) {
      for (const [slot, row] of this.weeks) if (row.path === batch.path) this.weeks.delete(slot);
    }
    for (const week of batch.weeks) {
      const slot = `${batch.path}|${String(week.weekStart)}`;
      const held = this.weeks.get(slot)?.amount ?? NOTHING_SPENT;
      this.weeks.set(slot, {
        path: batch.path,
        weekStart: week.weekStart,
        subscription: batch.subscription,
        projectKey: batch.projectKey,
        amount: plus(held, week),
      });
    }
    this.marks.set(batch.path, { cursor: batch.cursor, run: batch.run });
    this.batches.push(batch);
  }

  public spendByWeek(since: number): readonly SpendCell<number>[] {
    return this.group(since, (row) => row.weekStart);
  }

  public spendByProject(since: number): readonly SpendCell<string>[] {
    return this.group(since, (row) => row.projectKey);
  }

  private group<Key>(since: number, keyOf: (row: WeekRow) => Key): readonly SpendCell<Key>[] {
    const cells = new Map<string, { cell: SpendCell<Key>; paths: Set<string> }>();
    for (const row of this.weeks.values()) {
      if (row.weekStart < since) continue;
      const key = keyOf(row);
      const slot = `${String(key)}|${row.subscription}`;
      const held = cells.get(slot) ?? {
        cell: { key, subscription: row.subscription, sessions: 0, amount: NOTHING_SPENT },
        paths: new Set<string>(),
      };
      held.paths.add(row.path);
      cells.set(slot, {
        paths: held.paths,
        cell: {
          ...held.cell,
          sessions: held.paths.size,
          amount: plus(held.cell.amount, row.amount),
        },
      });
    }
    return [...cells.values()].map((entry) => entry.cell);
  }
}
