// The half of the watcher that has to work is the stat poll, because it is the half that is
// allowed to be slow but not the half that is allowed to be wrong (RESEARCH.md E.5). `fs.watch`
// itself is asserted nowhere here on purpose: the port's contract is that it may drop events, so
// a test that depended on one firing would be testing a promise nothing makes.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FsDirectoryWatcher } from '../../../core/adapters/node/fs-directory-watcher.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeScheduler } from '../../fakes/fake-scheduler.ts';

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'flightdeck-watch-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

interface Rig {
  readonly watcher: FsDirectoryWatcher;
  readonly scheduler: FakeScheduler;
  readonly logger: FakeLogger;
  readonly nudges: () => number;
  readonly onChange: () => void;
}

function rig(directories: readonly string[]): Rig {
  const scheduler = new FakeScheduler();
  const logger = new FakeLogger();
  let count = 0;
  return {
    watcher: new FsDirectoryWatcher(directories, scheduler, logger),
    scheduler,
    logger,
    nudges: (): number => count,
    onChange: (): void => {
      count += 1;
    },
  };
}

describe('FsDirectoryWatcher — the stat poll', () => {
  it('nudges when a watched directory changes', () => {
    const { watcher, scheduler, nudges, onChange } = rig([root]);
    const cancel = watcher.watch(onChange);

    writeFileSync(join(root, 'state.json'), '{}');
    scheduler.tick();

    expect(nudges()).toBeGreaterThanOrEqual(1);
    cancel.cancel();
  });

  it('stays quiet when nothing has changed', () => {
    const { watcher, scheduler, nudges, onChange } = rig([root]);
    const cancel = watcher.watch(onChange);

    scheduler.tick();
    scheduler.tick();

    expect(nudges()).toBe(0);
    cancel.cancel();
  });

  it('nudges once for one poll however many directories moved', () => {
    const second = mkdtempSync(join(tmpdir(), 'flightdeck-watch2-'));
    const { watcher, scheduler, nudges, onChange } = rig([root, second]);
    const cancel = watcher.watch(onChange);

    writeFileSync(join(root, 'a.json'), '{}');
    writeFileSync(join(second, 'b.json'), '{}');
    scheduler.tick();

    expect(nudges()).toBe(1);
    cancel.cancel();
    rmSync(second, { recursive: true, force: true });
  });
});

describe('FsDirectoryWatcher — a directory that is not there', () => {
  it('does not throw: $CFG/jobs does not exist until the first background session', () => {
    const missing = join(root, 'jobs');
    const { watcher, logger, onChange } = rig([missing]);

    expect(() => {
      watcher.watch(onChange).cancel();
    }).not.toThrow();
    expect(logger.logged('watch_unavailable')).toBe(true);
  });

  it('notices it appearing, with nothing to restart', () => {
    const later = join(root, 'jobs');
    const { watcher, scheduler, nudges, onChange } = rig([later]);
    const cancel = watcher.watch(onChange);

    scheduler.tick();
    expect(nudges()).toBe(0);

    writeFileSync(later, '{}');
    scheduler.tick();

    expect(nudges()).toBe(1);
    cancel.cancel();
  });
});

describe('FsDirectoryWatcher — cancelling', () => {
  it('stops polling', () => {
    const { watcher, scheduler, nudges, onChange } = rig([root]);

    watcher.watch(onChange).cancel();
    writeFileSync(join(root, 'state.json'), '{}');
    scheduler.tick();

    expect(nudges()).toBe(0);
    expect(scheduler.repeatingCount).toBe(0);
  });
});
