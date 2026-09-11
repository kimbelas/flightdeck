// The composition root — the only place real adapters are constructed (CODING-STANDARDS.md §2).
//
// It returns the assembled service rather than starting it, so a test can build the whole graph
// against fakes and `scripts/flightdeck-core.ts` can own the printing. No DI container, no
// globals: everything below is constructor injection, read top to bottom.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CORE_PORT, UI_ORIGIN } from '../contracts/origins.ts';
import { DeckQuery } from './application/deck-query.ts';
import { EventHub } from './application/event-hub.ts';
import { PaneRegistry } from './application/pane-registry.ts';
import { Reconciler } from './application/reconciler.ts';
import { SessionLauncher } from './application/session-launcher.ts';
import { TicketOffice } from './application/ticket-office.ts';
import { TokenIssuer } from './application/token-issuer.ts';
import { ClaudeCliSessionSource } from './adapters/claude-cli/claude-cli-session-source.ts';
import { ClaudeInstall } from './adapters/claude-cli/claude-install.ts';
import { ExecFileProcessRunner } from './adapters/claude-cli/execfile-process-runner.ts';
import { ConsoleLogger } from './adapters/console-logger.ts';
import { FanOutEventSink } from './adapters/fan-out-event-sink.ts';
import { LoggingEventSink } from './adapters/logging-event-sink.ts';
import { FsDirectoryWatcher } from './adapters/node/fs-directory-watcher.ts';
import { NodeScheduler } from './adapters/node/node-scheduler.ts';
import { NodePtyHost } from './adapters/node-pty/node-pty-host.ts';
import { WindowsPtyCommands } from './adapters/windows/windows-pty-commands.ts';
import { WindowsTokenFile } from './adapters/windows/windows-token-file.ts';
import { CoreServer } from './http/core-server.ts';
import { HealthRoute } from './http/health-route.ts';
import { LaunchRoute } from './http/launch-route.ts';
import { LoopbackGuard } from './http/loopback-guard.ts';
import { PtySocketServer } from './http/pty-socket-server.ts';
import { RequestRouter } from './http/request-router.ts';
import type { Route, StreamRoute } from './http/route.ts';
import { SessionStreamRoute } from './http/session-stream-route.ts';
import { SessionsRoute } from './http/sessions-route.ts';
import { TicketRoute } from './http/ticket-route.ts';
import { SystemClock } from './ports/clock.ts';
import type { Logger } from './ports/logger.ts';

/** SEC-HTTP-4. Nothing core accepts is near this big; a hook payload is a few KB. */
const MAX_BODY_BYTES = 256 * 1024;

export interface Core {
  readonly server: CoreServer;
  /**
   * Started by the caller, not by `buildCore`, and for one reason: a core that failed to bind
   * must not leave a timer sweeping both subscriptions every ten seconds for a service nobody
   * can reach. `scripts/flightdeck-core.ts` starts it once `listen` has succeeded.
   */
  readonly reconciler: Reconciler;
  readonly logger: Logger;
  readonly tokenPath: string;
  /** Where `claude.exe` was found, or `undefined` — panes on sessions need it, shells do not. */
  readonly claudePath: string | undefined;
  /** Drops the token, closes every pane and stops listening. Idempotent. */
  shutdown(): Promise<void>;
}

/**
 * Builds core and issues this boot's token.
 *
 * Order matters: the token exists before the server can accept a request, so there is no window in
 * which a route is reachable without one (SEC-HTTP-3).
 */
export function buildCore(logger: Logger = new ConsoleLogger()): Core {
  const tokenFile = new WindowsTokenFile();
  const issuer = new TokenIssuer(tokenFile);
  const token = issuer.issue();

  // One screen for every inbound connection, promoted from the P0-T7 probe unchanged.
  const guard = new LoopbackGuard({
    port: CORE_PORT,
    uiOrigin: UI_ORIGIN,
    token,
    bodyLimitBytes: MAX_BODY_BYTES,
  });
  // One install, shared: the panes attach with the same config dir the listing was read with, or
  // the deck shows a session a pane cannot find.
  const install = new ClaudeInstall();
  const runner = new ExecFileProcessRunner();
  const clock = new SystemClock();
  // One source for both readers: the deck's on-demand snapshot and the reconciler's timer must
  // not be able to disagree about what `--all` means or which config dir they read.
  const sessions = new ClaudeCliSessionSource(install, runner, logger);
  const deck = new DeckQuery(sessions, clock);
  const launcher = new SessionLauncher(install, runner, logger);

  const { reconciler, stream } = buildFeeds(install, sessions, clock, logger);

  // The tickets the PTY socket takes in its first frame, so the token never reaches the page (D32).
  const tickets = new TicketOffice(clock);
  const server = new CoreServer({
    guard,
    router: buildRouter(deck, launcher, tickets),
    streams: new RequestRouter<StreamRoute>([stream]),
    logger,
  });

  // The PTY side rides the same server, because a WebSocket upgrade is an HTTP request until it
  // is not — one port, one screen, one place a connection can be refused.
  const panes = new PaneRegistry(new NodePtyHost(), new WindowsPtyCommands(install), logger);
  const sockets = new PtySocketServer({ guard, panes, tickets, logger });
  sockets.attachTo(server.raw);

  return {
    server,
    reconciler,
    logger,
    tokenPath: tokenFile.location(),
    claudePath: install.executable,
    shutdown: () =>
      stopCore({ reconciler, stream, issuer, tickets, sockets, panes, server, logger }),
  };
}

/** Everything that has to be let go of on the way out. The ORDER is the documentation. */
interface Running {
  readonly reconciler: Reconciler;
  readonly stream: SessionStreamRoute;
  readonly issuer: TokenIssuer;
  readonly tickets: TicketOffice;
  readonly sockets: PtySocketServer;
  readonly panes: PaneRegistry;
  readonly server: CoreServer;
  readonly logger: Logger;
}

/** Stops core. Idempotent, because every step below is. */
async function stopCore(running: Running): Promise<void> {
  // First, because NodeScheduler does not unref: a live sweep timer keeps the loop alive and the
  // process would never exit.
  running.reconciler.stop();
  // Second, and for a stricter version of the same reason: `server.close()` waits for open
  // connections to end, and an SSE response is one that never does on its own. A single deck tab
  // would hold core open through Ctrl+C.
  running.stream.closeAll();
  running.issuer.revoke();
  // An outstanding ticket must not outlive the token that authorised minting it.
  running.tickets.revokeAll();
  running.sockets.close();
  // Panes before the socket server would leave clients holding a dead attach; this order closes
  // the sockets first, then kills what they were attached to.
  running.panes.closeAll();
  await running.server.close();
  running.logger.info('core_stopped');
}

/** The two halves of the event side: what notices things, and what hands them to a browser. */
interface Feeds {
  readonly reconciler: Reconciler;
  readonly stream: SessionStreamRoute;
}

/**
 * The 10 s sweep and the `fs.watch` nudge (DECISIONS.md D3 feeds 3 and 5), and the fan-out.
 *
 * Built together because they share two things and both would be bugs if they did not. **One
 * scheduler**: the sweep, the watcher's 2 s stat poll and every stream's heartbeat run on it, so
 * there is a single place timers are created and, more to the point, cancelled — `NodeScheduler`
 * deliberately does not `unref`, and the one nobody cancelled keeps core alive after Ctrl+C.
 * **One hub**: the reconciler publishes into it without knowing who is listening, and the log is
 * still one of the listeners — an operator reading `.flightdeck-core.log` an hour later needs
 * what the browser saw, and the browser is not there an hour later (P1-T9).
 */
function buildFeeds(
  install: ClaudeInstall,
  sessions: ClaudeCliSessionSource,
  clock: SystemClock,
  logger: Logger,
): Feeds {
  const scheduler = new NodeScheduler();
  const hub = new EventHub(logger);
  const reconciler = new Reconciler({
    source: sessions,
    sink: new FanOutEventSink([new LoggingEventSink(logger), hub]),
    scheduler,
    watcher: new FsDirectoryWatcher(install.watchTargets(), scheduler, logger),
    clock,
    logger,
  });
  return {
    reconciler,
    stream: new SessionStreamRoute({ sessions: reconciler, feed: hub, scheduler, logger }),
  };
}

/** Every path core answers, in one list. There are no patterns and no prefixes (RequestRouter). */
function buildRouter(
  deck: DeckQuery,
  launcher: SessionLauncher,
  tickets: TicketOffice,
): RequestRouter<Route> {
  return new RequestRouter<Route>([
    new HealthRoute(readVersion()),
    new SessionsRoute(deck),
    new LaunchRoute(launcher),
    new TicketRoute(tickets),
  ]);
}

function readVersion(): string {
  const manifest: unknown = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'),
  );
  if (typeof manifest === 'object' && manifest !== null && 'version' in manifest) {
    const { version } = manifest;
    if (typeof version === 'string') return version;
  }
  return '0.0.0';
}
