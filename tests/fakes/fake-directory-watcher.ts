// In-memory DirectoryWatcher — CODING-STANDARDS §10.1.
//
// `nudge()` is the whole API a test needs, because the port promises so little: it may fire in
// bursts, spuriously, or not at all. `burst()` exists to prove the first case is handled, since
// a real `fs.watch` fires several times for one file write (RESEARCH.md E.5).
import type { Cancellation } from '../../core/ports/cancellation.ts';
import type { DirectoryWatcher } from '../../core/ports/directory-watcher.ts';

export class FakeDirectoryWatcher implements DirectoryWatcher {
  private readonly listeners = new Set<() => void>();

  /** Whether anything is still watching — a stopped reconciler must have let go. */
  public get watching(): boolean {
    return this.listeners.size > 0;
  }

  /** One change. */
  public nudge(): void {
    for (const listener of [...this.listeners]) listener();
  }

  /** What one real file write looks like through ReadDirectoryChangesW. */
  public burst(times = 5): void {
    for (let index = 0; index < times; index += 1) this.nudge();
  }

  public watch(onChange: () => void): Cancellation {
    this.listeners.add(onChange);
    return {
      cancel: (): void => {
        this.listeners.delete(onChange);
      },
    };
  }
}
