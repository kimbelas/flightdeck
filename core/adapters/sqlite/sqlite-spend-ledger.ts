// The spend ledger's half of the store — P7-T3, SEC-DATA-3.
//
// `SqliteTranscriptIndex`'s shape, for its reasons: a class beside `SqliteStore` rather than more
// methods on it, sharing the handle `SqliteStore` opened and migrated rather than opening one.
import type { DatabaseSync } from 'node:sqlite';
import { SUBSCRIPTION_IDS, type SubscriptionId } from '../../../contracts/session.ts';
import type { SpendRun } from '../../domain/spend-fold.ts';
import type { SpendBatch, SpendCell, SpendMark, SpendStore } from '../../ports/spend-store.ts';
import { asRecord } from './rows.ts';
import { prepareSpendStatements, type SpendStatements } from './spend-statements.ts';

export class SqliteSpendLedger implements SpendStore {
  private readonly db: DatabaseSync;
  private readonly rows: SpendStatements;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.rows = prepareSpendStatements(db);
  }

  public spendMark(path: string): SpendMark | undefined {
    const fields = asRecord(this.rows.selectMark.get(path));
    if (fields === undefined) return undefined;
    const identity = fields['identity'];
    if (typeof identity !== 'string' || identity === '') return undefined;
    return { cursor: { offset: numberAt(fields, 'offset_bytes'), identity }, run: runOf(fields) };
  }

  /** One transaction — see the port. The delete comes first, and only when the file restarted. */
  public recordSpend(batch: SpendBatch): void {
    this.db.exec('BEGIN');
    try {
      if (batch.restarted) this.rows.deleteWeeks.run(batch.path);
      for (const week of batch.weeks) {
        this.rows.addWeek.run(
          batch.path,
          week.weekStart,
          batch.subscription,
          batch.projectKey,
          week.costUsd,
          week.linesAdded,
          week.linesRemoved,
          week.tokensIn,
          week.tokensOut,
        );
      }
      this.upsertMark(batch);
      this.db.exec('COMMIT');
    } catch (cause) {
      this.db.exec('ROLLBACK');
      throw new Error('recordSpend failed', { cause });
    }
  }

  public spendByWeek(since: number): readonly SpendCell<number>[] {
    return this.rows.byWeek.all(since).flatMap((row) => {
      const cell = cellOf(row);
      const key = asRecord(row)?.['key'];
      return cell === undefined || typeof key !== 'number' ? [] : [{ ...cell, key }];
    });
  }

  public spendByProject(since: number): readonly SpendCell<string>[] {
    return this.rows.byProject.all(since).flatMap((row) => {
      const cell = cellOf(row);
      const key = asRecord(row)?.['key'];
      return cell === undefined || typeof key !== 'string' ? [] : [{ ...cell, key }];
    });
  }

  private upsertMark(batch: SpendBatch): void {
    const { run } = batch;
    this.rows.upsertMark.run(
      batch.path,
      batch.subscription,
      batch.sessionId,
      batch.projectKey,
      batch.cursor.offset,
      batch.cursor.identity,
      run.startedAt ?? null,
      run.costUsd,
      run.linesAdded,
      run.linesRemoved,
      run.tokensIn,
      run.tokensOut,
      batch.at,
    );
  }
}

function runOf(fields: Readonly<Record<string, unknown>>): SpendRun {
  const startedAt = fields['run_started_at'];
  return {
    startedAt: typeof startedAt === 'number' ? startedAt : undefined,
    costUsd: numberAt(fields, 'run_cost_usd'),
    linesAdded: numberAt(fields, 'run_lines_added'),
    linesRemoved: numberAt(fields, 'run_lines_removed'),
    tokensIn: numberAt(fields, 'run_tokens_in'),
    tokensOut: numberAt(fields, 'run_tokens_out'),
  };
}

/**
 * One grouped row, without its key.
 *
 * A subscription this build does not know drops the row rather than being filed under one it
 * does — the table is only ever written by this build, so that is a database from another one.
 */
function cellOf(row: unknown): Omit<SpendCell<never>, 'key'> | undefined {
  const fields = asRecord(row);
  if (fields === undefined) return undefined;
  const subscription: SubscriptionId | undefined = SUBSCRIPTION_IDS.find(
    (id) => id === fields['subscription'],
  );
  if (subscription === undefined) return undefined;
  return {
    subscription,
    sessions: numberAt(fields, 'sessions'),
    amount: {
      costUsd: numberAt(fields, 'cost_usd'),
      linesAdded: numberAt(fields, 'lines_added'),
      linesRemoved: numberAt(fields, 'lines_removed'),
      tokensIn: numberAt(fields, 'tokens_in'),
      tokensOut: numberAt(fields, 'tokens_out'),
    },
  };
}

function numberAt(fields: Readonly<Record<string, unknown>>, key: string): number {
  const value = fields[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
