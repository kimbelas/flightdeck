// What happens to a statusLine render after the ack — P1-T6, SEC-ING-2 and SEC-ING-3.
//
// The same ack-then-work contract as `HookQueue`, and the same buffer behind it, with one
// difference that is the whole point of the class: **a render is not news**. The block posts on
// every repaint, so this records into `VitalsRegistry` and publishes an event only when the
// registry says something a reader would draw differently has moved.
//
// **It does not nudge the reconciler**, and that is the difference from a hook. A hook says
// something happened to a session; a render says a status line was painted. A sweep per render
// would mean `claude agents --json` twice a second forever, for news that arrives in the payload
// itself. The vitals path and the liveness path are separate feeds on purpose (D3).
//
// **The budget is somebody else's render loop.** F.3.4 measured what the block costs a render: a
// connected core is 21–26 ms of a 150 ms budget, and every millisecond here is one the owner waits
// for while typing. Whatever P1-T8 adds behind this queue, the ack stays in front of it.
import type { DraftEvent } from '../../contracts/fd-event.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import type { StatuslineReport } from '../../contracts/statusline-report.ts';
import type { Clock } from '../ports/clock.ts';
import type { EventSink } from '../ports/event-sink.ts';
import type { Logger } from '../ports/logger.ts';
import type { Scheduler } from '../ports/scheduler.ts';
import { IngestQueue } from './ingest-queue.ts';
import type { VitalsRegistry } from './vitals-registry.ts';

/** The one event type this publishes. Not the render — the fact that the vitals moved. */
export const VITALS_EVENT = 'vitals';

export interface StatuslineQueueParts {
  readonly sink: EventSink;
  readonly registry: VitalsRegistry;
  readonly scheduler: Scheduler;
  readonly clock: Clock;
  readonly logger: Logger;
}

interface Arrival {
  readonly report: StatuslineReport;
  readonly subscription: SubscriptionId;
  readonly at: number;
}

export class StatuslineQueue {
  private readonly sink: EventSink;
  private readonly registry: VitalsRegistry;
  private readonly clock: Clock;
  private readonly queue: IngestQueue<Arrival>;
  private publishedCount = 0;

  constructor(parts: StatuslineQueueParts) {
    this.sink = parts.sink;
    this.registry = parts.registry;
    this.clock = parts.clock;
    this.queue = new IngestQueue<Arrival>({
      name: 'statusline',
      scheduler: parts.scheduler,
      logger: parts.logger,
      handle: (batch) => {
        this.recordAll(batch);
      },
    });
  }

  public get depth(): number {
    return this.queue.depth;
  }

  public get dropped(): number {
    return this.queue.dropped;
  }

  /** How many renders turned into an event. Far below how many arrived, or something is wrong. */
  public get published(): number {
    return this.publishedCount;
  }

  /** Takes a render and returns immediately. @throws never. */
  public accept(report: StatuslineReport, subscription: SubscriptionId): void {
    this.queue.accept({ report, subscription, at: this.clock.now().getTime() });
  }

  /** Drains now. Public so a test does not have to own the scheduler's timing. */
  public drain(): void {
    this.queue.drain();
  }

  private recordAll(batch: readonly Arrival[]): void {
    for (const arrival of batch) {
      // Recorded either way — the registry is what `flightdeck-core status` and the deck read, and
      // a render that changed nothing still proves the session is being painted.
      if (this.registry.record(arrival.report, arrival.subscription, arrival.at)) {
        this.publish(arrival);
      }
    }
  }

  private publish(arrival: Arrival): void {
    this.publishedCount += 1;
    const event: DraftEvent = {
      at: arrival.at,
      sessionId: arrival.report.sessionId,
      subscription: arrival.subscription,
      source: 'statusline',
      type: VITALS_EVENT,
      // The projection, not the payload: everything Flightdeck reads and nothing else
      // (contracts/statusline-report.ts). No model text is in it at all.
      payload: arrival.report,
    };
    this.sink.publish(event);
  }
}
