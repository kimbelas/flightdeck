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
import { LaunchRoute } from './http/launch-route.ts';
import { RequestRouter } from './http/request-router.ts';
import { ResumeRoute } from './http/resume-route.ts';
import { StopRoute } from './http/stop-route.ts';
import type { Route } from './http/route.ts';
import { SessionDetailRoute, type DetailSource } from './http/session-detail-route.ts';
import { SessionsRoute } from './http/sessions-route.ts';
import { StatusRoute } from './http/status-route.ts';
import { StatuslineRoute } from './http/statusline-route.ts';
import { TicketRoute } from './http/ticket-route.ts';
import type { RateLimiter } from './http/rate-limiter.ts';
import type { DeckQuery } from './application/deck-query.ts';
import type { SessionLauncher } from './application/session-launcher.ts';
import type { SessionResumer } from './application/session-resumer.ts';
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
  readonly deck: DeckQuery;
  readonly launcher: SessionLauncher;
  readonly resumer: SessionResumer;
  readonly stopper: SessionStopper;
  readonly tickets: TicketOffice;
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
    new StatusRoute(parts.report),
    new LaunchRoute(parts.launcher),
    new ResumeRoute(parts.resumer),
    new StopRoute(parts.stopper),
    new TicketRoute(parts.tickets),
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
