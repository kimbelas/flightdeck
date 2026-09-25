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
//
// **An interactive session that vanishes has ENDED; a background one that vanishes was DELETED**
// — P6-T7, and the asymmetry is measured rather than assumed (RESEARCH.md G.55). `--all` keeps a
// background job listed forever with `state: done` and no `pid`, so it can only leave the listing
// by being `rm`-ed; an interactive session is dropped the instant its terminal closes. `rm` takes
// a job directory, which an interactive session has never had, so it cannot be the explanation
// for one disappearing. That is why an interactive session lingers here as an ENDED row rather
// than being announced gone: the terminal has closed, the conversation has not, and SPEC §4.3
// says the deck offers to adopt it at exactly this moment.
//
// **A background session's ENDING comes from `daemon.log`, inside the same sweep** — D62. The
// listing reads `state: done` for a stop, a finish and a retirement alike (F.2.3); `EndingBook`
// reads the log's tail for the one subscription that has an ending to explain, and only then, so
// the sweep stays the only timer and the log is read at an edge rather than on every tick.
import type { DraftEvent } from '../../contracts/fd-event.ts';
import {
  byAttentionThenAge,
  type DeckSnapshot,
  type SessionRow,
} from '../../contracts/session-row.ts';
import { SUBSCRIPTION_IDS, type SubscriptionId } from '../../contracts/session.ts';
import type { Cancellation } from '../ports/cancellation.ts';
import type { Clock } from '../ports/clock.ts';
import type { DirectoryWatcher } from '../ports/directory-watcher.ts';
import type { EventSink } from '../ports/event-sink.ts';
import type { Logger } from '../ports/logger.ts';
import type { Scheduler } from '../ports/scheduler.ts';
import type { SessionSource, Sweep } from '../ports/session-source.ts';
import { EndingBook } from './ending-book.ts';
import { sameRow, toEndedRow, toSessionRow } from './session-rows.ts';

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

/**
 * How long an ended interactive session stays on the deck as adoptable — P6-T7.
 *
 * Thirty minutes: long enough to survive going for a coffee after closing a terminal, short enough
 * that the deck is not a graveyard of every window opened today. It is a window on the OFFER, not
 * on the conversation — `claude --resume` still works on it forever, and a row that stayed until
 * somebody dismissed it would be a second inbox to keep.
 */
const LINGER_MS = 30 * 60_000;

/**
 * How many ended sessions to hold at once. `VitalsRegistry`'s reason rather than a memory budget:
 * a map that only ever grows is the kind of thing nobody notices until it matters, and the time
 * window above bounds the ordinary day but not a script that opens a hundred terminals in one.
 * Eviction is oldest-ended first, which is also the order they would expire in.
 */
const MAX_LINGERING = 20;

/** What the reconciler says happened. `SessionStreamRoute` fans these out; the store keeps them. */
export type ReconcileEventType = 'seen' | 'changed' | 'gone';

export interface ReconcilerParts {
  readonly source: SessionSource;
  readonly sink: EventSink;
  readonly scheduler: Scheduler;
  readonly watcher: DirectoryWatcher;
  readonly clock: Clock;
  readonly logger: Logger;
  /**
   * How background sessions ended, from `daemon.log` (D62). Optional so a test about sweeps and
   * absences need not supply a log; without one every ending reads `unknown`, as it did before.
   */
  readonly endings?: EndingBook;
}

export class Reconciler {
  private readonly source: SessionSource;
  private readonly sink: EventSink;
  private readonly scheduler: Scheduler;
  private readonly watcher: DirectoryWatcher;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly endings: EndingBook;

  private readonly known = new Map<string, SessionRow>();
  private readonly absences = new Map<string, number>();
  /** Ended interactive sessions, by session id, holding the instant they were found missing. */
  private readonly lingering = new Map<string, number>();
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
    this.endings = parts.endings ?? new EndingBook();
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
   * The ended interactive sessions still on offer — P6-T7.
   *
   * `DeckQuery` merges these into `GET /sessions`, which takes a FRESH sweep and therefore cannot
   * see them: the listing has already forgotten them, which is the whole reason they are held
   * here. Without the merge a refresh would clear the offer and the next stream frame would put it
   * back, which is a deck disagreeing with itself.
   */
  public get ended(): readonly SessionRow[] {
    return [...this.lingering.keys()]
      .map((sessionId) => this.known.get(sessionId))
      .filter((row): row is SessionRow => row !== undefined);
  }

  /**
   * The last row core saw for one session, or `undefined`.
   *
   * `SessionAdopter` reads the FOLDER from it. That is deliberate and is the security posture of
   * every session verb here: the browser sends a ref, never a path, and core answers where that
   * session was from its own reading of the machine (SEC-FS-1).
   */
  public rowFor(subscription: SubscriptionId, sessionId: string): SessionRow | undefined {
    const row = this.known.get(sessionId);
    return row?.subscription === subscription ? row : undefined;
  }

  /**
   * The row with the ending core has read for it, if any — for `DeckQuery`, whose fresh sweep
   * cannot know one. The same book the stream's rows came from, so a refresh cannot disagree
   * with the frame before it (D62).
   */
  public explain(row: SessionRow): SessionRow {
    return this.endings.explain(row);
  }

  /**
   * What core knows right now, in the deck's shape — the replay `GET /stream` opens with (P1-T9).
   *
   * Free, and that is the point: it reads the map the sweeps already fill, so a browser connecting
   * costs no `claude.exe` call and cannot disagree with the events that follow it. `DeckQuery`
   * answers the same question by sweeping, which is the right answer for `GET /sessions` and the
   * wrong one for a connect — 1.5 s per subscriber, and a second opinion about what is live.
   *
   * `takenAt` is when this was asked, not when it was last swept: the deck uses it to order, never
   * to claim freshness.
   */
  public snapshot(): DeckSnapshot {
    return {
      rows: [...this.known.values()].sort(byAttentionThenAge),
      unreadable: this.unreadable,
      takenAt: this.clock.now().getTime(),
    };
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
      this.nudge();
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
    } catch (cause) {
      // The second half of "@throws never", and it is not defensive programming for its own sake:
      // a source that REJECTS rather than reporting a failed sweep used to take core down with it.
      // `execFile` can throw on the calling stack when Windows cannot start a process at all, and
      // that became an unhandled rejection and an exited core (RESEARCH.md G.10). The adapter no
      // longer does it; this makes it not matter if something else ever does.
      this.logger.error('reconcile_failed', {
        reason: cause instanceof Error ? cause.name : 'unknown',
      });
    } finally {
      this.running = false;
    }
    if (this.rerunRequested) {
      this.rerunRequested = false;
      await this.reconcile();
    }
  }

  /**
   * Asks for a sweep soon — D3's feeds 1 and 5, and the only thing either of them may do.
   *
   * Public since P1-T5, because a hook is the same kind of evidence as a file changing: it says
   * something happened, never what is now true. A `Stop` reaches core in a millisecond and the
   * sweep it asks for finishes inside a second, which is what makes the P1 gate sentence true —
   * through the path that already existed rather than through a second one that would have to be
   * kept in agreement with it.
   *
   * Debounced, and it has to be: a turn ending fires more than one hook, `fs.watch` fires in
   * bursts (RESEARCH.md E.5), and the budget is 600 events a minute per session (SEC-HTTP-6).
   * Every one of those is the same sweep.
   */
  public nudge(): void {
    this.debounce?.cancel();
    this.debounce = this.scheduler.after(NUDGE_DEBOUNCE_MS, () => {
      this.debounce = undefined;
      void this.reconcile();
    });
  }

  private async sweepAll(): Promise<void> {
    const sweeps = await Promise.all(SUBSCRIPTION_IDS.map((id) => this.source.sweep(id)));
    const at = this.clock.now().getTime();
    // Before the rows are recorded, so the frame that says a session stopped already says why —
    // one `changed`, and the toast reads the right word the first time (D58, D62).
    const swept = sweeps.flatMap((sweep) => (sweep.failed ? [] : sweep.sessions));
    await this.endings.learn(swept.map(toSessionRow), at);
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
      const row = this.endings.explain(toSessionRow(session));
      present.add(row.sessionId);
      this.absences.delete(row.sessionId);
      // An adopted session comes back under its OWN id as a background job (G.55), so a row that
      // reappears is no longer ended and must stop being offered — the offer is the one thing on
      // it that would otherwise survive the thing it was offering.
      this.lingering.delete(row.sessionId);
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
    const ended: SessionRow[] = [];
    for (const [sessionId, row] of this.known) {
      if (row.subscription !== subscription || present.has(sessionId)) continue;
      const verdict = this.verdictFor(row, at);
      if (verdict === 'gone') gone.push(row);
      else if (verdict === 'ended') ended.push(row);
    }
    for (const row of ended) this.endInteractive(row, at);
    for (const row of gone) {
      this.endings.forget(row);
      this.absences.delete(row.sessionId);
      this.lingering.delete(row.sessionId);
      this.known.delete(row.sessionId);
      this.publish('gone', row, at);
    }
  }

  /**
   * What one absent row's absence means now.
   *
   * `wait` is the answer that does something: it is where the absence is COUNTED, which is trap 2
   * — a record carries `state: working` before it carries `pid` (G.2), so one missing sweep is
   * never enough to conclude anything.
   */
  private verdictFor(row: SessionRow, at: number): 'gone' | 'ended' | 'wait' {
    // Already ended: absence is what it IS now, so it is not counted again — only timed.
    const endedAt = this.lingering.get(row.sessionId);
    if (endedAt !== undefined) return at - endedAt >= LINGER_MS ? 'gone' : 'wait';

    const absences = (this.absences.get(row.sessionId) ?? 0) + 1;
    if (absences < SWEEPS_BEFORE_GONE) {
      this.absences.set(row.sessionId, absences);
      return 'wait';
    }
    // The asymmetry the header argues: a background job can only leave the listing by being
    // `rm`-ed, and an interactive session leaves it by its terminal closing.
    return row.kind === 'interactive' ? 'ended' : 'gone';
  }

  /**
   * One interactive session's terminal has closed — P6-T7.
   *
   * `changed`, not `gone`: the session is still on the deck, as an ended row with an offer on it.
   * The row is REPLACED rather than annotated, because `toEndedRow` is what decides that an ended
   * session is not busy and not "already bound to its own terminal" — see it for why each of those
   * would otherwise be a claim the row makes and cannot support.
   */
  private endInteractive(row: SessionRow, at: number): void {
    this.absences.delete(row.sessionId);
    this.evictOldestEnded();
    this.lingering.set(row.sessionId, at);
    const endedRow = toEndedRow(row);
    this.known.set(row.sessionId, endedRow);
    this.logger.info('session_ended', {
      subscription: row.subscription,
      session: row.sessionId,
    });
    this.publish('changed', endedRow, at);
  }

  /** Oldest-ended first, and only when the cap is already reached — see `MAX_LINGERING`. */
  private evictOldestEnded(): void {
    while (this.lingering.size >= MAX_LINGERING) {
      // Insertion order IS ended order: `endInteractive` is the only writer and it appends.
      const oldest = this.lingering.keys().next();
      if (oldest.done === true) return;
      this.lingering.delete(oldest.value);
      this.known.delete(oldest.value);
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
