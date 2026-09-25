// The FTS5 index over both subscriptions' transcripts — P7-T1, SPEC §5.8, SEC-DATA-1.
//
// **Incremental by byte offset, and the offset survives a restart.** One cursor per transcript in
// the store (migration 7); a pass reads from it to EOF, indexes the prose, and writes the excerpts
// and the new cursor in one transaction. Reading and parsing all 1.76 GB on this machine is about
// thirty-six seconds of work (RESEARCH.md G.56); every pass after the backfill is the bytes
// appended since, which is usually none.
//
// **The cursor is only ever advanced past a NEWLINE.** `TranscriptFile.read` hands back whatever
// was there, which for a file being appended to ends mid-record; persisting that offset would make
// a core that stopped between two writes resume inside a line and turn one record into an
// unparseable fragment on every restart. So the trailing partial line is dropped and the cursor
// stops at the last newline — the same bytes are read again next pass, which costs nothing.
//
// **A budget per tick, not a loop to completion.** `FsTranscriptFile` caps a read at 1 MB, so a
// 50 MB transcript takes fifty reads; doing them all in one tick would hold the event loop for
// seconds at boot, which is when the deck is connecting. The budget bounds the work and the cursor
// makes the progress durable, so "catch up over the next ticks" needs no state of its own. The
// price is a slow cold start: at 32 MB a tick the first backfill here is at least fifty-five ticks,
// about four and a half hours (G.56) — once per machine, since the cursors survive a restart.
//
// **It is not a feed** (D3). It owns no liveness, raises no alert and nudges no sweep — it reads
// files nobody has posted about, which is the opposite of what a feed does, and it publishes
// nothing. The deck learns about it by searching.
//
// **What goes in is `contracts/transcript-prose.ts`'s decision, not this class's.** 1.4 % of a
// transcript's bytes are prose; the other 98.6 % is tool results and pasted files, which are not
// indexed because they are not read (SEC-DATA-1's sensitivity, and `transcript-record.ts`'s own
// "what is never read cannot leak").
import { NOT_YET_INDEXED, type IndexProgress } from '../../contracts/search-reply.ts';
import { readTranscriptProse, type TranscriptProse } from '../../contracts/transcript-prose.ts';
import { readToolNames } from '../../contracts/transcript-tools.ts';
import type { ReadPolicy } from '../domain/read-policy.ts';
import type { Cancellation } from '../ports/cancellation.ts';
import type { Clock } from '../ports/clock.ts';
import type { Logger } from '../ports/logger.ts';
import type { Scheduler } from '../ports/scheduler.ts';
import type { Store } from '../ports/store.ts';
import type { CatalogueEntry, TranscriptCatalogue } from '../ports/transcript-catalogue.ts';
import { NEW_TRANSCRIPT, type TranscriptFile } from '../ports/transcript-file.ts';

/**
 * How often the walk runs.
 *
 * Five minutes. A transcript only grows while a session is running, and a session that is running
 * is one the deck already shows — search is about going back to work that finished, so being five
 * minutes behind on the newest line costs nothing anybody would notice. A shorter interval would
 * buy a fresher index and spend a directory walk of 1 041 files on it (G.56).
 */
export const INDEX_INTERVAL_MS = 5 * 60_000;

/**
 * How many slices one tick reads.
 *
 * Each is at most 1 MB (`FsTranscriptFile`), so a tick reads at most 32 MB — about 650 ms of work at
 * the read-and-parse rate measured in G.56 (1.76 GB in 36 s). The cost is the cold start: 1.76 GB at
 * 32 MB every five minutes is at least fifty-five ticks, about four and a half hours.
 */
const SLICES_PER_TICK = 32;

/** The longest line this will parse, matching `TranscriptTail`'s measured cap (P1-T7, G.15). */
const MAX_LINE_CHARS = 131_072;

export interface TranscriptIndexerParts {
  readonly catalogue: TranscriptCatalogue;
  readonly files: TranscriptFile;
  readonly store: Store;
  readonly policy: ReadPolicy;
  readonly scheduler: Scheduler;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** What one tick did. Returned so a test can assert progress without reading the store. */
export interface IndexPass {
  readonly filesRead: number;
  readonly excerpts: number;
  /** Files with bytes still to read when the budget ran out — the next tick continues them. */
  readonly behind: number;
}

export class TranscriptIndexer {
  private readonly parts: TranscriptIndexerParts;
  private timer: Cancellation | undefined;
  private running = false;
  private latest: IndexProgress = NOT_YET_INDEXED;

  constructor(parts: TranscriptIndexerParts) {
    this.parts = parts;
  }

  /**
   * How far the index has got, as of the last pass that finished — P7-T2.
   *
   * What `GET /search` carries beside its hits, so the deck can say the index is still filling
   * rather than let a missing hit read as "never happened" (RESEARCH.md G.56). `NOT_YET_INDEXED`
   * until the boot pass has finished, which is a different state from "caught up".
   */
  public progress(): IndexProgress {
    return this.latest;
  }

  /**
   * Starts the timer and indexes once immediately.
   *
   * The immediate pass is what makes a fresh install searchable without waiting five minutes, and
   * it is the same argument `Reconciler.start` makes for its own. Idempotent.
   */
  public start(): void {
    if (this.timer !== undefined) return;
    this.timer = this.parts.scheduler.every(INDEX_INTERVAL_MS, () => {
      void this.index();
    });
    void this.index();
  }

  public stop(): void {
    this.timer?.cancel();
    this.timer = undefined;
  }

  /**
   * One pass: walk, then read what has been appended since last time, up to the budget.
   *
   * Never runs twice at once. A tick that arrives while one is in flight is dropped rather than
   * queued — unlike a sweep, there is nothing to be stale about: the next tick five minutes later
   * reads exactly the same bytes.
   *
   * @throws never. A store that cannot be written is logged and the pass ends; the cursor is
   * unchanged, so the next pass re-reads the same slice.
   */
  public async index(): Promise<IndexPass> {
    if (this.running) return { filesRead: 0, excerpts: 0, behind: 0 };
    this.running = true;
    try {
      return await this.pass();
    } catch (cause) {
      this.parts.logger.error('index_failed', {
        reason: cause instanceof Error ? cause.name : 'unknown',
      });
      return { filesRead: 0, excerpts: 0, behind: 0 };
    } finally {
      this.running = false;
    }
  }

  private async pass(): Promise<IndexPass> {
    const entries = await this.parts.catalogue.list();
    let filesRead = 0;
    let excerpts = 0;
    let behind = 0;
    for (const entry of entries) {
      if (filesRead >= SLICES_PER_TICK) {
        behind += 1;
        continue;
      }
      const read = await this.indexOne(entry);
      if (read === undefined) continue;
      filesRead += 1;
      excerpts += read.excerpts;
      if (read.behind) behind += 1;
    }
    this.latest = this.measured(entries);
    return { filesRead, excerpts, behind };
  }

  /**
   * The progress report, read off the cursors AFTER the pass rather than tallied during it.
   *
   * Tallying would have to account for the file skipped because nothing was appended, the one
   * refused by the policy and the one cut off by the budget, each differently. The cursors already
   * say how far every file has got; a point lookup per transcript is about a thousand primary-key
   * reads every five minutes. A refused path is not part of the corpus and is not counted.
   */
  private measured(entries: readonly CatalogueEntry[]): IndexProgress {
    let bytesTotal = 0;
    let bytesIndexed = 0;
    let behind = 0;
    let transcripts = 0;
    for (const entry of entries) {
      if (!this.parts.policy.allows(entry.path)) continue;
      const offset = this.parts.store.transcriptCursor(entry.path)?.offset ?? 0;
      transcripts += 1;
      bytesTotal += entry.bytes;
      bytesIndexed += Math.min(offset, entry.bytes);
      if (entry.bytes > offset) behind += 1;
    }
    const passedAt = this.parts.clock.now().getTime();
    return { passedAt, transcripts, behind, bytesTotal, bytesIndexed };
  }

  /**
   * One transcript, one slice.
   *
   * `undefined` when there was nothing to do — which is the answer for almost every file on almost
   * every pass, and is why the walk is cheap: a transcript nobody has written to since the last
   * cursor is skipped without being opened.
   */
  private async indexOne(
    entry: CatalogueEntry,
  ): Promise<{ readonly excerpts: number; readonly behind: boolean } | undefined> {
    // The same screen every reader of a transcript passes (SEC-FS-2). The path came from core's
    // own walk of a directory core chose, so this can only fail for something that is not a
    // transcript — which is exactly the case worth refusing rather than assuming away.
    if (!this.parts.policy.allows(entry.path)) {
      this.parts.logger.warn('index_path_refused', { subscription: entry.subscription });
      return undefined;
    }
    const known = this.parts.store.transcriptCursor(entry.path);
    const cursor = known ?? NEW_TRANSCRIPT;
    // Nothing appended, and the file is the one the cursor belongs to. A `read` here would cost an
    // open and a stat per transcript per tick to learn the same thing the walk already reported.
    if (cursor.identity !== '' && entry.bytes <= cursor.offset) return undefined;

    const slice = await this.parts.files.read(entry.path, cursor);
    if (slice.unreadable || slice.text === '') return undefined;

    const { excerpts, tools, fragment } = readProse(slice.text);
    this.parts.store.indexTranscript({
      path: entry.path,
      subscription: entry.subscription,
      sessionId: entry.sessionId,
      projectKey: entry.projectKey,
      // Only past the last newline — see the header. Derived from the slice's own span rather
      // than from the text's length, so a multi-byte character inside it cannot shift the offset.
      cursor: { offset: slice.to - byteLengthOf(fragment), identity: slice.identity },
      at: this.parts.clock.now().getTime(),
      // A file with NO cursor is read as a restart too (P7-T2): whatever the store holds for its
      // session was not read through a cursor that still exists, and is replaced rather than
      // appended to. On a genuinely new transcript that deletes nothing. After migration 9 dropped
      // every cursor, it is what stops the re-read from indexing each excerpt a second time.
      restarted: slice.restarted || known === undefined,
      excerpts,
      tools,
    });
    return { excerpts: excerpts.length, behind: entry.bytes > slice.to };
  }
}

/**
 * The prose in a slice, and the trailing fragment that is not a whole record yet.
 *
 * A slice ends wherever the writer happened to be, so its last line is usually half a record. It
 * is dropped rather than parsed, and handed back so the caller can work out how far the cursor may
 * advance — which is the slice's own byte span minus this fragment's, never a guess.
 */
function readProse(text: string): {
  readonly excerpts: readonly TranscriptProse[];
  /** Every tool the slice's assistant turns called, each once (P7-T2). */
  readonly tools: readonly string[];
  readonly fragment: string;
} {
  const lastBreak = text.lastIndexOf('\n');
  if (lastBreak === -1) return { excerpts: [], tools: [], fragment: text };
  const excerpts: TranscriptProse[] = [];
  const tools = new Set<string>();
  for (const line of text.slice(0, lastBreak).split('\n')) {
    const value = parsed(line);
    const prose = readTranscriptProse(value);
    if (prose !== undefined) excerpts.push(prose);
    for (const tool of readToolNames(value)) tools.add(tool);
  }
  return { excerpts, tools: [...tools], fragment: text.slice(lastBreak + 1) };
}

/**
 * One line as JSON, or `undefined` — for an empty line, an oversize one, or one that is not JSON.
 *
 * Parsed once and read twice, by the prose reader and the tool reader, because the parse is the
 * expensive half of both.
 */
function parsed(line: string): unknown {
  if (line === '' || line.length > MAX_LINE_CHARS) return undefined;
  try {
    return JSON.parse(line);
  } catch {
    // Not an error and not an alarm: the drift detector is `readTranscriptLine`'s (SPEC §8 R2),
    // and a second one firing on every unparseable fragment would make the first one worthless.
    return undefined;
  }
}

/**
 * UTF-8 bytes, because the cursor is a byte offset and the slice is a string.
 *
 * `TextEncoder` rather than `Buffer` so this file stays free of `node:*`, and it is only ever run
 * over the trailing fragment — at most one line — rather than over the whole megabyte.
 */
function byteLengthOf(text: string): number {
  return new TextEncoder().encode(text).length;
}
