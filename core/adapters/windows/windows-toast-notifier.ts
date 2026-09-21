// Raising a real Windows toast — P6-T3, D16, SPEC §14, SEC-PROC-1.
//
// `toasted-notifier` 10.1 is the maintained SnoreToast fork D16 picked (`node-notifier` is five
// years stale — RESEARCH.md E.4). It ships `ntfytoast.exe` in the package and reaches it through
// `execFile`, so the title and body are argv values rather than shell text.
//
// **Measured before it was depended on** (RESEARCH.md G.51), because the port's two promises are
// both about timing and neither is obvious:
//
//   - `notify` returns in **3 ms** and the toast appears on its own. The port is `void` for that
//     reason; a `Promise` would have had to resolve on something, and the only thing to resolve on
//     is the callback — which fires when the toast is DISMISSED, 3.8 s later for one that simply
//     timed out. An `await` there would put a sweep behind the owner's attention span.
//   - the spawned child does **not** hold the event loop open: a process that raised a toast and
//     did nothing else exited in 430 ms. A toast cannot keep core alive after Ctrl+C.
//
// **It refuses to run off Windows, and that is a safety check and not a portability note.** Two
// reasons, and the second is the one worth the code: there is no SnoreToast on a CI runner, and
// the library's LINUX path builds a shell string with `cp.exec` where the Windows path uses
// `execFile`. A body carries a session name, which is the owner's own text; it must never reach a
// shell. The guard means it cannot, on any machine, however the suite is run.
import { platform } from 'node:process';
import notifier from 'toasted-notifier';
import type { Logger } from '../../ports/logger.ts';
import type { Notification, Notifier } from '../../ports/notifier.ts';

/**
 * Seconds on screen before Windows files it in the Action Center.
 *
 * Six: long enough to read three words and a session name across a room, short enough that a burst
 * of finished sessions does not wall off the corner of the screen. Nothing is lost when it goes —
 * the Action Center keeps it, which is what makes a short timeout safe.
 */
const TOAST_SECONDS = 6;

export class WindowsToastNotifier implements Notifier {
  private readonly logger: Logger;
  private readonly enabled: boolean;

  /** @param enabled defaulted from the platform, and injectable so a test can assert both sides. */
  constructor(logger: Logger, enabled: boolean = platform === 'win32') {
    this.logger = logger;
    this.enabled = enabled;
  }

  /** @throws never — the port says a toast is a courtesy. See the class header. */
  public notify(notification: Notification): void {
    if (!this.enabled) return;
    try {
      // `notifier.notify`, never a destructured `notify`: the module's export is a live
      // `WindowsToaster` instance and the method reads `this.options` (G.52).
      notifier.notify(
        {
          title: notification.title,
          message: notification.body,
          timeout: TOAST_SECONDS,
          // `false`, always. `true` keeps the child alive until the toast is clicked or dismissed,
          // which would leave one `ntfytoast.exe` per unread toast sitting in the process list.
          wait: false,
        },
        (error) => {
          // The callback arrives when the toast RESOLVES and nothing is waiting for it. It is read
          // only so that a notifier Windows refused — Focus Assist, a spent notification budget —
          // leaves a line an operator can find, rather than nothing at all.
          if (error !== null) this.logger.warn('toast_refused', { reason: error.name });
        },
      );
    } catch {
      // `execFile` can throw on the calling stack when Windows cannot start a process at all,
      // which took core down once through a different adapter (G.10). Not twice.
      this.logger.warn('toast_failed', {});
    }
  }
}
