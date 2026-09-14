// Reading `state.json` and `timeline.jsonl` off disk — P2-T4, SEC-FS-1.
//
// Small whole reads, and the only thing worth care is which end of an oversize file to keep.
//
// **The TAIL, not the head.** `timeline.jsonl` is append-only and the daemon never truncates it, so
// a session that has been running all day has its interesting lines at the end. `FsTranscriptFile`
// caps from the FRONT for the opposite reason — it is catching up through a backlog and the next
// poll continues where this one stopped — and copying that rule here would have given a long-lived
// session a recap of what it was doing this morning.
//
// **A partial first line is left to the parser.** Reading the last N bytes almost always lands
// mid-line, and `parseTimeline` drops a line that does not parse, so the cost is one entry rather
// than a corrupt one. That is the same division `TranscriptTail` uses and the reason the port hands
// back text rather than records.
import { open, stat } from 'node:fs/promises';
import type { JobFiles } from '../../ports/job-files.ts';

export class FsJobFiles implements JobFiles {
  /** @throws never — every failure, absence included, is `undefined`. */
  public async read(path: string, maxBytes: number): Promise<string | undefined> {
    try {
      return await this.slice(path, maxBytes);
    } catch {
      // No file, no permission, a delete between the stat and the open. A background session that
      // has not written its state yet is the common one, and it is not a problem (SPEC §4.2).
      return undefined;
    }
  }

  private async slice(path: string, maxBytes: number): Promise<string | undefined> {
    const size = (await stat(path)).size;
    if (size === 0) return '';
    const from = Math.max(0, size - maxBytes);
    const handle = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(size, maxBytes));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, from);
      // `toString` on a slice that starts mid-character yields U+FFFD for that one character. Here
      // that is the right trade and not the one FsTranscriptFile makes: nothing carries a byte
      // offset forward, so a mangled first character costs one line of recap and nothing else.
      return buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
  }
}
