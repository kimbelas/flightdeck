// Reading the end of `daemon.log` — P7-T4, SEC-FS-1.
//
// The path is derived from a `SubscriptionId` and screened by `ReadPolicy` anyway, which is
// `FsRosterSource`'s argument unchanged: today the check can only pass, and the day somebody adds a
// path parameter it is already in place. `daemon.log` is on SEC-FS-1's allowlist by name.
//
// **Only the tail is read.** The log is appended to for as long as a machine runs background
// sessions and nothing observed rotates it — 14 KB on this machine after three weeks, but a window
// rather than a whole-file read is what keeps a per-request read cheap on a machine where it is
// 14 MB. 64 KiB is about 800 lines: weeks of supervisor starts and every recent ending.
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import type { SubscriptionId } from '../../../contracts/session.ts';
import { ReadPolicy } from '../../domain/read-policy.ts';
import type { DaemonLogSource } from '../../ports/daemon-log-source.ts';
import type { ConfigDirectories } from './fs-roster-source.ts';

export const DAEMON_LOG_TAIL_BYTES = 65_536;

export class FsDaemonLogSource implements DaemonLogSource {
  private readonly directories: ConfigDirectories;
  private readonly policy: ReadPolicy;
  private readonly maxBytes: number;

  /**
   * @param policy defaults to one built from the same directories, for `FsRosterSource`'s reason.
   * @param maxBytes the window; a test passes a small one to prove the cut lands on a line.
   */
  constructor(directories: ConfigDirectories, policy?: ReadPolicy, maxBytes?: number) {
    this.directories = directories;
    this.policy =
      policy ?? new ReadPolicy([directories.configDirFor('365'), directories.configDirFor('isg')]);
    this.maxBytes = maxBytes ?? DAEMON_LOG_TAIL_BYTES;
  }

  /** @throws never — see the port. */
  public async tail(subscription: SubscriptionId): Promise<string | undefined> {
    const path = join(this.directories.configDirFor(subscription), 'daemon.log');
    if (!this.policy.allows(path)) return undefined;
    try {
      const handle = await open(path, 'r');
      try {
        const { size } = await handle.stat();
        const length = Math.min(size, this.maxBytes);
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, size - length);
        return fromLineBoundary(buffer.toString('utf8'), length < size);
      } finally {
        await handle.close();
      }
    } catch {
      return undefined;
    }
  }
}

/**
 * A window cut from the middle of a file starts mid-line — and possibly mid-character — so the
 * first partial line is dropped. A window that is the whole file keeps everything.
 */
function fromLineBoundary(text: string, cut: boolean): string {
  if (!cut) return text;
  const newline = text.indexOf('\n');
  return newline === -1 ? '' : text.slice(newline + 1);
}
