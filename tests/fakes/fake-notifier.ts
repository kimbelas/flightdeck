// In-memory Notifier — CODING-STANDARDS §10.1.
//
// The real one shells out to SnoreToast, which is absent on a CI runner and would pop a toast on
// the owner's desktop for every test run if it were not. This one just remembers.
import type { Notification, Notifier } from '../../core/ports/notifier.ts';

export class FakeNotifier implements Notifier {
  public readonly raised: Notification[] = [];
  /** Makes the next `notify` fail internally, which the port says the caller must not see. */
  public failNext = false;

  public get last(): Notification | undefined {
    return this.raised.at(-1);
  }

  public forSession(sessionId: string): readonly Notification[] {
    return this.raised.filter((notification) => notification.sessionId === sessionId);
  }

  public notify(notification: Notification): void {
    if (this.failNext) {
      this.failNext = false;
      return;
    }
    this.raised.push(notification);
  }
}
