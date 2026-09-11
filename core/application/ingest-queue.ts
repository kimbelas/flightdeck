// Ack first, work afterwards — the buffer both ingestion routes sit behind (P1-T5, P1-T6).
//
// Extracted from `HookQueue` when the statusLine receiver needed the same thing, and extracted
// rather than copied for the reason P1-T4 gave when `toSessionRow` moved: the interesting parts of
// this are the ones that are easy to get subtly different in a second copy — dropping the newest
// rather than the oldest, one timer per batch rather than per item, and a drain that cannot throw.
//
// **Why a buffer at all**, when the work behind it is currently microseconds: because the contract
// is "the route answers before any of this runs" (SEC-ING-2), and that should be true by
// construction rather than by the work happening to be small. P1-T8 puts a SQLite write back here.
//
// **Bounded, and it drops the newest.** A wedged session retrying must not be able to grow this
// until core dies; and when something has to go, what was already accepted is worth more than what
// is still arriving, because it is the older half of the story.
import type { Logger } from '../ports/logger.ts';
import type { Scheduler } from '../ports/scheduler.ts';

/**
 * Roughly a minute of the ingest budget (SEC-HTTP-6: 600/min), which is the longest a drain should
 * ever be behind. Past it, something is wrong in a way that dropping will not make worse.
 */
const MAX_QUEUED = 600;

export interface IngestQueueParts<T> {
  /** Names the log line — `hook_queue_full`, `statusline_queue_full`. */
  readonly name: string;
  readonly scheduler: Scheduler;
  readonly logger: Logger;
  /**
   * Handles everything that arrived since the last drain, in order.
   *
   * A batch rather than one item at a time, because what a caller does *after* the items is often
   * the part that must happen once: the hook queue asks for a single sweep however many hooks a
   * turn fired. @throws never — see `drain`.
   */
  readonly handle: (batch: readonly T[]) => void;
}

export class IngestQueue<T> {
  private readonly name: string;
  private readonly scheduler: Scheduler;
  private readonly logger: Logger;
  private readonly handle: (batch: readonly T[]) => void;
  private readonly waiting: T[] = [];
  private draining = false;
  private droppedCount = 0;

  constructor(parts: IngestQueueParts<T>) {
    this.name = parts.name;
    this.scheduler = parts.scheduler;
    this.logger = parts.logger;
    this.handle = parts.handle;
  }

  /** How many items are waiting. Non-zero for microseconds unless something is stuck. */
  public get depth(): number {
    return this.waiting.length;
  }

  /** How many were refused because the queue was full. A non-zero value is a real incident. */
  public get dropped(): number {
    return this.droppedCount;
  }

  /**
   * Takes an item and returns immediately. Nothing below the return happens before the ack.
   *
   * @throws never — the route must be able to answer whatever state this is in, and an ingestion
   * path that can fail at the caller is one that puts an error banner in a live session (F.1.5).
   */
  public accept(item: T): void {
    if (this.waiting.length >= MAX_QUEUED) {
      this.droppedCount += 1;
      // Once per burst, not once per item: at 600 a minute the log would become the incident. The
      // count above is what a `doctor` check reads (SEC-OPS-1).
      if (this.droppedCount === 1) {
        this.logger.warn(`${this.name}_queue_full`, { queued: MAX_QUEUED });
      }
      return;
    }
    this.waiting.push(item);
    this.scheduleDrain();
  }

  /**
   * Hands everything waiting to the handler. Public so a test does not have to own the timing.
   *
   * @throws never — one bad item must not strand the ones behind it, and a drain that threw would
   * do it from a timer callback, where there is nobody to catch it and the process exits (G.10).
   */
  public drain(): void {
    const batch = this.waiting.splice(0, this.waiting.length);
    if (batch.length === 0) return;
    try {
      this.handle(batch);
    } catch {
      this.logger.error(`${this.name}_drain_failed`, { items: batch.length });
    }
  }

  /**
   * One timer per batch, not one per item.
   *
   * `after(0)` rather than doing the work inline, so "the ack happens first" holds by construction.
   */
  private scheduleDrain(): void {
    if (this.draining) return;
    this.draining = true;
    this.scheduler.after(0, () => {
      this.draining = false;
      this.drain();
    });
  }
}
