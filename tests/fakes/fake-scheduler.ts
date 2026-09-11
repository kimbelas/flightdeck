// In-memory Scheduler — CODING-STANDARDS §10.1.
//
// Time moves when the test says so. `tick()` fires the repeating tasks once; `advance(ms)` fires
// the delayed ones that have come due. Nothing here is real, which is the point: the reconciler's
// interval is ten seconds and its debounce is a fifth of one, and a test suite that waited for
// either would be a test suite nobody runs.
import type { Cancellation } from '../../core/ports/cancellation.ts';
import type { Scheduler } from '../../core/ports/scheduler.ts';

interface Repeating {
  readonly ms: number;
  readonly task: () => void;
}

interface Delayed {
  readonly task: () => void;
  dueIn: number;
}

export class FakeScheduler implements Scheduler {
  private readonly repeating = new Set<Repeating>();
  private readonly delayed = new Set<Delayed>();

  /** How many repeating tasks are live — a cancelled timer must not still be here. */
  public get repeatingCount(): number {
    return this.repeating.size;
  }

  public get pendingCount(): number {
    return this.delayed.size;
  }

  /** Fires every repeating task once, in registration order. */
  public tick(): void {
    for (const entry of [...this.repeating]) entry.task();
  }

  /** Moves time forward, firing each delayed task that comes due. Repeating tasks are unaffected. */
  public advance(ms: number): void {
    for (const entry of [...this.delayed]) {
      entry.dueIn -= ms;
      if (entry.dueIn > 0) continue;
      this.delayed.delete(entry);
      entry.task();
    }
  }

  public every(ms: number, task: () => void): Cancellation {
    const entry: Repeating = { ms, task };
    this.repeating.add(entry);
    return {
      cancel: (): void => {
        this.repeating.delete(entry);
      },
    };
  }

  public after(ms: number, task: () => void): Cancellation {
    const entry: Delayed = { task, dueIn: ms };
    this.delayed.add(entry);
    return {
      cancel: (): void => {
        this.delayed.delete(entry);
      },
    };
  }
}
