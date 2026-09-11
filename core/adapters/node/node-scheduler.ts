// The real Scheduler — `node:timers`, and nothing else.
//
// Deliberately not `unref`'d. Core is a long-running service and its sweep timer is part of what
// the process is for; a timer that let the loop drain would make `flightdeck-core` exit as soon as
// the HTTP server went quiet. The consequence is that shutdown must cancel it, which is why
// `Reconciler.stop()` is called from `buildCore`'s shutdown rather than left to the GC.
import { clearInterval, clearTimeout, setInterval, setTimeout } from 'node:timers';
import type { Cancellation } from '../../ports/cancellation.ts';
import type { Scheduler } from '../../ports/scheduler.ts';

export class NodeScheduler implements Scheduler {
  public every(ms: number, task: () => void): Cancellation {
    const handle = setInterval(task, ms);
    return {
      cancel: (): void => {
        clearInterval(handle);
      },
    };
  }

  public after(ms: number, task: () => void): Cancellation {
    const handle = setTimeout(task, ms);
    return {
      cancel: (): void => {
        clearTimeout(handle);
      },
    };
  }
}
