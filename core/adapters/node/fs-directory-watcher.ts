// The real DirectoryWatcher — `fs.watch` for speed, a stat poll for honesty.
//
// **Both, because neither is enough.** `fs.watch` is `ReadDirectoryChangesW` on Windows: it is
// instant and it drops events under bursty writes (RESEARCH.md E.5, libuv#626). A 2 s `fs.stat` of
// each directory's mtime catches what the watcher missed, at the cost of being up to two seconds
// late. DECISIONS.md D3 feed 5 calls the poll "the truth" for exactly this reason — though the
// real truth is still the sweep, and both halves here only ever nudge.
//
// **A missing directory is ordinary, not an error.** `$CFG/jobs` does not exist until the first
// background session runs, and `fs.watch` on a missing path throws ENOENT. So each directory is
// attempted, failures are logged once at info, and the poll keeps trying — a subscription that
// grows a `jobs/` folder an hour in starts being watched an hour in, with nothing to restart.
import { statSync, watch, type FSWatcher } from 'node:fs';
import type { Cancellation } from '../../ports/cancellation.ts';
import type { DirectoryWatcher } from '../../ports/directory-watcher.ts';
import type { Logger } from '../../ports/logger.ts';
import type { Scheduler } from '../../ports/scheduler.ts';

/** SPEC §4.2 feed 5. Fast enough to feel immediate, slow enough to cost nothing on four dirs. */
const STAT_POLL_MS = 2000;

export class FsDirectoryWatcher implements DirectoryWatcher {
  private readonly directories: readonly string[];
  private readonly scheduler: Scheduler;
  private readonly logger: Logger;

  constructor(directories: readonly string[], scheduler: Scheduler, logger: Logger) {
    this.directories = directories;
    this.scheduler = scheduler;
    this.logger = logger;
  }

  public watch(onChange: () => void): Cancellation {
    const watchers = this.directories
      .map((directory) => this.tryWatch(directory, onChange))
      .filter((watcher): watcher is FSWatcher => watcher !== undefined);

    const seen = new Map<string, number>(
      this.directories.map((path) => [path, this.mtimeOf(path)]),
    );
    const poll = this.scheduler.every(STAT_POLL_MS, () => {
      if (this.pollChanged(seen)) onChange();
    });

    return {
      cancel: (): void => {
        poll.cancel();
        for (const watcher of watchers) watcher.close();
      },
    };
  }

  /** True when any watched directory's mtime moved since the last poll. */
  private pollChanged(seen: Map<string, number>): boolean {
    let changed = false;
    for (const directory of this.directories) {
      const mtime = this.mtimeOf(directory);
      if (seen.get(directory) === mtime) continue;
      seen.set(directory, mtime);
      changed = true;
    }
    return changed;
  }

  /** `0` for a directory that is not there — absence is a state, and it compares like any other. */
  private mtimeOf(directory: string): number {
    try {
      return statSync(directory).mtimeMs;
    } catch {
      return 0;
    }
  }

  private tryWatch(directory: string, onChange: () => void): FSWatcher | undefined {
    try {
      const watcher = watch(directory, { persistent: false }, () => {
        onChange();
      });
      // An ENOENT arriving later (the directory is removed while watched) must not reach the
      // process as an uncaught 'error' event and take core down over a folder.
      watcher.on('error', () => {
        this.logger.info('watch_dropped', { directory });
      });
      return watcher;
    } catch {
      // The poll still covers it, so this is information rather than a problem.
      this.logger.info('watch_unavailable', { directory });
      return undefined;
    }
  }
}
