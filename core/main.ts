// The composition root — the only place real adapters are constructed (CODING-STANDARDS.md §2).
//
// It returns the assembled service rather than starting it, so a test can build the whole graph
// against fakes and `scripts/flightdeck-core.ts` can own the printing. No DI container, no
// globals: everything below is constructor injection, read top to bottom.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ingestKeyFile } from '../contracts/ingest-key.ts';
import { storeFile } from '../contracts/store-file.ts';
import { CORE_PORT, UI_ORIGIN } from '../contracts/origins.ts';
import { DeckQuery } from './application/deck-query.ts';
import { EventHub } from './application/event-hub.ts';
import { HookQueue } from './application/hook-queue.ts';
import { IngestKeyIssuer } from './application/ingest-key-issuer.ts';
import { StatuslineQueue } from './application/statusline-queue.ts';
import { PaneRegistry } from './application/pane-registry.ts';
import { Reconciler } from './application/reconciler.ts';
import { SessionLauncher } from './application/session-launcher.ts';
import { AuditLog } from './application/audit-log.ts';
import { SubscriptionPaths } from './application/subscription-paths.ts';
import { TranscriptReader } from './application/transcript-reader.ts';
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
import { FsTranscriptFile } from './adapters/node/fs-transcript-file.ts';
import { SqliteStore } from './adapters/sqlite/sqlite-store.ts';
import { StoringEventSink } from './adapters/storing-event-sink.ts';
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
import { warmUp } from './http/warm-up.ts';
import { stopCore, type Running } from './shutdown.ts';
import { SystemClock } from './ports/clock.ts';
import type { Logger } from './ports/logger.ts';
import type { Store } from './ports/store.ts';

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
  /**
   * What the transcripts add to what the documented feeds already said (P1-T7).
   *
   * Started by the caller, like the reconciler, and for the same reason: a core that failed to
   * bind must not leave a timer opening files every second for a service nobody can reach.
   */
  readonly transcripts: TranscriptReader;
  /**
   * The durable log (P1-T8). Closed by `shutdown`.
   *
   * The only thing here that outlives both the process and the transcripts it describes:
   * `cleanupPeriodDays` deletes those after thirty days, so for anything older this file is the
   * whole history (D9).
   */
  readonly store: SqliteStore;
  readonly logger: Logger;
  readonly tokenPath: string;
  /** Where the stable ingest key lives, for `flightdeck-core status` and Connect (SEC-HTTP-7). */
  readonly ingestKeyPath: string;
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
  // Read-or-create, and NOT revoked on shutdown — the one secret that outlives the process, so a
  // session that started three restarts ago still authenticates its hooks (SEC-HTTP-7, F.1.7).
  const ingestKey = new IngestKeyIssuer(new WindowsTokenFile(ingestKeyFile())).ensure();

  // One install, shared: the panes attach with the same config dir the listing was read with, or
  // the deck shows a session a pane cannot find.
  const install = new ClaudeInstall();
  const runner = new ExecFileProcessRunner();
  const clock = new SystemClock();
  // One source for both readers: the deck's on-demand snapshot and the reconciler's timer must
  // not be able to disagree about what `--all` means or which config dir they read.
  const sessions = new ClaudeCliSessionSource(install, runner, logger);
  // Opened before the feeds, because they are constructed around it — and before `listen`, so a
  // store that cannot be opened stops core at boot rather than on the first hook.
  const store = new SqliteStore(storeFile());
  const feeds = buildFeeds({ install, sessions, store, clock, logger });
  const http = buildHttp({
    guard: buildGuard(token, ingestKey),
    feeds,
    // SEC-PROC-3: every mutating action writes a row, and `POST /launch` is the only one today.
    audit: new AuditLog(store, clock, logger),
    sessions,
    runner,
    clock,
    install,
    logger,
  });
  const running: Running = { ...http, ...feeds, store, issuer, logger };

  return {
    server: http.server,
    reconciler: feeds.reconciler,
    vitals: feeds.vitals,
    transcripts: feeds.transcripts,
    store,
    logger,
    tokenPath: tokenFile.location(),
    ingestKeyPath: ingestKeyFile(),
    claudePath: install.executable,
    warmUp: () => warmUp(token, logger),
    shutdown: () => stopCore(running),
  };
}

/** Everything that answers a socket, and the two things shutdown has to let go of with it. */
interface HttpSide {
  readonly server: CoreServer;
  readonly sockets: PtySocketServer;
  readonly panes: PaneRegistry;
  readonly tickets: TicketOffice;
}

interface HttpParts {
  readonly guard: LoopbackGuard;
  readonly feeds: Feeds;
  readonly audit: AuditLog;
  readonly sessions: ClaudeCliSessionSource;
  readonly runner: ExecFileProcessRunner;
  readonly clock: SystemClock;
  readonly install: ClaudeInstall;
  readonly logger: Logger;
}

/**
 * The HTTP and WebSocket side, built together because it is one server.
 *
 * The PTY side rides it rather than binding its own port, because a WebSocket upgrade is an HTTP
 * request until it is not — one port, one screen, one place a connection can be refused.
 */
function buildHttp(parts: HttpParts): HttpSide {
  const { guard, feeds, clock, install, logger } = parts;
  // The tickets the PTY socket takes in its first frame, so the token never reaches the page (D32).
  const tickets = new TicketOffice(clock);
  // SEC-HTTP-6, shared: the server spends the control budget per token, the hooks route spends the
  // ingest budget per session id, and one limiter means one place the windows live.
  const limiter = new RateLimiter(clock);
  const server = new CoreServer({
    guard,
    router: buildRouter({
      feeds,
      deck: new DeckQuery(parts.sessions, clock),
      launcher: new SessionLauncher({
        install,
        runner: parts.runner,
        audit: parts.audit,
        logger,
      }),
      tickets,
      limiter,
      install,
      logger,
    }),
    streams: new RequestRouter<StreamRoute>([feeds.stream]),
    limiter,
    logger,
  });
  const panes = new PaneRegistry(new NodePtyHost(), new WindowsPtyCommands(install), logger);
  const sockets = new PtySocketServer({ guard, panes, tickets, logger });
  sockets.attachTo(server.raw);
  return { server, sockets, panes, tickets };
}

/**
 * One screen for every inbound connection, promoted from the P0-T7 probe unchanged.
 *
 * The body limit here is the CONTROL cap. Core enforces the per-route caps itself (limits.ts) now
 * that a hook may send 4 MB and a launch may not; this keeps the guard's own answer agreeing with
 * what the server does.
 */
function buildGuard(token: string, ingestKey: string): LoopbackGuard {
  return new LoopbackGuard({
    port: CORE_PORT,
    uiOrigin: UI_ORIGIN,
    token,
    ingestKey,
    bodyLimitBytes: BUDGETS.control.bodyBytes,
  });
}

/** The event side: what notices things, what is told about them, and what hands them to a browser. */
interface Feeds {
  readonly reconciler: Reconciler;
  readonly stream: SessionStreamRoute;
  readonly hooks: HookQueue;
  readonly statusline: StatuslineQueue;
  readonly transcripts: TranscriptReader;
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
interface FeedParts {
  readonly install: ClaudeInstall;
  readonly sessions: ClaudeCliSessionSource;
  readonly store: Store;
  readonly clock: SystemClock;
  readonly logger: Logger;
}

function buildFeeds(parts: FeedParts): Feeds {
  const { install, sessions, store, clock, logger } = parts;
  const scheduler = new NodeScheduler();
  const hub = new EventHub(logger);
  // Feed 4 rides the fan-out as a SUBSCRIBER, not as a producer: it learns which transcripts are
  // live from the `transcript_path` the hook and statusLine payloads already carry, so nothing
  // walks 1.1 GB of `projects/` looking for them and no existing class had to change (P1-T7).
  const transcripts = new TranscriptReader({
    file: new FsTranscriptFile(),
    scheduler,
    logger,
  });
  // Four listeners, and none of them is redundant: the log is what an operator reads an hour
  // later, the hub is what a browser sees now, the store is what can still answer next month, and
  // the transcript reader is only here to learn which files are live (P1-T7).
  const sink = new FanOutEventSink([
    new LoggingEventSink(logger),
    hub,
    new StoringEventSink(store, logger),
    transcripts,
  ]);
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
    transcripts,
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
