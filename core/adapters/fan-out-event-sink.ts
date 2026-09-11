// One sink that is several — how core keeps logging AND streaming (P1-T9).
//
// P1-T4 shipped with `LoggingEventSink` as the whole audience, and the temptation on adding the
// stream was to replace it. That would trade the only record an operator has for the one a browser
// can see, and the two answer different questions: the log survives the tab being closed and is
// what `.flightdeck-core.log` is read for when something went wrong an hour ago.
//
// The producers are untouched by any of this, which is the point of the port: the reconciler still
// holds exactly one `EventSink` and cannot tell how many things are behind it.
import type { DraftEvent } from '../../contracts/fd-event.ts';
import type { EventSink } from '../ports/event-sink.ts';

export class FanOutEventSink implements EventSink {
  private readonly sinks: readonly EventSink[];

  constructor(sinks: readonly EventSink[]) {
    this.sinks = sinks;
  }

  /**
   * Publishes to every sink, in order.
   *
   * @throws never — the port forbids it, and a sink that breaks the promise must not be able to
   * cost the sinks after it in the list. There is nothing to log to here: the logger is behind one
   * of these sinks and may be the thing that failed.
   */
  public publish(event: DraftEvent): void {
    for (const sink of this.sinks) {
      try {
        sink.publish(event);
      } catch {
        // Deliberately empty — see the contract above.
      }
    }
  }
}
