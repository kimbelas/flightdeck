// Where something that happened goes — the seam between the producers and everything watching.
//
// A port because the producers must not know their audience. The reconciler (P1-T4) and the hooks
// receiver (P1-T5) publish; the store persists, the SSE stream (P1-T9) fans out to browsers, and
// the notifier raises a toast. Wiring those together in the producers would make a sweep depend on
// whether a browser is connected, which is exactly backwards: core outlives the browser (D2).
//
// **`void`, not `Promise<void>`, and it must not throw.** P1-T5's budget is a `200 {}` in under
// 5 ms with the work queued behind it (RESEARCH.md F.1), and a hook receiver that awaited its
// subscribers would spend that budget on them. An implementation that needs to do real work queues
// it; an implementation that fails logs and returns, because a sweep that threw because a browser
// disconnected would take the reconciler down with it.
import type { DraftEvent } from '../../contracts/fd-event.ts';

export interface EventSink {
  /** @throws never — see above. Returns as soon as the event is accepted, not once it is handled. */
  publish(event: DraftEvent): void;
}
