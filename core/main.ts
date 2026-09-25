// The composition root — the only place real adapters are constructed (CODING-STANDARDS.md §2).
//
// It returns the assembled service rather than starting it, so a test can build the whole graph
// against fakes and `scripts/flightdeck-core.ts` can own the printing. No DI container, no
// globals: everything below is constructor injection, read top to bottom.
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ingestKeyFile } from '../contracts/ingest-key.ts';
import { storeFile } from '../contracts/store-file.ts';
import { CORE_PORT, UI_ORIGIN } from '../contracts/origins.ts';
import { DeckQuery } from './application/deck-query.ts';
import { IngestKeyIssuer } from './application/ingest-key-issuer.ts';
import { PaneRegistry } from './application/pane-registry.ts';
import { type Reconciler } from './application/reconciler.ts';
import { type TranscriptIndexer } from './application/transcript-indexer.ts';
import { AuditLog } from './application/audit-log.ts';
import { StatusReport } from './application/status-report.ts';
import { type ToastAnnouncer } from './application/toast-announcer.ts';
import { type TranscriptReader } from './application/transcript-reader.ts';
import { type VitalsRegistry } from './application/vitals-registry.ts';
import { TicketOffice } from './application/ticket-office.ts';
import { TokenIssuer } from './application/token-issuer.ts';
import { ClaudeCliSessionSource } from './adapters/claude-cli/claude-cli-session-source.ts';
import { ClaudeInstall } from './adapters/claude-cli/claude-install.ts';
import { ExecFileProcessRunner } from './adapters/claude-cli/execfile-process-runner.ts';
import { ConsoleLogger } from './adapters/console-logger.ts';
import { SqliteStore } from './adapters/sqlite/sqlite-store.ts';
import type { Store } from './ports/store.ts';
import { NodePtyHost } from './adapters/node-pty/node-pty-host.ts';
import { WindowsPtyCommands } from './adapters/windows/windows-pty-commands.ts';
import { WindowsFileAcl } from './adapters/windows/windows-file-acl.ts';
import { WindowsTokenFile } from './adapters/windows/windows-token-file.ts';
import { CoreServer } from './http/core-server.ts';
import { BUDGETS } from './http/limits.ts';
import { LoopbackGuard } from './http/loopback-guard.ts';
import { KeybindingHelper } from './application/keybinding-helper.ts';
import { buildConnector } from './connect.ts';
import { PasteInbox } from './application/paste-inbox.ts';
import { BackingUpConfigFile } from './adapters/node/backing-up-config-file.ts';
import { FsPastedImageStore } from './adapters/node/fs-pasted-image-store.ts';
import { RateLimiter } from './http/rate-limiter.ts';
import { PtySocketServer } from './http/pty-socket-server.ts';
import { RequestRouter } from './http/request-router.ts';
import type { StreamRoute } from './http/route.ts';
import { warmUp } from './http/warm-up.ts';
import { buildFeeds, type Feeds } from './feeds.ts';
import { buildAsker, sessionSlice } from './verbs.ts';
import { buildRouter, type RouterParts } from './routes.ts';
import { projectSlice, type ProjectSlice } from './projects.ts';
import { buildDetailReader, buildPreviewReader } from './reads.ts';
import { stopCore } from './shutdown.ts';
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
  /**
   * What the transcripts add to what the documented feeds already said (P1-T7).
   *
   * Started by the caller, like the reconciler, and for the same reason: a core that failed to
   * bind must not leave a timer opening files every second for a service nobody can reach.
   */
  readonly transcripts: TranscriptReader;
  /**
   * The Windows toasts (P6-T3). Started by the caller, like the two above and for the same reason.
   *
   * It owns no timer — it is a listener on the hub — and it is still handed back rather than
   * subscribed at construction, because `startCore` is the list of things that would otherwise be
   * left unstarted, and a core that never bound must raise nothing.
   */
  readonly toasts: ToastAnnouncer;
  /**
   * The transcript search index — P7-T1. Started by `startCore` for `transcripts`' reason: it
   * owns a five-minute timer, and one nobody started is a search box that finds nothing.
   */
  readonly indexer: TranscriptIndexer;
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
  // SEC-FS-4, first, because everything below writes into this directory: the token, the ingest
  // key and the database. The reason it is the DIRECTORY and not each file is that SQLite writes
  // `flightdeck.db-wal` and `-shm` beside the database after anything could have restricted the
  // database, and the WAL holds the most recently committed rows — hook payloads included
  // (P1-T12; P1-T8 shipped the store with no ACL at all).
  restrictDataDirectory();
  const { tokenFile, issuer, token, ingestKey } = issueSecrets();

  const { install, runner, clock, sessions } = buildAdapters(logger);
  // Opened before the feeds, because they are constructed around it — and before `listen`, so a
  // store that cannot be opened stops core at boot rather than on the first hook.
  const store = new SqliteStore(storeFile());
  const feeds = buildFeeds({ install, sessions, store, clock, logger });
  // SEC-PROC-3: every mutating action writes a row, and `POST /launch` is the only one today.
  const audit = new AuditLog(store, clock, logger);
  // Built before the server binds, because an imported root is a security input: a route that
  // could be reached while the registry was still empty would refuse a project the owner has.
  // ONE registry, behind the eight routes and behind a shell pane that starts in an imported
  // folder (P6-T1) — which is why the slice hands both back. A second would be a second copy of
  // the roots, and "which folders may be read" is not a question two objects may answer.
  const projects = projectSlice({ install, store, audit, runner, clock, logger });
  const version = readVersion();
  const http = buildHttp({
    guard: buildGuard(token, ingestKey),
    feeds,
    audit,
    projects,
    // Read once and handed to both routes that print it, rather than read twice: `/health` and
    // `/status` disagreeing about which build is running would be a very silly bug to have.
    version,
    report: buildReport({ version, store, audit, feeds, tokenFile, install }),
    sessions,
    store,
    runner,
    clock,
    install,
    logger,
  });
  return {
    server: http.server,
    reconciler: feeds.reconciler,
    vitals: feeds.vitals,
    transcripts: feeds.transcripts,
    toasts: feeds.toasts,
    indexer: feeds.indexer,
    store,
    logger,
    tokenPath: tokenFile.location(),
    ingestKeyPath: ingestKeyFile(),
    claudePath: install.executable,
    warmUp: () => warmUp(token, logger),
    // Built inside the closure rather than on a line of its own above, because this function is at
    // its 40-line limit and P6-T3 needed one of them. It costs nothing: every field is an object
    // already constructed above, `stopCore` is the only caller, and it is idempotent — so a list
    // assembled per call and a list assembled once are the same list.
    shutdown: () => stopCore({ ...http, ...feeds, store, issuer, logger }),
  };
}

interface Secrets {
  readonly tokenFile: WindowsTokenFile;
  readonly issuer: TokenIssuer;
  readonly token: string;
  readonly ingestKey: string;
}

/**
 * The two secrets, which differ in exactly one way that matters: one is per boot and one is not.
 *
 * The token is issued fresh and revoked on shutdown (SEC-HTTP-3). The ingest key is read-or-create
 * and is NOT revoked — it is the one secret that outlives the process, so a session that started
 * three restarts ago still authenticates its hooks (SEC-HTTP-7, RESEARCH.md F.1.7).
 */
function issueSecrets(): Secrets {
  const tokenFile = new WindowsTokenFile();
  const issuer = new TokenIssuer(tokenFile);
  const token = issuer.issue();
  const ingestKey = new IngestKeyIssuer(new WindowsTokenFile(ingestKeyFile())).ensure();
  return { tokenFile, issuer, token, ingestKey };
}

interface ReportParts {
  readonly version: string;
  readonly store: SqliteStore;
  readonly audit: AuditLog;
  readonly feeds: Feeds;
  readonly tokenFile: WindowsTokenFile;
  readonly install: ClaudeInstall;
}

/**
 * The five in-memory counters the last five tasks left behind, gathered into one answer.
 *
 * A function here rather than in `StatusReport` itself, because choosing *which* store, audit log
 * and registry it reports on is composition, and a class that found its own collaborators would be
 * a service locator (CODING-STANDARDS §2).
 */
function buildReport(parts: ReportParts): StatusReport {
  return new StatusReport({
    version: parts.version,
    store: { path: storeFile(), version: parts.store.version },
    events: parts.feeds.storing,
    audit: parts.audit,
    transcripts: parts.feeds.transcripts,
    vitals: parts.feeds.vitals,
    tokenPath: parts.tokenFile.location(),
    ingestKeyPath: ingestKeyFile(),
    claudePath: parts.install.executable,
  });
}

/** Everything that answers a socket, and the two things shutdown has to let go of with it. */
interface HttpSide {
  readonly server: CoreServer;
  readonly sockets: PtySocketServer;
  readonly panes: PaneRegistry;
  readonly tickets: TicketOffice;
}

/**
 * The four adapters every layer below shares.
 *
 * **One install**: the panes attach with the same config dir the listing was read with, or the
 * deck shows a session a pane cannot find. **One session source**: the deck's on-demand snapshot
 * and the reconciler's timer must not be able to disagree about what `--all` means or which config
 * directory they read. Lifted out of `buildCore` for its forty-line limit, and they belong
 * together — none of the four has a decision in it.
 */
function buildAdapters(logger: Logger): {
  readonly install: ClaudeInstall;
  readonly runner: ExecFileProcessRunner;
  readonly clock: SystemClock;
  readonly sessions: ClaudeCliSessionSource;
} {
  const install = new ClaudeInstall();
  const runner = new ExecFileProcessRunner();
  return {
    install,
    runner,
    clock: new SystemClock(),
    sessions: new ClaudeCliSessionSource(install, runner, logger),
  };
}

interface HttpParts {
  readonly guard: LoopbackGuard;
  readonly feeds: Feeds;
  readonly audit: AuditLog;
  /**
   * A slice of its own already built — `projectSlice` (P3-T1, P6-T1). See `buildRouter`.
   *
   * Routes AND the registry behind them: a shell pane starts in an imported folder, so the pane
   * machinery below needs the same object the eight routes were built over.
   */
  readonly projects: ProjectSlice;
  readonly version: string;
  readonly report: StatusReport;
  readonly sessions: ClaudeCliSessionSource;
  /** The durable store. P7-T1's search route reads the transcript index out of it. */
  readonly store: Store;
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
  // Before the server, as of P6-T2: `POST /sessions/popout` detaches the pane that holds a
  // session before Windows Terminal attaches to it, because `claude attach` is last-one-wins
  // and the second attach evicts the first in silence (F.2.6). So the route needs the same
  // registry the socket server does, and there is exactly one of it.
  const panes = new PaneRegistry(
    new NodePtyHost(),
    new WindowsPtyCommands(install, parts.projects.registry),
    logger,
  );
  const server = new CoreServer({
    guard,
    router: buildRouter(
      {
        feeds,
        version: parts.version,
        report: parts.report,
        detail: buildDetailReader({ ...feeds, install, clock, logger }),
        // P5a-T4. The one reader that spawns a process per request, which is why it is asked for
        // by its own route and its own click rather than riding the detail (`preview-route.ts`).
        preview: buildPreviewReader({ ...feeds, install, runner: parts.runner, clock, logger }),
        // P6-T7. The third argument is the reconciler's memory of ended interactive
        // sessions — a sweep cannot see one, which is why it is held (`DeckQuery`).
        deck: new DeckQuery(parts.sessions, clock, feeds.reconciler),
        // P7-T1. The store, narrowed to the one method a search needs.
        search: parts.store,
        // P6-T7. `directory` is the reconciler's memory of where each session was seen — an
        // adoption runs in that folder, and the browser never names one (SEC-FS-1).
        ...sessionSlice({ ...parts, directory: feeds.reconciler }, panes),
        asker: buildAsker({ ...parts, publisher: feeds.ask }),
        tickets,
        // P5a-T8. The directory is made on first paste, not at boot: a machine where nobody has
        // ever pasted an image has no `pasted\` folder to explain.
        paste: new PasteInbox({ store: new FsPastedImageStore(), clock, logger }),
        ...configWriters(install, parts.audit, logger),
        limiter,
        install,
        logger,
      },
      parts.projects.routes,
    ),
    streams: new RequestRouter<StreamRoute>([feeds.stream]),
    limiter,
    logger,
  });
  const sockets = new PtySocketServer({ guard, panes, tickets, logger });
  sockets.attachTo(server.raw);
  return { server, sockets, panes, tickets };
}

/**
 * The two things allowed to write into `$CFG`, built together — P5a-T7 and P4-T6 (SEC-FS-3).
 *
 * Together because they are one idea rather than two neighbours: both rewrite a file the owner
 * owns, both plan before they write, both back up first, and both can take every byte back out.
 * `audit` rides along because it is what the Connect write records into and nothing else in this
 * group needs it — a reader looking for "what can change my Claude Code config, and where is that
 * written down" finds all of it here.
 */
function configWriters(
  install: ClaudeInstall,
  audit: AuditLog,
  logger: Logger,
): Pick<RouterParts, 'keybindings' | 'connector' | 'audit'> {
  return {
    // The same `ConfigFile` Connect uses — back up, write temp, atomic rename, in one class.
    keybindings: new KeybindingHelper({ install, files: new BackingUpConfigFile(), logger }),
    // Built by `connect.ts`, which `npm run connect` calls too, so the plan the panel shows and
    // the plan the terminal prints cannot come apart.
    connector: buildConnector(install, logger),
    audit,
  };
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

/**
 * Restricts `%LOCALAPPDATA%\flightdeck` to this user, creating it if it is not there.
 *
 * The directory is derived from the store's path rather than spelled again: three contracts
 * already agree about this folder and a fourth opinion is how they stop agreeing
 * (contracts/store-file.ts). It is created here rather than relied upon, so this does not depend
 * on the token having been written first — an ordering that is true today and is not a contract.
 */
function restrictDataDirectory(): void {
  const directory = dirname(storeFile());
  mkdirSync(directory, { recursive: true });
  new WindowsFileAcl().restrictDirectory(directory);
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
