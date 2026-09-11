// The fake has to be as unreliable as the real thing is allowed to be: a burst for one change,
// and nothing at all once it is let go.
import { describe, expect, it } from 'vitest';
import { FakeDirectoryWatcher } from './fake-directory-watcher.ts';

describe('FakeDirectoryWatcher', () => {
  it('is only watching while someone holds the cancellation', () => {
    const watcher = new FakeDirectoryWatcher();

    const cancel = watcher.watch(() => undefined);
    expect(watcher.watching).toBe(true);

    cancel.cancel();
    expect(watcher.watching).toBe(false);
  });

  it('fires a burst as several separate changes, the way ReadDirectoryChangesW does', () => {
    const watcher = new FakeDirectoryWatcher();
    let count = 0;
    watcher.watch(() => {
      count += 1;
    });

    watcher.burst(3);

    expect(count).toBe(3);
  });

  it('says nothing to a listener that has cancelled', () => {
    const watcher = new FakeDirectoryWatcher();
    let count = 0;
    watcher
      .watch(() => {
        count += 1;
      })
      .cancel();

    watcher.nudge();

    expect(count).toBe(0);
  });
});
