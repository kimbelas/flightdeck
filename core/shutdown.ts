// Letting go of core, in the one order that works — P1-T4 onward.
//
// Lifted out of `main.ts` because it is not composition: that file says what is built from what,
// and this says what has to stop before what. Every line below is a bug that was fixed once, and
// the sequence is the only documentation of it that cannot go stale — a test in
// `core-server.test.ts` pins the two that are load-bearing.
import type { PaneRegistry } from './application/pane-registry.ts';
import type { Reconciler } from './application/reconciler.ts';
import type { TicketOffice } from './application/ticket-office.ts';
import type { TokenIssuer } from './application/token-issuer.ts';
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
  readonly store: SqliteStore;
  readonly stream: SessionStreamRoute;
  readonly issuer: TokenIssuer;
  readonly tickets: TicketOffice;
  readonly sockets: PtySocketServer;
  readonly panes: PaneRegistry;
  readonly server: CoreServer;
  readonly logger: Logger;
}

/** Stops core. Idempotent, because every step below is. */
export async function stopCore(running: Running): Promise<void> {
  // First, because NodeScheduler does not unref: a live sweep timer keeps the loop alive and the
  // process would never exit.
  running.reconciler.stop();
  // Same reason, same sentence: another timer NodeScheduler does not unref.
  running.transcripts.stop();
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
