// What happens to a hook payload after the ack — SEC-ING-2 (P1-T5).
//
// The receiver's budget is a `200 {}` in under 5 ms (RESEARCH.md F.1), and the reason is not
// tidiness: a hook is in the critical path of somebody's session, and on an interactive session a
// receiver that is slow or wrong puts a `Stop hook error occurred` banner in front of them for
// every turn afterwards (F.1.5). So the route parses, hands the payload here, and returns.
//
// The buffering is `IngestQueue`'s since P1-T6 needed the same thing; what is left here is the two
// things that are this queue's own — turning a payload into an event, and asking for a sweep.
//
// **A hook is evidence, not truth.** It says something happened to a session; it does not say what
// the session looks like now, and nothing here tries to derive that. What it does instead is
// `nudge()` the reconciler — D3's rule that three feeds decide WHEN to look and exactly one decides
// what is true. That is what makes the P1 gate sentence come true: a `Stop` reaches core in a
// millisecond, the sweep it triggers finishes inside a second, and the row on the deck moves
// through the path that was already there rather than through a second one invented here.
import type { DraftEvent } from '../../contracts/fd-event.ts';
import type { HookPayload } from '../../contracts/hook-event.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import type { Clock } from '../ports/clock.ts';
import type { EventSink } from '../ports/event-sink.ts';
import type { Logger } from '../ports/logger.ts';
import type { Scheduler } from '../ports/scheduler.ts';
import { IngestQueue } from './ingest-queue.ts';

/** What a hook asks the reconciler to do: look soon, debounced. Never "believe me". */
export interface SweepTrigger {
  nudge(): void;
}

export interface HookQueueParts {
  readonly sink: EventSink;
  readonly trigger: SweepTrigger;
  readonly scheduler: Scheduler;
  readonly clock: Clock;
  readonly logger: Logger;
}

interface Arrival {
  readonly payload: HookPayload;
  readonly subscription: SubscriptionId;
  readonly at: number;
}

export class HookQueue {
  private readonly sink: EventSink;
  private readonly trigger: SweepTrigger;
  private readonly clock: Clock;
  private readonly queue: IngestQueue<Arrival>;

  constructor(parts: HookQueueParts) {
    this.sink = parts.sink;
    this.trigger = parts.trigger;
    this.clock = parts.clock;
    this.queue = new IngestQueue<Arrival>({
      name: 'hook',
      scheduler: parts.scheduler,
      logger: parts.logger,
      handle: (batch) => {
        this.publishAll(batch);
      },
    });
  }

  /** How many payloads are waiting. Non-zero for microseconds unless something is stuck. */
  public get depth(): number {
    return this.queue.depth;
  }

  /** How many were refused because the queue was full. A non-zero value is a real incident. */
  public get dropped(): number {
    return this.queue.dropped;
  }

  /**
   * Takes a payload and returns immediately. Nothing below the return happens before the ack.
   *
   * @throws never — the route must be able to answer `200` whatever state this is in.
   */
  public accept(payload: HookPayload, subscription: SubscriptionId): void {
    this.queue.accept({ payload, subscription, at: this.clock.now().getTime() });
  }

  /** Drains now. Public so a test does not have to own the scheduler's timing. */
  public drain(): void {
    this.queue.drain();
  }

  private publishAll(batch: readonly Arrival[]): void {
    for (const arrival of batch) this.publish(arrival);
    // Once per batch rather than per event: a turn ending fires more than one hook, and each of
    // them asking for a sweep would be the same sweep. The reconciler debounces too — this is the
    // cheaper half of the same idea.
    this.trigger.nudge();
  }

  private publish(arrival: Arrival): void {
    const event: DraftEvent = {
      at: arrival.at,
      sessionId: arrival.payload.session_id,
      subscription: arrival.subscription,
      source: 'hook',
      type: arrival.payload.hook_event_name,
      // The whole payload, verbatim, for replay and for the store (P1-T8). It carries
      // `last_assistant_message` on a `Stop`, so everything downstream treats it as untrusted:
      // `LoggingEventSink` records only scalars, and the stream refuses any event that is not the
      // reconciler's (SessionStreamRoute, SEC-UI-2).
      payload: arrival.payload,
    };
    this.sink.publish(event);
  }
}
