// Repeating and delayed work, as a dependency — the same argument as Clock (CODING-STANDARDS §10.1).
//
// The reconciler sweeps every 10 s and debounces nudges by a fraction of a second. Against real
// timers, the test for "a nudge during a sweep runs exactly one more sweep afterwards" either
// waits ten seconds or races; against a fake it is three lines and deterministic. `node:timers`
// is also the one dependency that would otherwise keep a finished test process alive.
import type { Cancellation } from './cancellation.ts';

export interface Scheduler {
  /**
   * Runs `task` every `ms` until cancelled. The first run is one interval away, not immediate.
   *
   * `task` returning a promise is not awaited — the scheduler does not chain runs. A task that
   * must not overlap itself guards that on its own, because only the task knows what overlapping
   * would cost it.
   */
  every(ms: number, task: () => void): Cancellation;

  /** Runs `task` once, `ms` from now. Cancelling before it fires means it never runs. */
  after(ms: number, task: () => void): Cancellation;
}
