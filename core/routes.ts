// Every path core answers, in one list — lifted out of `main.ts` in P3-T1.
//
// `feeds.ts`, `reads.ts` and `projects.ts`'s fourth sibling, and split for the reason all three
// were: `main.ts` has a 250-line limit and reached it, and of what it does, this is a piece with a
// story of its own. The feeds are what NOTICES things, `reads.ts` is what ANSWERS a question about
// one, `projects.ts` is what decides WHERE core may look, and this is the table that says what is
// reachable at all. It is also the list that grows with every phase, which is what made `main.ts`
// run out of room adding three rows to it.
//
// **There are no patterns and no prefixes.** `RequestRouter` matches method and path literally, so
// no handler is reachable by a path that merely starts like an allowed one — the class of bug that
// turns `/sessions` into `/sessions/../../token`. That is a structural control rather than a style,
// and it is why the list below is spelled out rather than generated.
import { HealthRoute } from './http/health-route.ts';
import { HooksRoute } from './http/hooks-route.ts';
import { KeybindingPlanRoute, KeybindingWriteRoute } from './http/keybindings-route.ts';
import { AskRoute } from './http/ask-route.ts';
import { ConnectPlanRoute, ConnectWriteRoute } from './http/connect-routes.ts';
import { DoctorRoute, RespawnRoute, UpdateRoute } from './http/install-routes.ts';
import { GroupLaunchRoute, type GroupStarter } from './http/group-route.ts';
import { AdoptRoute, type SessionAdopterPort } from './http/adopt-route.ts';
import { SearchRoute, type TranscriptSearch } from './http/search-route.ts';
import { OtlpLogsRoute, OtlpMetricsRoute, type OtlpRouteParts } from './http/otlp-routes.ts';
import { TelemetryRoute } from './http/telemetry-route.ts';
import { HandoffRoute, type SessionForker } from './http/handoff-route.ts';
import { LaunchRoute } from './http/launch-route.ts';
import { MutesReadRoute, MutesWriteRoute } from './http/mutes-route.ts';
import { PasteRoute } from './http/paste-route.ts';
import { PreviewRoute, type PreviewSource } from './http/preview-route.ts';
import { RequestRouter } from './http/request-router.ts';
import { RemoveRoute } from './http/remove-route.ts';
import { ResumeRoute } from './http/resume-route.ts';
import { PopoutRoute } from './http/popout-route.ts';
import { StopRoute } from './http/stop-route.ts';
import type { Route } from './http/route.ts';
import { SessionDetailRoute, type DetailSource } from './http/session-detail-route.ts';
import { SessionsRoute } from './http/sessions-route.ts';
import { StatusRoute } from './http/status-route.ts';
import { StatuslineRoute } from './http/statusline-route.ts';
import { TicketRoute } from './http/ticket-route.ts';
import type { RateLimiter } from './http/rate-limiter.ts';
import type { AuditLog } from './application/audit-log.ts';
import type { Connector } from './application/connector.ts';
import type { DeckQuery } from './application/deck-query.ts';
import type { KeybindingHelper } from './application/keybinding-helper.ts';
import type { PasteInbox } from './application/paste-inbox.ts';
import type { AskRunner } from './application/ask-runner.ts';
import type { InstallDoctor } from './application/install-doctor.ts';
import type { SessionRespawner } from './application/session-respawner.ts';
import type { SessionLauncher } from './application/session-launcher.ts';
import type { SessionResumer } from './application/session-resumer.ts';
import type { SessionRemover } from './application/session-remover.ts';
import type { SessionPopper } from './application/session-popper.ts';
import type { SessionStopper } from './application/session-stopper.ts';
import type { StatusReport } from './application/status-report.ts';
import { SubscriptionPaths } from './application/subscription-paths.ts';
import type { TicketOffice } from './application/ticket-office.ts';
import type { ClaudeInstall } from './adapters/claude-cli/claude-install.ts';
import type { Feeds } from './feeds.ts';
import type { Logger } from './ports/logger.ts';

export interface RouterParts {
  readonly feeds: Feeds;
  readonly version: string;
  readonly report: StatusReport;
  readonly detail: DetailSource;
  readonly preview: PreviewSource;
  readonly deck: DeckQuery;
  /**
   * The transcript index, asked a question — P7-T1, SPEC §5.8.
   *
   * The `Store` narrowed to one method, for `SessionForker`'s reason: a route that took the whole
   * store could write to the event log, and this one only ever reads.
   */
  readonly search: TranscriptSearch;
  readonly launcher: SessionLauncher;
  readonly resumer: SessionResumer;
  readonly stopper: SessionStopper;
  /** Hands a session to Windows Terminal, detaching the pane first — P6-T2. */
  readonly popper: SessionPopper;
  /**
   * Starts a whole preset group on one press — P6-T4, D17.
   *
   * Its own field rather than something derived from `launcher` here, because deciding what a
   * group IS needs the preset book, and the composition root is where the one book lives
   * (`projects.ts`).
   */
  readonly groups: GroupStarter;
  /**
   * Forks a session into a new working tree — P6-T6, SPEC §6(8).
   *
   * Its own field beside `resumer` rather than folded into it: a resume wakes a session under its
   * own id and a handoff makes a second one, and the two are one word apart in English.
   */
  readonly forker: SessionForker;
  /**
   * Brings an ended interactive session back as a background one — P6-T7, SPEC §4.3.
   *
   * Its own field beside `resumer` for `forker`'s reason and a sharper one: the argv is the same
   * two flags, and what differs is where core gets the folder from (`SessionAdopter`). One field
   * doing both would hide exactly that.
   */
  readonly adopter: SessionAdopterPort;
  /** The one verb that destroys something — its own route, and its own confirm in the deck (P4-T2). */
  readonly remover: SessionRemover;
  /** One headless question at a time, streamed onto `/stream` (P4-T4, D47, D48). */
  readonly asker: AskRunner;
  /** The version chip's three verbs — P4-T5. */
  readonly respawner: SessionRespawner;
  readonly doctor: InstallDoctor;
  readonly tickets: TicketOffice;
  readonly paste: PasteInbox;
  readonly keybindings: KeybindingHelper;
  /** Connect and Disconnect, planned then written — P4-T6. The write audits; the plan does not. */
  readonly connector: Connector;
  readonly audit: AuditLog;
  readonly limiter: RateLimiter;
  readonly install: ClaudeInstall;
  readonly logger: Logger;
}

/**
 * The router.
 *
 * @param extra routes a slice of its own already built — `projectRoutes` today (P3-T1). Spread in
 * rather than listed, because the three project routes share one registry and constructing them
 * here would mean constructing a second one; "which folders may be read" is not a question two
 * objects may answer differently.
 */
export function buildRouter(parts: RouterParts, extra: readonly Route[]): RequestRouter<Route> {
  return new RequestRouter<Route>([
    new HealthRoute(parts.version),
    new SessionsRoute(parts.deck),
    new SessionDetailRoute(parts.detail),
    // Its own route and not a field on the detail: a preview spawns `claude.exe` (P5a-T4).
    new PreviewRoute(parts.preview),
    // P7-T1. A read of the index and nothing else — the filters SPEC §5.8 lists are P7-T2's.
    new SearchRoute(parts.search),
    new StatusRoute(parts.report),
    ...sessionRoutes(parts),
    // P4-T5. The read is a GET and writes no audit row; the two writes are POSTs and do.
    new DoctorRoute(parts.doctor),
    new UpdateRoute(parts.doctor),
    new RespawnRoute(parts.respawner),
    new TicketRoute(parts.tickets),
    new PasteRoute(parts.paste),
    // Two routes on one path: the GET cannot write and the POST re-plans from disk (P5a-T7).
    new KeybindingPlanRoute(parts.keybindings),
    new KeybindingWriteRoute(parts.keybindings),
    // The same two-routes-one-path shape, for the writer that started it — P4-T6, D13.
    new ConnectPlanRoute(parts.connector),
    new ConnectWriteRoute(parts.connector, parts.audit),
    // And a third time, for the switch on every pane — P6-T3. No audit row: a mute changes
    // nothing outside Flightdeck's own database, which is what SEC-PROC-3 records.
    new MutesReadRoute(parts.feeds.mutes),
    new MutesWriteRoute(parts.feeds.mutes),
    ...extra,
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
    ...telemetryRoutes({
      tally: parts.feeds.telemetry,
      limiter: parts.limiter,
      logger: parts.logger,
    }),
  ]);
}

/**
 * The optional OTLP receiver — P7-T5 — and the read of what it summed.
 *
 * **The switch is here, as the presence of two rows**, rather than a flag each route checks: a
 * path that is not in the table cannot be reached by any request, which is a stronger "off" than a
 * handler remembering to refuse. The read is always a row, so "off" can be asked about.
 */
export function telemetryRoutes(receiver: OtlpRouteParts): readonly Route[] {
  const read = new TelemetryRoute(receiver.tally);
  if (!receiver.tally.enabled) return [read];
  return [read, new OtlpMetricsRoute(receiver), new OtlpLogsRoute(receiver)];
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

/**
 * The seven verbs that act on a SESSION, as their own list.
 *
 * Lifted out of `buildRouter` when the seventh arrived and pushed it over its line limit (P6-T6),
 * and they are the coherent piece: each is a POST on its own literal path that starts, wakes,
 * forks, ends or hands over one session. Everything left in `buildRouter` answers a question
 * about the machine instead.
 *
 * **The order is not alphabetical and is not accidental.** `launch`, `resume`, `adopt` and
 * `handoff` make a session exist or usable; `stop` and `rm` end one; `popout` and `group` are the two that do something to
 * more than one thing at a time. Reading them in that order is how somebody works out which verb
 * they want — and `rm` sits alone at the end with the comment that says why.
 */
function sessionRoutes(parts: RouterParts): readonly Route[] {
  return [
    new LaunchRoute(parts.launcher),
    new ResumeRoute(parts.resumer),
    // What `resume` is for a session that was never a `--bg` job — P6-T7, SPEC §4.3.
    new AdoptRoute(parts.adopter),
    // The only verb in the table that ADDS a session without being able to lose one — P6-T6.
    new HandoffRoute(parts.forker),
    new StopRoute(parts.stopper),
    new PopoutRoute(parts.popper),
    // The most expensive verb in the table, and its own row for that reason — P6-T4. One press
    // starts N sessions and spends N first turns of the 5-hour window.
    new GroupLaunchRoute(parts.groups),
    // Its own literal path, so no typo turns a stop into a delete — see the route's header.
    new RemoveRoute(parts.remover),
    // 202 and a run id; the answer arrives as `ask` frames on the stream, not down this body.
    new AskRoute(parts.asker),
  ];
}
