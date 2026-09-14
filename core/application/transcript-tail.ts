// One transcript, read forward from a byte offset — P1-T7, SPEC §4.2 feed 4.
//
// No IO and no async: this takes the bytes a `TranscriptFile` produced and turns them into records,
// which is what makes "a 3 MB record arrives in four slices" a three-line test instead of a fixture
// of a half-written file.
//
// **The cap is measured, not guessed.** A survey of 315 transcripts (P1-T7, RESEARCH.md §G.15)
// found a single line of 3,230,728 bytes, and lines over 64 KB are 0.46 % of the corpus and are
// `user` and `attachment` records — the two types this build never reads. The largest line it does
// read is an `assistant` at 66,481 bytes. So the cap sits above every record the parser wants and
// below the ones it does not, and a transcript cannot make core hold a multi-megabyte string.
//
// **An oversize line is dropped, not truncated.** Handing half a line to `JSON.parse` would be an
// unparseable record counted as a schema change, which is a lie about a feed whose whole job is to
// notice schema changes. The scanner drops to the next newline and says how many it dropped.
import {
  readTranscriptLine,
  type TranscriptLine,
  type TranscriptRecord,
} from '../../contracts/transcript-record.ts';
import {
  NEW_TRANSCRIPT,
  type TranscriptCursor,
  type TranscriptSlice,
} from '../ports/transcript-file.ts';

/**
 * The longest line this will assemble, in characters.
 *
 * Chosen from the byte measurement above with room to spare — a transcript is overwhelmingly ASCII,
 * where the two units agree, and the gap between 66 KB (the largest record read) and 128 K (this)
 * is wide enough that the difference cannot matter.
 */
export const MAX_LINE_CHARS = 131_072;

export interface TailBatch {
  /** Everything this build could name, in file order. */
  readonly records: readonly TranscriptRecord[];
  /** Where to resume. Carry it into the next `TranscriptFile.read`. */
  readonly cursor: TranscriptCursor;
  /** The file was replaced or shrank, so anything derived from earlier reads is stale. */
  readonly restarted: boolean;
  /** Lines of a type this build knows and does not read — `user`, `attachment`, `mode`. Normal. */
  readonly ignored: number;
  /**
   * Lines of a type this build has NEVER seen.
   *
   * The one number here worth an alert: 95 % of a transcript is deliberately unread, so a count of
   * "produced no record" says nothing, and a count of "produced no record and I have never heard
   * of this shape" is the first sign a Claude Code update moved the format (SPEC §8 R2).
   */
  readonly unknown: number;
  /** Lines dropped for exceeding `MAX_LINE_CHARS`. Expected to be `user` and `attachment` records. */
  readonly oversize: number;
}

export class TranscriptTail {
  private cursor: TranscriptCursor = NEW_TRANSCRIPT;
  private partial = '';
  /** True while discarding the remains of an oversize line, up to and including its newline. */
  private resyncing = false;
  private ignoredCount = 0;
  private unknownCount = 0;
  private oversizeCount = 0;
  private restartCount = 0;

  /** Where the next read starts. The caller stores it; nothing here touches a file. */
  public get at(): TranscriptCursor {
    return this.cursor;
  }

  /** Lines of a known type this build does not read, for the life of this tail. Expected to be most of them. */
  public get ignored(): number {
    return this.ignoredCount;
  }

  /** Lines of a type never observed. `flightdeck-core status` and `doctor` read it (P1-T12). */
  public get unknown(): number {
    return this.unknownCount;
  }

  /** How many lines were dropped for length. */
  public get oversize(): number {
    return this.oversizeCount;
  }

  /** How many times the file underneath was replaced or shrank. */
  public get restarts(): number {
    return this.restartCount;
  }

  /**
   * Takes one slice and returns the records in it.
   *
   * An `unreadable` slice is a no-op that keeps the cursor — feed 4 is best-effort, and a transcript
   * that is briefly missing must not cost the offset that makes the next read cheap.
   *
   * @throws never.
   */
  public absorb(slice: TranscriptSlice): TailBatch {
    if (slice.unreadable) return this.batch([], false);
    if (slice.restarted) this.restart();
    this.cursor = { offset: slice.to, identity: slice.identity };
    const records = this.scan(slice.text);
    return this.batch(records, slice.restarted);
  }

  /**
   * Forgets the file without forgetting the counters.
   *
   * The counters are about this tail's whole life, not about the current file: "27 lines this build
   * could not name" is the number that says a Claude Code update moved the format, and resetting it
   * on every resume would hide exactly that.
   */
  private restart(): void {
    this.restartCount += 1;
    this.partial = '';
    this.resyncing = false;
  }

  /**
   * Splits `text` into lines, carrying the last unterminated one over to the next slice.
   *
   * The newline is the record separator and a transcript at rest always ends with one (measured on
   * all 315 files), so a slice ending mid-line means the writer is mid-flush — the common case this
   * whole class exists for, not an anomaly.
   */
  private scan(text: string): readonly TranscriptRecord[] {
    const records: TranscriptRecord[] = [];
    let from = 0;
    for (;;) {
      const end = text.indexOf('\n', from);
      if (end === -1) break;
      this.take(text.slice(from, end), records);
      from = end + 1;
    }
    this.carry(text.slice(from));
    return records;
  }

  /** One complete line. */
  private take(line: string, into: TranscriptRecord[]): void {
    if (this.resyncing) {
      // This is the tail of the oversize line, already counted. The next line is a real one.
      this.resyncing = false;
      return;
    }
    const whole = this.partial + line;
    this.partial = '';
    if (whole.length > MAX_LINE_CHARS) {
      this.oversizeCount += 1;
      return;
    }
    if (whole.trim() === '') return;
    const read = this.read(whole);
    if (!read.known) this.unknownCount += 1;
    if (read.record === undefined) {
      if (read.known) this.ignoredCount += 1;
      return;
    }
    into.push(read.record);
  }

  /**
   * The unterminated remainder.
   *
   * Length is checked HERE as well as in `take`, and that is the point of the cap rather than a
   * duplicate of it: a 3 MB line arrives as a partial that grows across several slices and is never
   * terminated in any of them, so a check that only ran on complete lines would hold the whole
   * thing in memory first and enforce the limit afterwards.
   */
  private carry(remainder: string): void {
    if (this.resyncing) return;
    const grown = this.partial + remainder;
    if (grown.length > MAX_LINE_CHARS) {
      this.oversizeCount += 1;
      this.partial = '';
      this.resyncing = true;
      return;
    }
    this.partial = grown;
  }

  /**
   * A line that is not JSON counts as unknown, not as ignored.
   *
   * It is the same evidence: a transcript is JSONL, so a line that will not parse is either a
   * format change or a half-written file — and the partial-line buffer above is what rules the
   * second one out before this is ever reached.
   */
  private read(line: string): TranscriptLine {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return { record: undefined, known: false };
    }
    return readTranscriptLine(value);
  }

  private batch(records: readonly TranscriptRecord[], restarted: boolean): TailBatch {
    return {
      records,
      cursor: this.cursor,
      restarted,
      ignored: this.ignoredCount,
      unknown: this.unknownCount,
      oversize: this.oversizeCount,
    };
  }
}
