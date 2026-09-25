// Starting and stopping core's timers, in the one order that works — P1-T4 onward.
//
// Lifted out of `main.ts` because it is not composition: that file says what is built from what,
// and this says what has to stop before what. Every line below is a bug that was fixed once, and
// the sequence is the only documentation of it that cannot go stale — a test in
// `core-server.test.ts` pins the two that are load-bearing.
//
// **`startCore` exists because its absence was a real bug, found in P2-T4 by running the thing.**
// The two feeds with timers are started by the caller rather than by `buildCore`, so that a core
// which failed to bind leaves nothing sweeping (core/main.ts says so on both fields). The caller
// started ONE of them: `scripts/flightdeck-core.ts` called `reconciler.start()` and never
// `transcripts.start()`, so from P1-T7 until this task feed 4 tracked every transcript it was told
// about and read none of them. Nothing looked wrong — `/status` printed `4 transcripts · 0 ignored
// · 0 unknown`, which is exactly what a healthy idle feed prints — and every `TranscriptDigest`
// stayed EMPTY, which is what P2-T4's expanded row reads. A start that mirrors the stop is the fix:
// one list, two directions, and `tests/core/lifecycle.test.ts` asserts they cover the same set.
import type { PaneRegistry } from './application/pane-registry.ts';
import type { Reconciler } from './application/reconciler.ts';
import type { ToastAnnouncer } from './application/toast-announcer.ts';
import type { TicketOffice } from './application/ticket-office.ts';
import type { TokenIssuer } from './application/token-issuer.ts';
import type { TranscriptIndexer } from './application/transcript-indexer.ts';
import type { TranscriptReader } from './application/transcript-reader.ts';
import type { SqliteStore } from './adapters/sqlite/sqlite-store.ts';
import type { CoreServer } from './http/core-server.ts';
import type { PtySocketServer } from './http/pty-socket-server.ts';
import type { SessionStreamRoute } from './http/session-stream-route.ts';
import type { Logger } from './ports/logger.ts';

/** Everything that has to be let go of on the way out. The ORDER is the documentation. */
export interface Running {
  readonly reconciler: Reconciler;
  readonly transcripts: TranscriptReader;
  /** P7-T1's five-minute walk. A timer, so it is here for the reason everything here is. */
  readonly indexer: TranscriptIndexer;
  readonly toasts: ToastAnnouncer;
  readonly store: SqliteStore;
  readonly stream: SessionStreamRoute;
  readonly issuer: TokenIssuer;
  readonly tickets: TicketOffice;
  readonly sockets: PtySocketServer;
  readonly panes: PaneRegistry;
  readonly server: CoreServer;
  readonly logger: Logger;
}

/**
 * Starts the timers `buildCore` deliberately left stopped. Idempotent, as both `start`s are.
 *
 * Called once `listen` has succeeded and never before — see the header, and the JSDoc on
 * `Core.reconciler`. The pairing with `stopCore` is the point: anything that gains a timer gains a
 * line here and a line there, and the test refuses a `Running` field that has one and is missed.
 */
export function startCore(running: StartableCore): void {
  // The 10 s sweep and the `fs.watch` nudge (D3 feeds 3 and 5).
  running.reconciler.start();
  // Feed 4's 1 s poll. The line whose absence cost P1-T7 its whole output — see the header.
  running.transcripts.start();
  // P6-T3. No timer of its own — it is a listener on the hub — and it is here anyway, because the
  // thing this pairing actually protects against is something startable being left unstarted, and
  // an announcer nobody started is a feature that silently does not exist. That is the P1-T7 shape
  // exactly: nothing throws, nothing looks wrong, and no toast is ever raised.
  running.toasts.start();
  // P7-T1's five-minute walk, plus one pass now — which is what makes a fresh store searchable
  // without waiting for the first tick.
  running.indexer.start();
}

/** A thing with a timer to start. Structural, so a test can supply a counter and not a Reconciler. */
export interface Startable {
  start(): void;
}

/**
 * What `startCore` needs, which is far less than a `Running`.
 *
 * Narrow on purpose: this is the list of things with timers, and nothing else about them matters
 * here. Typing the fields as `Reconciler` and `TranscriptReader` would make the list impossible to
 * test without constructing both — a session source, a watcher, a scheduler, a file reader and a
 * policy — to prove that two methods were called.
 */
export interface StartableCore {
  readonly reconciler: Startable;
  readonly transcripts: Startable;
  readonly toasts: Startable;
  readonly indexer: Startable;
}

/** Stops core. Idempotent, because every step below is. */
export async function stopCore(running: Running): Promise<void> {
  // First, because NodeScheduler does not unref: a live sweep timer keeps the loop alive and the
  // process would never exit.
  running.reconciler.stop();
  // Same reason, same sentence: another timer NodeScheduler does not unref.
  running.transcripts.stop();
  // Not a timer but a subscription, and it is unsubscribed for the neighbouring reason: an
  // announcer left listening is a `subscriberCount` that never comes back down, and a closed
  // stream that is still counted is the leak `EventHub` exists to make visible.
  running.toasts.stop();
  // The third timer NodeScheduler does not unref, and the one that would hold the loop open with
  // a walk of 374 files in flight.
  running.indexer.stop();
  // Second, and BEFORE the server, which is not interchangeable: `server.close()` waits for open
  // connections to end and an SSE response never does on its own, so a single deck tab would hold
  // core open through Ctrl+C. Closing the streams afterwards would not rescue it either —
  // `close()` reaps idle connections once, on the way in, and stops the interval that would reap
  // them later, so a stream that ends after that leaves a keep-alive socket nothing collects.
  // Measured, and pinned by two tests in core-server.test.ts.
  running.stream.closeAll();
  running.issuer.revoke();
  // An outstanding ticket must not outlive the token that authorised minting it.
  running.tickets.revokeAll();
  running.sockets.close();
  // Panes before the socket server would leave clients holding a dead attach; this order closes
  // the sockets first, then kills what they were attached to.
  running.panes.closeAll();
  await running.server.close();
  // Last: everything above may still be writing an event on its way out, and a closed handle
  // would turn an orderly shutdown into a dropped event plus an error line.
  running.store.close();
  running.logger.info('core_stopped');
}
