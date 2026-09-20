// Reading a transcript from a byte offset — P1-T7, SEC-FS-1, SEC-FS-2.
//
// **A slice never ends inside a UTF-8 sequence.** A transcript is appended to while this reads it,
// so a read that stops at EOF stops wherever the writer happened to be — including between the two
// bytes of a `’`. Decoding that yields U+FFFD, which is a silent one-character corruption in the
// middle of an away summary and, worse, a byte offset that has consumed half a character. So the
// read hands back only the longest prefix that is complete UTF-8 and leaves the rest for next time:
// the offset never advances past a character, and `TranscriptTail` never sees a broken one.
//
// **Identity is `dev:ino:birthtime`.** NTFS gives Node a real file index and a real creation time
// (measured, P1-T7), so a transcript replaced at the same path by `--resume` is detectable even
// when it is the same length — which a size comparison alone cannot see.
import { open, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import type {
  TranscriptCursor,
  TranscriptEnd,
  TranscriptFile,
  TranscriptSlice,
} from '../../ports/transcript-file.ts';

/**
 * The most bytes one read will take.
 *
 * A first read of a 50 MB transcript would otherwise allocate 50 MB and hand the tail a string to
 * match. The remainder is not lost — the offset advances and the next poll continues — so a big
 * backlog is caught up over a few polls instead of in one allocation.
 */
const MAX_SLICE_BYTES = 1_048_576;

/** What `read` decided before it opened anything, so `slice` takes one parameter and not five. */
interface ReadPlan {
  readonly from: number;
  readonly length: number;
  readonly identity: string;
  readonly restarted: boolean;
}

/** A slice that changed nothing. The cursor survives, so a transient failure costs no progress. */
function nothing(cursor: TranscriptCursor): TranscriptSlice {
  return {
    text: '',
    from: cursor.offset,
    to: cursor.offset,
    identity: cursor.identity,
    restarted: false,
    unreadable: true,
  };
}

export class FsTranscriptFile implements TranscriptFile {
  /** @throws never — every failure is an `unreadable` slice (SPEC §4.2: feed 4 is best-effort). */
  public async read(path: string, cursor: TranscriptCursor): Promise<TranscriptSlice> {
    let info: Stats;
    try {
      info = await stat(path);
    } catch {
      return nothing(cursor);
    }
    const identity = identityOf(info);
    // Shorter than what has been read, or a different file at the same path. Both mean the bytes
    // behind the offset are gone and splicing onto them would parse a seam that never existed.
    const stale = identity !== cursor.identity || info.size < cursor.offset;
    const from = stale ? 0 : cursor.offset;
    // A FIRST read is not a restart. Nothing was consumed, so nothing was lost — and calling it one
    // would make every session's first poll throw away a digest it had not built yet.
    const restarted = stale && cursor.offset > 0;
    if (info.size <= from) {
      return { text: '', from, to: from, identity, restarted, unreadable: false };
    }
    return this.slice(path, {
      from,
      length: Math.min(info.size - from, MAX_SLICE_BYTES),
      identity,
      restarted,
    });
  }

  /**
   * The last `maxBytes`, from the first record boundary inside them — P5a-T4.
   *
   * The window is cut forward to the byte after the first newline, and that is the whole point of
   * the method rather than a detail: a fixed-size window from the end almost always lands in the
   * middle of a record, and handing half a JSON object to a parser is how a preview reports a
   * schema change that did not happen. A window with no newline in it yields nothing, which is the
   * honest answer — that is one record longer than the window, and there is no half of it worth
   * showing.
   *
   * `completeBytes` runs after the cut for the same reason `slice` runs it at all: the cut is by
   * byte and a transcript is UTF-8, so the far end can still be half a character.
   *
   * **The size comes from the OPEN HANDLE, not from a `stat` of the path** — `read` above is
   * allowed its stat-then-open because the `identity` it takes from that stat is precisely what
   * detects a file replaced in between, and this has no cursor and therefore no identity to
   * compare. So it opens once and measures what it opened: the size and the bytes then come from
   * the same descriptor, and a transcript rotated mid-call yields a short read rather than a
   * window into a file nobody checked (CodeQL `js/file-system-race`, caught on the PR).
   */
  public async tail(path: string, maxBytes: number): Promise<TranscriptEnd> {
    let handle: FileHandle;
    try {
      handle = await open(path, 'r');
    } catch {
      return { text: '', unreadable: true };
    }
    try {
      const { size } = await handle.stat();
      const from = Math.max(0, size - maxBytes);
      const length = size - from;
      if (length <= 0) return { text: '', unreadable: false };
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, from);
      const window = buffer.subarray(0, bytesRead);
      // A window that starts at byte 0 already starts on a boundary; anywhere else it does not.
      const start = from === 0 ? 0 : window.indexOf(0x0a) + 1;
      if (start === 0 && from > 0) return { text: '', unreadable: false };
      const whole = completeBytes(window.subarray(start));
      return { text: window.toString('utf8', start, start + whole), unreadable: false };
    } catch {
      return { text: '', unreadable: true };
    } finally {
      await handle.close();
    }
  }

  private async slice(path: string, plan: ReadPlan): Promise<TranscriptSlice> {
    const { from, length, identity, restarted } = plan;
    const buffer = Buffer.alloc(length);
    let read: number;
    try {
      const handle = await open(path, 'r');
      try {
        ({ bytesRead: read } = await handle.read(buffer, 0, length, from));
      } finally {
        await handle.close();
      }
    } catch {
      return nothing({ offset: from, identity });
    }
    const whole = completeBytes(buffer.subarray(0, read));
    return {
      text: buffer.toString('utf8', 0, whole),
      from,
      to: from + whole,
      identity,
      restarted,
      unreadable: false,
    };
  }
}

/** `dev:ino:birthtime` — see the header. `birthtimeMs` is fractional on NTFS, hence the rounding. */
function identityOf(info: Stats): string {
  return `${String(info.dev)}:${String(info.ino)}:${String(Math.round(info.birthtimeMs))}`;
}

/**
 * How many of `bytes` form complete UTF-8 sequences.
 *
 * Only the last three bytes can be an incomplete sequence, because that is the longest tail a
 * 4-byte character can leave. Walking back from the end to the first lead byte and asking whether
 * its sequence fits is therefore a constant-time check, not a scan of the slice.
 */
function completeBytes(bytes: Buffer): number {
  const limit = Math.min(3, bytes.length);
  for (let back = 1; back <= limit; back += 1) {
    const index = bytes.length - back;
    const byte = bytes[index];
    if (byte === undefined || byte < 0x80) return bytes.length;
    // A continuation byte (10xxxxxx) is not a lead; keep walking back for the one that starts it.
    if (byte < 0xc0) continue;
    const needed = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : 2;
    return needed <= back ? bytes.length : index;
  }
  return bytes.length;
}
