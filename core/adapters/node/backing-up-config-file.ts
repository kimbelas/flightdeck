// SEC-FS-3, in the order the control states it: back up → write temp → atomic rename.
//
// The order is the entire control and each step earns its place.
//
// **Back up first, and fail the whole write if it fails.** A backup taken afterwards protects
// nothing; a backup that silently did not happen protects less than none, because the operator
// believes it did. `*.bak-<timestamp>` per SEC-FS-3, and a second Connect on the same day does not
// overwrite the first one's backup — the timestamp carries seconds.
//
// **Temp file in the same directory, then rename.** `rename` within one volume is atomic on
// Windows as on POSIX; writing in place is not, and a crash halfway through leaves the owner with
// half a settings.json and both Claude Code subscriptions refusing to start. Same directory
// because a rename across volumes is a copy, which is not atomic and defeats the point.
import { copyFileSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { ConfigFile } from '../../ports/config-file.ts';

export class BackingUpConfigFile implements ConfigFile {
  private readonly now: () => Date;

  /** The clock is injected so a test can assert the exact backup name it will produce. */
  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  public read(path: string): string | undefined {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return undefined;
    }
  }

  /**
   * @throws if the backup or the temp write fails. The original is untouched in both cases.
   */
  public replace(path: string, contents: string): string {
    const backup = `${path}.bak-${stamp(this.now())}`;
    copyFileSync(path, backup);

    const temp = join(dirname(path), `.${basename(path)}.flightdeck-tmp`);
    try {
      // No `encoding: utf8` surprises: the caller hands over the exact bytes it showed in the
      // diff, newlines included, and this writes them.
      writeFileSync(temp, contents, 'utf8');
      renameSync(temp, path);
    } catch (cause) {
      rmSync(temp, { force: true });
      throw cause;
    }
    return backup;
  }
}

/** `20260912-191122` — sortable, and unique per second so two Connects cannot collide. */
function stamp(at: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const date = `${String(at.getFullYear())}${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
  return `${date}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
}
