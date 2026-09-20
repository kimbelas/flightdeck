// Takes a pasted image, puts it somewhere a session can open, and keeps the pile small — P5a-T8.
//
// The use case, so the two decisions that are not about bytes live here rather than in an adapter:
// what the file is called, and how many are kept.
//
// **The name is core's, never the client's.** Nothing from the page reaches it — not a file name,
// not an extension, not a hint. The path this returns is about to be typed into a live session as
// text, and a name chosen across the wire is how you get a path with a quote or a newline in it
// sitting in front of a shell. A timestamp and a counter are enough to be unique and are the whole
// alphabet: digits, a dash, and an extension this project picked from the kind.
//
// **The pile is capped rather than swept on a timer.** A background sweep is a scheduler, a test
// that has to wait, and a failure mode where the last image disappears between the paste and the
// prompt. Trimming on write is none of those: it runs when there is a reason to, and it can only
// ever remove files that are older than the one just written.
import { PastedImage, type PasteRefusal } from '../domain/pasted-image.ts';
import type { PastedImageStore } from '../ports/pasted-image-store.ts';
import type { Clock } from '../ports/clock.ts';
import type { Logger } from '../ports/logger.ts';
import { err, ok, type Result } from '../shared/result.ts';

/** How many pasted images are kept. Beyond this the oldest go, oldest first. */
const KEEP = 64;

export interface PasteInboxParts {
  readonly store: PastedImageStore;
  readonly clock: Clock;
  readonly logger: Logger;
}

export class PasteInbox {
  private readonly store: PastedImageStore;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private sequence = 0;

  constructor(parts: PasteInboxParts) {
    this.store = parts.store;
    this.clock = parts.clock;
    this.logger = parts.logger;
  }

  /** Validates, writes, trims, and answers with the absolute path of the file written. */
  public async accept(kind: unknown, bytes: Uint8Array): Promise<Result<string, PasteRefusal>> {
    const image = PastedImage.from(kind, bytes);
    if (!image.ok) return err(image.error);

    const path = await this.store.put(this.nextName(image.value.extension), image.value.bytes);
    await this.trim();
    return ok(path);
  }

  /**
   * `paste-20260920-143355-123-0007.png`.
   *
   * Zero-padded throughout, because the retention cap sorts these as strings: a name that sorts
   * lexically is a name that sorts chronologically, and nothing has to stat a file to find the
   * oldest one. The counter is what separates two pastes inside the same millisecond; it resets
   * when core does, which is harmless because the timestamp in front of it has already moved.
   */
  private nextName(extension: string): string {
    const now = this.clock.now();
    this.sequence = (this.sequence + 1) % 10_000;
    const stamp = [
      String(now.getFullYear()).padStart(4, '0'),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('');
    const time = [
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('');
    const millis = String(now.getMilliseconds()).padStart(3, '0');
    const count = String(this.sequence).padStart(4, '0');
    return `paste-${stamp}-${time}-${millis}-${count}${extension}`;
  }

  /**
   * Drops everything past the newest `KEEP`.
   *
   * A failure here is logged and swallowed: the image the caller asked for is already on disk and
   * its path is already the answer, so a directory that could not be tidied is untidy rather than
   * a paste that did not happen.
   */
  private async trim(): Promise<void> {
    try {
      const names = [...(await this.store.names())].sort();
      for (const name of names.slice(0, Math.max(0, names.length - KEEP))) {
        await this.store.remove(name);
      }
    } catch (cause) {
      this.logger.warn('paste_trim_failed', { reason: String(cause) });
    }
  }
}
