// `POST /hooks` — Claude Code's `http` hook target (P1-T5). SEC-ING-1, SEC-ING-2, SEC-HTTP-6.
//
// Everything here is in somebody's session. A hook that is slow costs them the time; a hook that
// errors puts `Stop hook error occurred · ctrl+o to see` in front of them for every turn until it
// stops (RESEARCH.md F.1.5). So this route does the least it can: screen, parse, attribute, count,
// hand over, answer. The work is `HookQueue`'s, after the ack.
//
// **`200 {}` is not a formality, it is the only safe answer.** A hook handler's response body is
// read by Claude Code and can carry decisions — `{"decision": "block"}` and friends. Core observes
// sessions; it does not steer them. An empty object is the documented "carry on", and it is the
// one reply this route will ever make, which is why the success body is a constant rather than
// something assembled from what arrived.
//
// **No `Origin` reaches here and that is correct.** P0-T3 measured the transport: `axios`,
// `Content-Type: application/json`, and no `Origin` header at all (F.1.3), which is exactly the
// SEC-HTTP-2 carve-out. What authenticates a hook is the token in the `headers` field, checked by
// `LoopbackGuard` before this route is reached, and Content-Type is the backstop that refuses a
// cross-origin simple POST (F.4.3).
import { parseHookPayload, parseJsonBody } from '../../contracts/hook-event.ts';
import type { HookQueue } from '../application/hook-queue.ts';
import type { SubscriptionPaths } from '../application/subscription-paths.ts';
import type { Logger } from '../ports/logger.ts';
import type { RequestFacts } from './loopback-guard.ts';
import type { RateLimiter } from './rate-limiter.ts';
import { BUDGETS, type RouteLimit } from './limits.ts';
import { json, type JsonResponse, type Route } from './route.ts';

/** The one success body. See the header — a hook reply can steer a session, so this one does not. */
const ACK: Readonly<Record<string, never>> = {};

export interface HooksRouteParts {
  readonly queue: HookQueue;
  readonly paths: SubscriptionPaths;
  readonly limiter: RateLimiter;
  readonly logger: Logger;
}

export class HooksRoute implements Route {
  public readonly method = 'POST';
  public readonly path = '/hooks';
  /** Ingestion, so it gets the 4 MB body and the 600/min budget rather than the control ones. */
  public readonly limit: RouteLimit = 'ingest';

  private readonly queue: HookQueue;
  private readonly paths: SubscriptionPaths;
  private readonly limiter: RateLimiter;
  private readonly logger: Logger;

  constructor(parts: HooksRouteParts) {
    this.queue = parts.queue;
    this.paths = parts.paths;
    this.limiter = parts.limiter;
    this.logger = parts.logger;
  }

  /**
   * Acks, then leaves. @throws never — a throw here is a banner in a live session.
   *
   * Every refusal is a generic body with the reason in the local log only (SECURITY.md §11 rule 6).
   * The log line names the event and the subscription and nothing else: a payload that reached this
   * far may carry model text, and a log is not a place to put it (SEC-DATA-2).
   */
  public handle(request: RequestFacts, body: string): JsonResponse {
    const payload = parseHookPayload(parseJsonBody(body));
    if (payload === undefined) {
      this.logger.warn('hook_rejected', { reason: 'unparseable' });
      return json(400, { error: 'bad request' });
    }

    // Which subscription sent it is read off the transcript path, never claimed by the payload —
    // the same token authenticates both, so a field would be worth the sender's honesty.
    const subscription = this.paths.of(payload.transcript_path);
    if (subscription === undefined) {
      this.logger.warn('hook_rejected', { reason: 'unattributable' });
      return json(400, { error: 'bad request' });
    }

    // Per session, not per token: one runaway session must not be able to spend the budget of the
    // nine that are behaving (SEC-HTTP-6).
    if (!this.limiter.allow(`hook:${payload.session_id}`, BUDGETS.ingest.perMinute)) {
      this.logger.warn('hook_rejected', { reason: 'rate', subscription });
      return json(429, { error: 'too many requests' });
    }

    this.queue.accept(payload, subscription);
    return json(200, ACK);
  }
}
