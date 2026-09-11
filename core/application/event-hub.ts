// One published event, every subscriber — the fan-out half of the EventSink port (P1-T9).
//
// The producers (the reconciler today; the hooks receiver and the transcript tail in P1-T5 and
// P1-T7) must not know who is listening, and a browser must not be able to affect a sweep. This is
// the only place those two facts meet, so it is the only place that has to be careful:
//
//   - **`publish` never throws.** The port promises it (core/ports/event-sink.ts) and a sweep that
//     died because a subscriber did would take the picture of the machine down with it. A listener
//     that throws is counted and reported; the rest still get the event.
//   - **The listener set is copied before iterating.** A subscriber that unsubscribes while being
//     notified — which is exactly what a stream closing mid-frame does — would otherwise mutate the
//     set under the loop.
//   - **It is synchronous and unbuffered.** There is no queue and no replay here: a subscriber that
//     connects after an event has happened gets the current state instead (`Reconciler.snapshot`),
//     which is a stronger guarantee than a replayed delta and is why `/stream` opens with one.
import type { DraftEvent } from '../../contracts/fd-event.ts';
import type { Cancellation } from '../ports/cancellation.ts';
import type { EventSink } from '../ports/event-sink.ts';
import type { Logger } from '../ports/logger.ts';

/** The read side of the hub — what a stream subscribes to, without being able to publish. */
export interface EventFeed {
  /**
   * Calls `listener` for every event published from now on, in publication order.
   *
   * @returns a `Cancellation`; cancelling twice is safe, and cancelling from inside `listener` is
   * safe too — the event in flight still finishes.
   */
  subscribe(listener: (event: DraftEvent) => void): Cancellation;
}

export class EventHub implements EventSink, EventFeed {
  private readonly listeners = new Set<(event: DraftEvent) => void>();
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /** How many subscribers are live. A closed stream that is still here is a leak. */
  public get subscriberCount(): number {
    return this.listeners.size;
  }

  public subscribe(listener: (event: DraftEvent) => void): Cancellation {
    this.listeners.add(listener);
    return {
      cancel: (): void => {
        this.listeners.delete(listener);
      },
    };
  }

  /** @throws never — see the header. */
  public publish(event: DraftEvent): void {
    let failed = 0;
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        failed += 1;
      }
    }
    if (failed > 0) this.reportFailures(failed);
  }

  /**
   * Logged outside the loop, and in its own try: a closed stdout is a real way for the logger to
   * fail, and nesting that inside the catch above would put a second throw where there is nowhere
   * left to report it.
   */
  private reportFailures(failed: number): void {
    try {
      this.logger.warn('stream_listener_failed', { listeners: failed });
    } catch {
      // Nowhere left to report it.
    }
  }
}
