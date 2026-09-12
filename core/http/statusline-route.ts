// `POST /statusline` — the statusLine heartbeat (P1-T6). SEC-ING-1, SEC-ING-2, SEC-ING-3.
//
// The other end of this is nine lines of Python that run inside somebody's status line on **every
// render**, in a fresh `python.exe`, against a 150 ms budget (RESEARCH.md F.3). Everything about
// this route follows from that:
//
//  - **It answers and gets out of the way.** P0-T5 measured the receiver side at 0.29 ms median.
//    The work is `StatuslineQueue`'s, after the ack.
//  - **It never argues.** A render that cannot be parsed, attributed or afforded is a status quo,
//    not an error: the block swallows every exception by design (SEC-ING-3), so a refusal here is
//    invisible to the owner and must therefore cost them nothing either.
//  - **The reply is empty.** Unlike a hook, nothing reads it — but the same rule applies for the
//    same reason, and one route that answers `{}` is easier to reason about than two that differ.
//
// **Rate limited per session like a hook**, with the budget shared between them: 600 a minute is
// ten renders a second, well above the repaint rate P0-T5 saw. A session that somehow exceeds it
// loses a render, which the block cannot tell from a core that is busy — the worst case is a stale
// context percentage until the next repaint.
import { parseJsonBody } from '../../contracts/hook-event.ts';
import { parseStatuslineReport } from '../../contracts/statusline-report.ts';
import type { StatuslineQueue } from '../application/statusline-queue.ts';
import type { SubscriptionPaths } from '../application/subscription-paths.ts';
import type { Logger } from '../ports/logger.ts';
import { BUDGETS, type RouteLimit } from './limits.ts';
import type { RequestFacts } from './loopback-guard.ts';
import type { RateLimiter } from './rate-limiter.ts';
import { json, type JsonResponse, type Route } from './route.ts';

/** The one success body, for the same reason `/hooks` has one: core observes, it does not steer. */
const ACK: Readonly<Record<string, never>> = {};

export interface StatuslineRouteParts {
  readonly queue: StatuslineQueue;
  readonly paths: SubscriptionPaths;
  readonly limiter: RateLimiter;
  readonly logger: Logger;
}

export class StatuslineRoute implements Route {
  public readonly method = 'POST';
  public readonly path = '/statusline';
  /** Ingestion: a render is machine traffic on somebody's keystroke, not a person clicking. */
  public readonly limit: RouteLimit = 'ingest';

  private readonly queue: StatuslineQueue;
  private readonly paths: SubscriptionPaths;
  private readonly limiter: RateLimiter;
  private readonly logger: Logger;

  constructor(parts: StatuslineRouteParts) {
    this.queue = parts.queue;
    this.paths = parts.paths;
    this.limiter = parts.limiter;
    this.logger = parts.logger;
  }

  /**
   * Acks, then leaves. @throws never — a throw here costs the owner render time.
   *
   * The log line names the reason and the subscription and nothing else. A statusLine payload is
   * not model text, but it is the owner's cost, quota and session name, and a log is not where
   * those belong either (SEC-DATA-2).
   */
  public handle(request: RequestFacts, body: string): JsonResponse {
    const report = parseStatuslineReport(parseJsonBody(body));
    if (report === undefined) {
      this.logger.warn('statusline_rejected', { reason: 'unparseable' });
      return json(400, { error: 'bad request' });
    }

    // Read off the transcript path, never claimed — the same reasoning as `/hooks`: one token
    // authenticates both subscriptions, so a field would be worth the sender's honesty.
    const subscription = this.paths.of(report.transcriptPath);
    if (subscription === undefined) {
      this.logger.warn('statusline_rejected', { reason: 'unattributable' });
      return json(400, { error: 'bad request' });
    }

    if (!this.limiter.allow(`statusline:${report.sessionId}`, BUDGETS.ingest.perMinute)) {
      this.logger.warn('statusline_rejected', { reason: 'rate', subscription });
      return json(429, { error: 'too many requests' });
    }

    this.queue.accept(report, subscription);
    return json(200, ACK);
  }
}
