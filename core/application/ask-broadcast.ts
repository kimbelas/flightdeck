// The Ask records, from the runner to whoever is watching — P4-T4, D48.
//
// `EventHub`'s much smaller sibling, and separate from it on purpose. `EventHub` carries
// `DraftEvent`s: evidence that something happened to a SESSION, which the reconciler acts on, the
// store persists and the stream turns into row frames. An Ask record is none of those things — it
// is one line of one run's answer, nothing reconciles it, nothing stores it, and putting it
// through the hub would mean widening `DraftEvent` so that every consumer of session events had a
// case for a sentence of prose.
//
// **Nothing is buffered, and that is the decision.** A subscriber that connects mid-run gets the
// records from that moment; there is no replay (stream-event.ts says why). So this is a fan-out
// and not a log: no history, no size to bound, and nothing to clean up when a run ends.
import type { AskFrame } from '../../contracts/ask-record.ts';
import type { Cancellation } from '../ports/cancellation.ts';
import type { AskPublisher } from './ask-runner.ts';

export interface AskFeed {
  /**
   * Calls `listener` for every record published from now on, in publication order.
   *
   * @returns a `Cancellation`; cancelling twice is safe, and cancelling from inside `listener` is
   * safe too — the record in flight still finishes. `EventHub`'s promise, kept here.
   */
  subscribe(listener: (frame: AskFrame) => void): Cancellation;
}

export class AskBroadcast implements AskPublisher, AskFeed {
  private readonly listeners = new Set<(frame: AskFrame) => void>();

  public subscribe(listener: (frame: AskFrame) => void): Cancellation {
    this.listeners.add(listener);
    return {
      cancel: () => {
        this.listeners.delete(listener);
      },
    };
  }

  /**
   * Sends one record to everyone watching.
   *
   * Over a copy of the set, so a listener that cancels itself while being called does not mutate
   * the collection being iterated — the same guard `EventHub` makes, and the reason its promise
   * about cancelling from inside a listener is safe to make.
   *
   * @throws never — a listener that throws must not take the run down with it, and on this path
   * the run is a child process that is still writing.
   */
  public publish(frame: AskFrame): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(frame);
      } catch {
        // A broken subscriber is that subscriber's problem. Swallowed rather than logged: this is
        // called once per token of a streamed answer, and a logger here would be the loudest line
        // in the file on a bad day.
      }
    }
  }
}
