// The spend ledger's half of the store — P7-T3.
//
// **A port of its own rather than four more methods on `Store`**, because nothing but the ledger
// and its report touch these tables, and because `Store` is the interface every fake in the suite
// has to implement: a test of a hook queue should not owe a spend ledger four stubs.
//
// **An observation, like everything else in there** (core/ports/store.ts): "this transcript's run
// had spent $4.10 by this instant". What is stored is what `cost-state` said and where reading
// stopped; the weekly amounts are the increments between two of those, and a query adds them up.
//
// **It outlives the transcripts it was read from, on purpose.** Claude Code deletes a transcript
// after `cleanupPeriodDays` (30), so on the first boot this can only see five weeks back; every
// week after that is kept here, which is D9's point about the store being the whole history.
import type { SubscriptionId } from '../../contracts/session.ts';
import type { SpendAmount, SpendRun, WeekAmount } from '../domain/spend-fold.ts';
import type { TranscriptCursor } from './transcript-file.ts';

/** Where the ledger got to in one transcript, and the run it was in at that byte. */
export interface SpendMark {
  readonly cursor: TranscriptCursor;
  readonly run: SpendRun;
}

/** One pass over one transcript — see `SpendStore.recordSpend`. */
export interface SpendBatch {
  /** The transcript's full path. The key, and never displayed (SEC-DATA-2). */
  readonly path: string;
  readonly subscription: SubscriptionId;
  readonly sessionId: string;
  /** The slug folder the transcript sits in — the "project" half of the phase goal. */
  readonly projectKey: string;
  /** Always a record boundary, or past a line too long to be a `cost-state` (`SpendLedger`). */
  readonly cursor: TranscriptCursor;
  readonly run: SpendRun;
  /** What each week gained from this slice. ADDED to what is held, never replacing it. */
  readonly weeks: readonly WeekAmount[];
  /** The file was replaced or shrank: forget what was read from it before adding this. */
  readonly restarted: boolean;
  readonly at: number;
}

/** One cell of a summary: a subscription's spend in one week, or in one project. */
export interface SpendCell<Key> {
  readonly key: Key;
  readonly subscription: SubscriptionId;
  /** Transcripts with a reading in the cell — counted by the query, never summed. */
  readonly sessions: number;
  readonly amount: SpendAmount;
}

export interface SpendStore {
  /** Where the ledger got to in this transcript, or `undefined` for one it has never read. */
  spendMark(path: string): SpendMark | undefined;

  /**
   * Records one slice: the weeks' increments, the run and the cursor, in ONE transaction.
   *
   * The indexer's rule for the same reason (`Store.indexTranscript`): increments written without
   * their cursor are added twice on the next pass, and a cursor written without its increments is
   * money that happened and is never counted.
   *
   * @throws if the store cannot be written. The cursor did not move, so the next pass retries.
   */
  recordSpend(batch: SpendBatch): void;

  /** Every week from `since` on, per subscription. */
  spendByWeek(since: number): readonly SpendCell<number>[];

  /** Every project's spend from `since` on, per subscription. */
  spendByProject(since: number): readonly SpendCell<string>[];
}
