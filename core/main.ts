// The composition root — the only place real adapters are constructed (CODING-STANDARDS.md §2).
//
// It returns the assembled service rather than starting it, so a test can build the whole graph
// against fakes and `scripts/flightdeck-core.ts` can own the printing. No DI container, no
// globals: everything below is constructor injection, read top to bottom.
import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { CORE_PORT, LOOPBACK_ADDRESS, UI_ORIGIN } from '../contracts/origins.ts';
import { DeckQuery } from './application/deck-query.ts';
import { EventHub } from './application/event-hub.ts';
import { HookQueue } from './application/hook-queue.ts';
import { StatuslineQueue } from './application/statusline-queue.ts';
import { PaneRegistry } from './application/pane-registry.ts';
import { Reconciler } from './application/reconciler.ts';
import { SessionLauncher } from './application/session-launcher.ts';
import { SubscriptionPaths } from './application/subscription-paths.ts';
import { VitalsRegistry } from './application/vitals-registry.ts';
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
import { HooksRoute } from './http/hooks-route.ts';
import { LaunchRoute } from './http/launch-route.ts';
import { BUDGETS } from './http/limits.ts';
import { LoopbackGuard } from './http/loopback-guard.ts';
import { RateLimiter } from './http/rate-limiter.ts';
import { PtySocketServer } from './http/pty-socket-server.ts';
import { RequestRouter } from './http/request-router.ts';
import type { Route, StreamRoute } from './http/route.ts';
import { SessionStreamRoute } from './http/session-stream-route.ts';
import { SessionsRoute } from './http/sessions-route.ts';
import { StatuslineRoute } from './http/statusline-route.ts';
import { TicketRoute } from './http/ticket-route.ts';
import { SystemClock } from './ports/clock.ts';
import type { Logger } from './ports/logger.ts';

export interface Core {
  readonly server: CoreServer;
  /**
   * Started by the caller, not by `buildCore`, and for one reason: a core that failed to bind
   * must not leave a timer sweeping both subscriptions every ten seconds for a service nobody
   * can reach. `scripts/flightdeck-core.ts` starts it once `listen` has succeeded.
   */
  readonly reconciler: Reconciler;
  /**
   * The newest vitals per session, from the statusLine receiver (P1-T6).
   *
   * Held in memory rather than in the store, because until P1-T8 there is no store and because
   * vitals are the newest observation rather than a record of what happened — the same reasoning
   * that keeps the live session set out of `Store` (BUILD-PLAN §3). `flightdeck-core status`
   * (P1-T12) is what prints it; P2-T3 is what draws it.
   */
  readonly vitals: VitalsRegistry;
  readonly logger: Logger;
  readonly tokenPath: string;
  /** Where `claude.exe` was found, or `undefined` — panes on sessions need it, shells do not. */
  readonly claudePath: string | undefined;
  /**
   * Makes one request against itself, so the first real one does not pay Node's HTTP warm-up.
   *
   * P0-T3 measured the first hook ack after boot at 5.37 / 8.21 ms against 0.54–1.31 ms in steady
   * state (RESEARCH.md F.1.4) — over the SEC-ING-2 budget, once, for the first session to finish a
   * turn after core starts. Called by the caller rather than by `buildCore` for the same reason the
   * reconciler is: a core that failed to bind has nothing to warm.
   *
   * @throws never — it is an optimisation, and a core that could not talk to itself is a problem
   * for `/health` to report, not a reason to refuse to start.
   */
  warmUp(): Promise<void>;
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

  const guard = buildGuard(token);
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

  const feeds = buildFeeds(install, sessions, clock, logger);
  const { reconciler, stream } = feeds;

  // The tickets the PTY socket takes in its first frame, so the token never reaches the page (D32).
  const tickets = new TicketOffice(clock);
  // SEC-HTTP-6, shared: the server spends the control budget per token, the hooks route spends the
  // ingest budget per session id, and one limiter means one place the windows live.
  const limiter = new RateLimiter(clock);
  const server = new CoreServer({
    guard,
    router: buildRouter({ feeds, deck, launcher, tickets, limiter, install, logger }),
    streams: new RequestRouter<StreamRoute>([stream]),
    limiter,
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
    vitals: feeds.vitals,
    logger,
    tokenPath: tokenFile.location(),
    claudePath: install.executable,
    warmUp: () => warmUp(token, logger),
    shutdown: () =>
      stopCore({ reconciler, stream, issuer, tickets, sockets, panes, server, logger }),
  };
}

/**
 * One `GET /health` against ourselves, awaited, with everything ignored but the timing.
 *
 * It goes over a real socket rather than calling the route directly, because what is cold is
 * Node's HTTP stack — the parser, the socket path, the first allocation — and a direct call warms
 * none of it. It spends one of the minute's 60 control requests, which is the right price.
 */
async function warmUp(token: string, logger: Logger): Promise<void> {
  const startedAt = Date.now();
  const status = await new Promise<number>((resolve) => {
    const probe = httpRequest(
      {
        host: LOOPBACK_ADDRESS,
        port: CORE_PORT,
        path: '/health',
        headers: {
          authorization: `Bearer ${token}`,
          host: `${LOOPBACK_ADDRESS}:${String(CORE_PORT)}`,
        },
      },
      (response) => {
        response.resume();
        response.on('end', () => {
          resolve(response.statusCode ?? 0);
        });
      },
    );
    probe.on('error', () => {
      resolve(0);
    });
    probe.end();
  });
  // Logged rather than discarded: a non-200 here is core failing to answer its own token, which is
  // worth knowing at boot rather than when the first hook arrives.
  logger.info('core_warm', { status, ms: Date.now() - startedAt });
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
  running.logger.info('core_stopped');
}

/**
 * One screen for every inbound connection, promoted from the P0-T7 probe unchanged.
 *
 * The body limit here is the CONTROL cap. Core enforces the per-route caps itself (limits.ts) now
 * that a hook may send 4 MB and a launch may not; this keeps the guard's own answer agreeing with
 * what the server does.
 */
function buildGuard(token: string): LoopbackGuard {
  return new LoopbackGuard({
    port: CORE_PORT,
    uiOrigin: UI_ORIGIN,
    token,
    bodyLimitBytes: BUDGETS.control.bodyBytes,
  });
}

/** The event side: what notices things, what is told about them, and what hands them to a browser. */
interface Feeds {
  readonly reconciler: Reconciler;
  readonly stream: SessionStreamRoute;
  readonly hooks: HookQueue;
  readonly statusline: StatuslineQueue;
  /** The newest vitals per session. `flightdeck-core status` (P1-T12) and P2-T3 read it. */
  readonly vitals: VitalsRegistry;
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
  const sink = new FanOutEventSink([new LoggingEventSink(logger), hub]);
  const vitals = new VitalsRegistry();
  const reconciler = new Reconciler({
    source: sessions,
    sink,
    scheduler,
    watcher: new FsDirectoryWatcher(install.watchTargets(), scheduler, logger),
    clock,
    logger,
  });
  return {
    reconciler,
    stream: new SessionStreamRoute({ sessions: reconciler, feed: hub, scheduler, logger }),
    // A hook publishes into the same sink and then asks the reconciler to look — evidence that
    // something happened, never a claim about what is true now (D3, P1-T5).
    hooks: new HookQueue({ sink, trigger: reconciler, scheduler, clock, logger }),
    // The statusLine posts on every render and asks for nothing: it records vitals and publishes
    // only when they moved. No nudge — a sweep per repaint would be `agents --json` twice a
    // second for news that is already in the payload (P1-T6).
    statusline: new StatuslineQueue({ sink, registry: vitals, scheduler, clock, logger }),
    vitals,
  };
}

interface RouterParts {
  readonly feeds: Feeds;
  readonly deck: DeckQuery;
  readonly launcher: SessionLauncher;
  readonly tickets: TicketOffice;
  readonly limiter: RateLimiter;
  readonly install: ClaudeInstall;
  readonly logger: Logger;
}

/** Every path core answers, in one list. There are no patterns and no prefixes (RequestRouter). */
function buildRouter(parts: RouterParts): RequestRouter<Route> {
  return new RequestRouter<Route>([
    new HealthRoute(readVersion()),
    new SessionsRoute(parts.deck),
    new LaunchRoute(parts.launcher),
    new TicketRoute(parts.tickets),
    new HooksRoute({
      queue: parts.feeds.hooks,
      paths: subscriptionPaths(parts.install),
      limiter: parts.limiter,
      logger: parts.logger,
    }),
    new StatuslineRoute({
      queue: parts.feeds.statusline,
      paths: subscriptionPaths(parts.install),
      limiter: parts.limiter,
      logger: parts.logger,
    }),
  ]);
}

/**
 * The two config dirs as data, so an ingested payload is attributed to the subscription whose
 * directory its transcript lives under rather than to one it claims (SEC-FS-1, SEC-ING-1).
 */
function subscriptionPaths(install: ClaudeInstall): SubscriptionPaths {
  return new SubscriptionPaths({
    '365': install.configDirFor('365'),
    isg: install.configDirFor('isg'),
  });
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
