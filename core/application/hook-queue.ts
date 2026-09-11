// What happens to a hook payload after the ack — SEC-ING-2 (P1-T5).
//
// The receiver's budget is a `200 {}` in under 5 ms (RESEARCH.md F.1), and the reason is not
// tidiness: a hook is in the critical path of somebody's session, and on an interactive session a
// receiver that is slow or wrong puts a `Stop hook error occurred` banner in front of them for
// every turn afterwards (F.1.5). So the route parses, hands the payload here, and returns. This
// class is where the work is allowed to take as long as it takes — which today is publishing an
// event, and from P1-T8 is a SQLite write.
//
// **A hook is evidence, not truth.** It says something happened to a session; it does not say what
// the session looks like now, and nothing here tries to derive that. What it does instead is
// `nudge()` the reconciler — D3's rule that three feeds decide WHEN to look and exactly one decides
// what is true. That is what makes the P1 gate sentence come true: a `Stop` reaches core in a
// millisecond, the sweep it triggers finishes inside a second, and the row on the deck moves
// through the path that was already there rather than through a second one invented here.
//
// **Bounded, and it drops the newest.** A wedged session retrying its hook must not be able to
// grow this array until core dies; and when something has to go, the events already accepted are
// worth more than the one still arriving, because they are the older half of the story.
import type { DraftEvent } from '../../contracts/fd-event.ts';
import type { HookPayload } from '../../contracts/hook-event.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import type { Clock } from '../ports/clock.ts';
import type { EventSink } from '../ports/event-sink.ts';
import type { Logger } from '../ports/logger.ts';
import type { Scheduler } from '../ports/scheduler.ts';

/**
 * Roughly a minute of the ingest budget (SEC-HTTP-6: 600 events/min), which is the longest a drain
 * should ever be behind. Past it, something is wrong in a way that dropping will not make worse.
 */
const MAX_QUEUED = 600;

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
  private readonly scheduler: Scheduler;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly waiting: Arrival[] = [];
  private draining = false;
  private droppedCount = 0;

  constructor(parts: HookQueueParts) {
    this.sink = parts.sink;
    this.trigger = parts.trigger;
    this.scheduler = parts.scheduler;
    this.clock = parts.clock;
    this.logger = parts.logger;
  }

  /** How many payloads are waiting. Non-zero for microseconds unless something is stuck. */
  public get depth(): number {
    return this.waiting.length;
  }

  /** How many were refused because the queue was full. A non-zero value is a real incident. */
  public get dropped(): number {
    return this.droppedCount;
  }

  /**
   * Takes a payload and returns immediately. Nothing below the return happens before the ack.
   *
   * @throws never — the route must be able to answer `200` whatever state this is in, and an
   * ingestion path that can fail at the caller is one that puts a banner in a session (F.1.5).
   */
  public accept(payload: HookPayload, subscription: SubscriptionId): void {
    if (this.waiting.length >= MAX_QUEUED) {
      this.droppedCount += 1;
      // Once per burst, not once per event: at 600 events a minute the log would become the
      // incident. The count above is what a `doctor` check reads (SEC-OPS-1).
      if (this.droppedCount === 1) this.logger.warn('hook_queue_full', { queued: MAX_QUEUED });
      return;
    }
    this.waiting.push({ payload, subscription, at: this.clock.now().getTime() });
    this.scheduleDrain();
  }

  /**
   * Drains everything waiting. Public so a test does not have to own the scheduler's timing.
   *
   * @throws never — one payload that cannot be handled must not strand the ones behind it.
   */
  public drain(): void {
    const batch = this.waiting.splice(0, this.waiting.length);
    if (batch.length === 0) return;
    for (const arrival of batch) this.publish(arrival);
    // Once per batch rather than per event: a turn ending fires more than one hook, and each of
    // them asking for a sweep would be the same sweep. The reconciler debounces too — this is the
    // cheaper half of the same idea.
    this.trigger.nudge();
  }

  /**
   * One timer per batch, not one per event.
   *
   * `after(0)` rather than doing the work here, because "the ack happens first" is the contract
   * and it should be true by construction rather than by the work being small today.
   */
  private scheduleDrain(): void {
    if (this.draining) return;
    this.draining = true;
    this.scheduler.after(0, () => {
      this.draining = false;
      this.drain();
    });
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
