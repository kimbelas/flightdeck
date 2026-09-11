// The picture of what is running, kept current — P1-T4.
//
// Three feeds decide when to look (DECISIONS.md D3): a 10 s timer, a file-watch nudge, and
// anything that asks. Only one of them decides what is TRUE, and it is the sweep: `fs.watch` on
// Windows drops events under bursty writes (RESEARCH.md E.5), so a nudge may only make the next
// sweep early — never stand in for it. Ten seconds is the interval because one sweep costs ~763 ms
// per config dir (B.2), which is why "every 10 s, never a 1 s poll" has been the rule since §B.
//
// **Three things this must not do**, each of which was a measured trap before it was a rule:
//
//  1. **Read a failed sweep as an empty one.** A subscription whose CLI could not be read has NO
//     gone-detection run against it at all. `claude.exe` missing for four seconds would otherwise
//     announce that every session on that subscription had ended.
//  2. **Conclude anything permanent from one sweep.** A record carries `state: working` before it
//     carries `pid` (RESEARCH.md G.2), so a just-launched session reads as not live for a moment;
//     `gone` therefore takes two consecutive successful sweeps of that session's own subscription.
//     Nothing here latches — every field is re-derived from the newest sweep.
//  3. **Mistake a stopped session for a departed one.** `agents --json` without `--all` omits
//     stopped and retired sessions entirely (F.2.2), which would make every `claude stop` look
//     like an `rm`. The source passes `--all`; this is the class that would be wrong without it.
import type { DraftEvent } from '../../contracts/fd-event.ts';
import type { SessionRow } from '../../contracts/session-row.ts';
import { SUBSCRIPTION_IDS, type SubscriptionId } from '../../contracts/session.ts';
import type { Cancellation } from '../ports/cancellation.ts';
import type { Clock } from '../ports/clock.ts';
import type { DirectoryWatcher } from '../ports/directory-watcher.ts';
import type { EventSink } from '../ports/event-sink.ts';
import type { Logger } from '../ports/logger.ts';
import type { Scheduler } from '../ports/scheduler.ts';
import type { SessionSource, Sweep } from '../ports/session-source.ts';
import { sameRow, toSessionRow } from './session-rows.ts';

/** RESEARCH.md B.2: ~763 ms per config dir, so a shorter interval spends the machine on itself. */
const SWEEP_INTERVAL_MS = 10_000;

/**
 * One file write reaches `fs.watch` as several events (E.5). Long enough to coalesce a burst,
 * short enough that a nudge still beats the timer by most of its interval.
 */
const NUDGE_DEBOUNCE_MS = 200;

/**
 * How many consecutive successful sweeps of its own subscription a session must be missing from
 * before it is announced gone. Two, for the reason in the header.
 */
const SWEEPS_BEFORE_GONE = 2;

/** What the reconciler says happened. P1-T9 fans these out; the store keeps them. */
export type ReconcileEventType = 'seen' | 'changed' | 'gone';

export interface ReconcilerParts {
  readonly source: SessionSource;
  readonly sink: EventSink;
  readonly scheduler: Scheduler;
  readonly watcher: DirectoryWatcher;
  readonly clock: Clock;
  readonly logger: Logger;
}

export class Reconciler {
  private readonly source: SessionSource;
  private readonly sink: EventSink;
  private readonly scheduler: Scheduler;
  private readonly watcher: DirectoryWatcher;
  private readonly clock: Clock;
  private readonly logger: Logger;

  private readonly known = new Map<string, SessionRow>();
  private readonly absences = new Map<string, number>();
  private readonly unreadableSubscriptions = new Set<SubscriptionId>();

  private sweepTimer: Cancellation | undefined;
  private watching: Cancellation | undefined;
  private debounce: Cancellation | undefined;
  private running = false;
  private rerunRequested = false;

  constructor(parts: ReconcilerParts) {
    this.source = parts.source;
    this.sink = parts.sink;
    this.scheduler = parts.scheduler;
    this.watcher = parts.watcher;
    this.clock = parts.clock;
    this.logger = parts.logger;
  }

  /** Every session known to be, or to have been, running — the newest observation of each. */
  public get sessions(): readonly SessionRow[] {
    return [...this.known.values()];
  }

  /** Subscriptions whose last sweep failed. Not the same as a subscription with no sessions. */
  public get unreadable(): readonly SubscriptionId[] {
    return [...this.unreadableSubscriptions];
  }

  /**
   * Starts the timer and the watcher, and sweeps once immediately.
   *
   * The immediate sweep is the difference between core knowing nothing for ten seconds after boot
   * and knowing everything a second in. Idempotent — starting twice does not double the timer.
   */
  public start(): void {
    if (this.sweepTimer !== undefined) return;
    this.sweepTimer = this.scheduler.every(SWEEP_INTERVAL_MS, () => {
      void this.reconcile();
    });
    this.watching = this.watcher.watch(() => {
      this.onNudge();
    });
    void this.reconcile();
  }

  /** Stops both feeds. Idempotent; a reconcile already in flight is allowed to finish. */
  public stop(): void {
    this.sweepTimer?.cancel();
    this.watching?.cancel();
    this.debounce?.cancel();
    this.sweepTimer = undefined;
    this.watching = undefined;
    this.debounce = undefined;
  }

  /**
   * Sweeps both subscriptions and publishes what changed.
   *
   * Never runs twice at once: a call made while one is in flight sets a flag and is served by one
   * further sweep afterwards. Two concurrent sweeps would double the ~1.5 s cost and could
   * interleave into a `gone` for a session the other had just seen.
   *
   * @throws never — a subscription that cannot be read is reported, not raised.
   */
  public async reconcile(): Promise<void> {
    if (this.running) {
      this.rerunRequested = true;
      return;
    }
    this.running = true;
    try {
      await this.sweepAll();
    } finally {
      this.running = false;
    }
    if (this.rerunRequested) {
      this.rerunRequested = false;
      await this.reconcile();
    }
  }

  private onNudge(): void {
    this.debounce?.cancel();
    this.debounce = this.scheduler.after(NUDGE_DEBOUNCE_MS, () => {
      this.debounce = undefined;
      void this.reconcile();
    });
  }

  private async sweepAll(): Promise<void> {
    const sweeps = await Promise.all(SUBSCRIPTION_IDS.map((id) => this.source.sweep(id)));
    const at = this.clock.now().getTime();
    for (const sweep of sweeps) this.apply(sweep, at);
  }

  private apply(sweep: Sweep, at: number): void {
    if (sweep.failed) {
      // Trap 1. Report it and touch nothing: what we knew a moment ago is still the best answer.
      this.unreadableSubscriptions.add(sweep.subscription);
      this.logger.warn('reconcile_unreadable', { subscription: sweep.subscription });
      return;
    }
    this.unreadableSubscriptions.delete(sweep.subscription);

    const present = new Set<string>();
    for (const session of sweep.sessions) {
      const row = toSessionRow(session);
      present.add(row.sessionId);
      this.absences.delete(row.sessionId);
      this.record(row, at);
    }
    this.retireMissing(sweep.subscription, present, at);
  }

  private record(row: SessionRow, at: number): void {
    const previous = this.known.get(row.sessionId);
    this.known.set(row.sessionId, row);
    if (previous === undefined) {
      this.publish('seen', row, at);
      return;
    }
    if (!sameRow(previous, row)) this.publish('changed', row, at);
  }

  /** Trap 2: absence is counted, not acted on, until it has happened twice in a row. */
  private retireMissing(subscription: SubscriptionId, present: Set<string>, at: number): void {
    const gone: SessionRow[] = [];
    for (const [sessionId, row] of this.known) {
      if (row.subscription !== subscription || present.has(sessionId)) continue;
      const absences = (this.absences.get(sessionId) ?? 0) + 1;
      if (absences < SWEEPS_BEFORE_GONE) {
        this.absences.set(sessionId, absences);
        continue;
      }
      gone.push(row);
    }
    for (const row of gone) {
      this.absences.delete(row.sessionId);
      this.known.delete(row.sessionId);
      this.publish('gone', row, at);
    }
  }

  private publish(type: ReconcileEventType, row: SessionRow, at: number): void {
    const event: DraftEvent = {
      at,
      sessionId: row.sessionId,
      subscription: row.subscription,
      source: 'reconcile',
      type,
      payload: row,
    };
    this.sink.publish(event);
  }
}
