// Every `cost-state` line on the machine, folded into amounts per week — P7-T3, D5.
//
// **The indexer's shape, with its own cursors.** It walks the same catalogue P7-T1 walks and reads
// each transcript from where it got to last time in bounded 1 MB slices, so a fresh
// machine catches up over a few passes and an old one reads only what was appended. The cursors
// are its own (migration 10): the search index has been advancing its since P7-T1, past every
// `cost-state` line it did not keep, and resetting them to recover the money would have cost the
// owner a four-hour re-index.
//
// **It parses almost nothing.** 679 of the half-million lines on this machine are `cost-state`
// (RESEARCH.md G.59), so a slice is searched for the token `"cost-state"` and only the lines that
// hold it are parsed. The token as written can only appear as a JSON string in its own right — the
// same text typed into a prompt is escaped, `\"cost-state\"`, and does not match. Parsing is what
// the indexer's budget pays for; this one reads four times as many bytes a pass for less CPU.
//
// **It catches up quickly, then goes quiet.** A pass that ran out of budget with files still
// behind schedules another in fifteen seconds rather than waiting five minutes, and a pass reads a
// file to its end while the budget lasts, so the first boot reads the 1.3 GB of transcripts on this
// machine in about a dozen passes — a few minutes — instead of the fifty the interval alone would
// take. Once nothing is behind, only the interval runs, and a pass with nothing new costs ~140 ms.
//
// **A line longer than any `cost-state` is stepped over.** The indexer leaves its cursor before a
// trailing partial line so the line is read whole next time, and so does this — unless the partial
// line is already longer than `MAX_LINE_CHARS`, which a 1.3 KB `cost-state` never is. Without that,
// the 3.2 MB single line P1-T7 found would pin the cursor to its first byte forever: every slice
// would begin inside it and end inside it, and the file would never be read past it.
import { parseTranscriptRecord } from '../../contracts/transcript-record.ts';
import type { SpendCoverage } from '../../contracts/spend-summary.ts';
import type { ReadPolicy } from '../domain/read-policy.ts';
import { NO_RUN, SpendFold, type CostReading } from '../domain/spend-fold.ts';
import type { Cancellation } from '../ports/cancellation.ts';
import type { Clock } from '../ports/clock.ts';
import type { Logger } from '../ports/logger.ts';
import type { Scheduler } from '../ports/scheduler.ts';
import type { SpendMark, SpendStore } from '../ports/spend-store.ts';
import type { CatalogueEntry, TranscriptCatalogue } from '../ports/transcript-catalogue.ts';
import {
  NEW_TRANSCRIPT,
  type TranscriptFile,
  type TranscriptSlice,
} from '../ports/transcript-file.ts';

/** The indexer's interval, for its reason: a transcript grows only while a session runs. */
export const SPEND_INTERVAL_MS = 5 * 60_000;

/** How soon a pass that ran out of budget is followed by another. See the header. */
export const SPEND_CATCH_UP_MS = 15_000;

/**
 * How many slices one pass reads — at most 128 MB, since `FsTranscriptFile` caps a slice at 1 MB.
 *
 * Four times the indexer's, because a slice here costs a read and a substring search rather than a
 * `JSON.parse` per line. Measured against the real corpus: a full pass took 0.4–1.2 s of wall
 * time (up to 6 s with four test suites running beside it), every slice an `await`, so the loop is
 * never held for long.
 */
const SLICES_PER_PASS = 128;

/** The longest line worth parsing. A `cost-state` is at most 1.3 KB on this machine (G.59). */
const MAX_LINE_CHARS = 131_072;

/** How a `cost-state` line names itself, as Claude Code writes it: `"type":"cost-state"`. */
const COST_TOKEN = '"cost-state"';

export interface SpendLedgerParts {
  readonly catalogue: TranscriptCatalogue;
  readonly files: TranscriptFile;
  readonly store: SpendStore;
  readonly policy: ReadPolicy;
  readonly scheduler: Scheduler;
  readonly clock: Clock;
  readonly logger: Logger;
}

export class SpendLedger {
  private readonly parts: SpendLedgerParts;
  private timer: Cancellation | undefined;
  private catchUp: Cancellation | undefined;
  private running = false;
  private coverage: SpendCoverage = { transcripts: 0, behind: 0, passes: 0 };

  constructor(parts: SpendLedgerParts) {
    this.parts = parts;
  }

  /** Starts the interval and reads once immediately — `TranscriptIndexer.start`'s reason. */
  public start(): void {
    if (this.timer !== undefined) return;
    this.timer = this.parts.scheduler.every(SPEND_INTERVAL_MS, () => {
      void this.read();
    });
    void this.read();
  }

  /** Cancels the interval AND a pending catch-up — either would hold the loop open. */
  public stop(): void {
    this.timer?.cancel();
    this.timer = undefined;
    this.catchUp?.cancel();
    this.catchUp = undefined;
  }

  /** How much of the history the last pass had read — what the deck says while it fills. */
  public progress(): SpendCoverage {
    return this.coverage;
  }

  /**
   * One pass: walk, then read what was appended since, up to the budget.
   *
   * Never runs twice at once; a tick that arrives mid-pass is dropped, for the indexer's reason.
   *
   * @throws never. A store that cannot be written is logged and the pass ends with the cursor
   * where it was, so the next pass reads the same slice again.
   */
  public async read(): Promise<SpendCoverage> {
    if (this.running) return this.coverage;
    this.running = true;
    try {
      this.coverage = await this.pass();
    } catch (cause) {
      this.parts.logger.error('spend_failed', {
        reason: cause instanceof Error ? cause.name : 'unknown',
      });
    } finally {
      this.running = false;
    }
    this.scheduleCatchUp();
    return this.coverage;
  }

  private async pass(): Promise<SpendCoverage> {
    const entries = await this.parts.catalogue.list();
    let budget = SLICES_PER_PASS;
    let behind = 0;
    for (const entry of entries) {
      if (budget === 0) {
        if (this.hasUnread(entry)) behind += 1;
        continue;
      }
      const read = await this.readUpTo(entry, budget);
      budget -= read.slices;
      if (read.behind) behind += 1;
    }
    return { transcripts: entries.length, behind, passes: this.coverage.passes + 1 };
  }

  /**
   * One transcript, slice after slice, until it is caught up or the budget is spent.
   *
   * Unlike the indexer, which reads one slice per file per pass: the largest transcript here is
   * 23 MB, and one slice a pass would have kept the catch-up going for twenty-three passes after
   * every other file was done (measured — G.59).
   */
  private async readUpTo(
    entry: CatalogueEntry,
    budget: number,
  ): Promise<{ readonly slices: number; readonly behind: boolean }> {
    let slices = 0;
    while (slices < budget) {
      const read = await this.readOne(entry);
      if (read === undefined) return { slices, behind: false };
      slices += 1;
      if (!read.behind) return { slices, behind: false };
    }
    return { slices, behind: true };
  }

  /** Whether a transcript the budget never reached has bytes past its cursor. Opens nothing. */
  private hasUnread(entry: CatalogueEntry): boolean {
    if (!this.parts.policy.allows(entry.path)) return false;
    const mark = this.parts.store.spendMark(entry.path);
    return mark === undefined || entry.bytes > mark.cursor.offset;
  }

  /** Only while the interval is running: a stopped ledger schedules nothing (core/shutdown.ts). */
  private scheduleCatchUp(): void {
    if (this.timer === undefined || this.catchUp !== undefined) return;
    if (this.coverage.behind === 0) return;
    this.catchUp = this.parts.scheduler.after(SPEND_CATCH_UP_MS, () => {
      this.catchUp = undefined;
      void this.read();
    });
  }

  /** One transcript, one slice. `undefined` when there was nothing to do — almost always. */
  private async readOne(entry: CatalogueEntry): Promise<{ readonly behind: boolean } | undefined> {
    // SEC-FS-2, as every reader of a transcript is screened. See `TranscriptIndexer.indexOne`.
    if (!this.parts.policy.allows(entry.path)) {
      this.parts.logger.warn('spend_path_refused', { subscription: entry.subscription });
      return undefined;
    }
    const mark = this.parts.store.spendMark(entry.path);
    const cursor = mark?.cursor ?? NEW_TRANSCRIPT;
    if (cursor.identity !== '' && entry.bytes <= cursor.offset) return undefined;

    const slice = await this.parts.files.read(entry.path, cursor);
    if (slice.unreadable || slice.text === '') return undefined;
    const reached = this.record(entry, slice, mark);
    // Behind only if there is more AND this slice moved the cursor: a slice that ended inside its
    // only line would hand back the same bytes if it were asked again straight away.
    return { behind: entry.bytes > slice.to && (slice.restarted || reached > cursor.offset) };
  }

  /**
   * One slice's readings folded onto the run it continues, and stored with the new cursor.
   *
   * @returns the offset the cursor now stands at.
   */
  private record(
    entry: CatalogueEntry,
    slice: TranscriptSlice,
    mark: SpendMark | undefined,
  ): number {
    const { readings, fragment } = costLinesIn(slice.text);
    // A replaced file is a new transcript at the old path: its runs start from nothing, and the
    // store forgets what the old one contributed before adding this.
    const fold = new SpendFold(slice.restarted || mark === undefined ? NO_RUN : mark.run);
    const now = this.parts.clock.now().getTime();
    for (const reading of readings) fold.add(reading, now);
    const offset = slice.to - unreadTail(fragment);
    this.parts.store.recordSpend({
      path: entry.path,
      subscription: entry.subscription,
      sessionId: entry.sessionId,
      projectKey: entry.projectKey,
      cursor: { offset, identity: slice.identity },
      run: fold.run,
      weeks: fold.increments(),
      restarted: slice.restarted,
      at: now,
    });
    return offset;
  }
}

/**
 * The `cost-state` readings in a slice, and the trailing text that is not a whole line yet.
 *
 * Found by searching for the token rather than by splitting a megabyte into lines: only the lines
 * that contain it are cut out and parsed, and one that is past `MAX_LINE_CHARS` is not parsed at
 * all — it is a pasted file that happens to quote the word, not a total.
 */
function costLinesIn(text: string): {
  readonly readings: readonly CostReading[];
  readonly fragment: string;
} {
  const lastBreak = text.lastIndexOf('\n');
  const readings: CostReading[] = [];
  let from = 0;
  for (;;) {
    const hit = text.indexOf(COST_TOKEN, from);
    if (hit === -1 || hit > lastBreak) break;
    const start = text.lastIndexOf('\n', hit) + 1;
    const end = text.indexOf('\n', hit);
    const reading = end - start <= MAX_LINE_CHARS ? costIn(text.slice(start, end)) : undefined;
    if (reading !== undefined) readings.push(reading);
    from = end + 1;
  }
  return { readings, fragment: text.slice(lastBreak + 1) };
}

/** One line's reading, or `undefined` for a line that is not a `cost-state` after all. */
function costIn(line: string): CostReading | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    // The first line of a slice that began inside a line too long to keep (see the header).
    return undefined;
  }
  const record = parseTranscriptRecord(value);
  return record?.kind === 'cost' ? record : undefined;
}

/**
 * How many bytes at the end of the slice the cursor leaves unread: the trailing partial line —
 * unless it is already too long to be a `cost-state`, in which case the cursor steps past it.
 *
 * `TextEncoder` rather than `Buffer`, for the indexer's reason, and never over more than one line.
 */
function unreadTail(fragment: string): number {
  if (fragment.length > MAX_LINE_CHARS) return 0;
  return new TextEncoder().encode(fragment).length;
}
