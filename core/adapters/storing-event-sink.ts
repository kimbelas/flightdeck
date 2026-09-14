// Every event, into the store — P1-T8.
//
// The third thing behind `FanOutEventSink`, next to the log and the hub, and the three are not
// redundant: the log is what an operator reads an hour later, the hub is what a browser sees right
// now, and this is the only one that can still answer a question next month. Transcripts are
// deleted after `cleanupPeriodDays` (D9), so for anything older than thirty days this file is the
// history.
//
// **`EventSink.publish` must not throw, and `Store.appendEvent` does.** That is the whole reason
// this class exists rather than core holding the store directly. A sweep must not die because the
// disk filled, and a hook must not 500 because an ACL changed (the port's contract, and F.1's 5 ms
// budget). So a failed write is logged once and swallowed — losing an event is bad, and taking the
// reconciler down with it is worse.
//
// **Logged once, not once per event.** A broken store breaks on every event, and an error line per
// hook would turn a full disk into a bigger full disk. The first failure says so and the counter
// carries the rest, which `flightdeck-core status` prints (P1-T12).
//
// **It writes the snapshot row too, and that is one class rather than two on purpose.** A `vitals`
// event already carries everything the series needs, and it is already gated on "did this move" by
// `VitalsRegistry` — so a second sink would mean a second copy of the never-throw discipline above,
// which is the part worth having in exactly one place.
import type { DraftEvent } from '../../contracts/fd-event.ts';
import { snapshotFromEvent } from '../../contracts/vitals-snapshot.ts';
import type { EventSink } from '../ports/event-sink.ts';
import type { Logger } from '../ports/logger.ts';
import type { Store } from '../ports/store.ts';

export class StoringEventSink implements EventSink {
  private readonly store: Store;
  private readonly logger: Logger;
  private storedCount = 0;
  private snapshotCount = 0;
  private droppedCount = 0;

  constructor(store: Store, logger: Logger) {
    this.store = store;
    this.logger = logger;
  }

  /** How many events reached the store. */
  public get stored(): number {
    return this.storedCount;
  }

  /** How many vitals snapshots were kept. Far below `stored`, or the change gate is not working. */
  public get snapshots(): number {
    return this.snapshotCount;
  }

  /** How many were lost to a failing store. Non-zero is a problem `doctor` should surface. */
  public get dropped(): number {
    return this.droppedCount;
  }

  /** @throws never — see the header. */
  public publish(event: DraftEvent): void {
    try {
      this.store.appendEvent(event);
      this.storedCount += 1;
      const snapshot = snapshotFromEvent(event);
      if (snapshot !== undefined) {
        this.store.appendSnapshot(snapshot);
        this.snapshotCount += 1;
      }
    } catch (cause) {
      this.droppedCount += 1;
      if (this.droppedCount === 1) {
        this.logger.error('store_write_failed', {
          // The event's identity, never its payload: a payload carries model text and this line
          // goes to a file (SEC-UI-2, SEC-DATA-2).
          source: event.source,
          type: event.type,
          reason: cause instanceof Error ? cause.message : 'unknown',
        });
      }
    }
  }
}
