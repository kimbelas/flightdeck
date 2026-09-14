// An in-memory transcript — the fake for `TranscriptFile` (CODING-STANDARDS §10.1).
//
// It owns the byte arithmetic the real adapter owns, so a test can say "append this, now read"
// and get the same `from`/`to`/`restarted` a real file would give. The point of the fake is that
// truncation, replacement and a half-written line are three method calls rather than three
// fixtures of a file being written while it is read.
import {
  type TranscriptCursor,
  type TranscriptFile,
  type TranscriptSlice,
} from '../../core/ports/transcript-file.ts';

interface Entry {
  text: string;
  identity: string;
  readable: boolean;
}

export class FakeTranscriptFile implements TranscriptFile {
  /** How many reads have been asked for, so a test can prove a poll did not re-read from zero. */
  public reads = 0;
  /** The most bytes to hand back per read, so a test can force a record to arrive in pieces. */
  public sliceLimit = Number.MAX_SAFE_INTEGER;

  private readonly files = new Map<string, Entry>();
  private generation = 0;

  /** Appends to a file, creating it. The identity is unchanged — this is the ordinary case. */
  public append(path: string, text: string): void {
    const entry = this.files.get(path);
    if (entry === undefined) {
      this.files.set(path, { text, identity: this.nextIdentity(), readable: true });
      return;
    }
    entry.text += text;
  }

  /** Replaces the file's contents AND its identity — what `--resume` into a fresh transcript does. */
  public replace(path: string, text: string): void {
    this.files.set(path, { text, identity: this.nextIdentity(), readable: true });
  }

  /** Shortens the file without changing its identity — the other half of truncation detection. */
  public truncate(path: string, length: number): void {
    const entry = this.files.get(path);
    if (entry !== undefined) entry.text = entry.text.slice(0, length);
  }

  /** Makes reads fail — a deleted transcript, a permission error, a file being rotated. */
  public makeUnreadable(path: string): void {
    const entry = this.files.get(path);
    if (entry !== undefined) entry.readable = false;
  }

  public read(path: string, cursor: TranscriptCursor): Promise<TranscriptSlice> {
    this.reads += 1;
    const entry = this.files.get(path);
    if (entry?.readable !== true) {
      return Promise.resolve({
        text: '',
        from: cursor.offset,
        to: cursor.offset,
        identity: cursor.identity,
        restarted: false,
        unreadable: true,
      });
    }
    return Promise.resolve(this.slice(entry, cursor));
  }

  private slice(entry: Entry, cursor: TranscriptCursor): TranscriptSlice {
    const size = Buffer.byteLength(entry.text);
    // The same three lines as `FsTranscriptFile`, and they have to be: a fake that disagreed with
    // the adapter about what a first read is would make every test above prove the wrong thing.
    const stale = entry.identity !== cursor.identity || size < cursor.offset;
    const from = stale ? 0 : cursor.offset;
    const restarted = stale && cursor.offset > 0;
    const text = Buffer.from(entry.text)
      .subarray(from, Math.min(size, from + this.sliceLimit))
      .toString('utf8');
    return {
      text,
      from,
      to: from + Buffer.byteLength(text),
      identity: entry.identity,
      restarted,
      unreadable: false,
    };
  }

  private nextIdentity(): string {
    this.generation += 1;
    return `fake:${String(this.generation)}`;
  }
}
