// What you get back for anything that keeps running — a timer, a watcher, a subscription.
//
// An object rather than a bare `() => void` so that a caller storing several of them reads as
// `this.sweepTimer.cancel()` rather than `this.sweepTimer()`, and so the type says what it is at
// the field declaration rather than at the call site.
export interface Cancellation {
  /** Stops it. Safe to call twice; the second call is a no-op. */
  cancel(): void;
}
