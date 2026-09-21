// `POST /sessions/rm` — delete a background session and its conversation.
//
// Its own literal path beside `/sessions`, `/sessions/resume` and `/sessions/stop`, for the reason
// routes.ts gives: `RequestRouter` matches method and path exactly, so each verb is its own row in
// the table that says what is reachable. That matters more for this verb than for the other three
// — a body field choosing between "stop" and "delete" would be one typo away from the wrong one.
//
// **The confirmation is the deck's, and that is on purpose.** A route that asked would be a route
// nothing could call twice; what the route owes is that nothing reaches it by accident, which is
// what a distinct path, a POST, an Origin check and a bearer already give (SEC-HTTP-5).
import { parseSessionRefPayload } from '../../contracts/session-ref.ts';
import type { Credential, RequestFacts } from './loopback-guard.ts';
import type { SessionRemover } from '../application/session-remover.ts';
import type { RouteLimit } from './limits.ts';
import { json, type JsonResponse, type Route } from './route.ts';

export class RemoveRoute implements Route {
  public readonly method = 'POST';
  public readonly path = '/sessions/rm';
  public readonly limit: RouteLimit = 'control';

  public readonly credential: Credential = 'token';
  private readonly remover: SessionRemover;

  constructor(remover: SessionRemover) {
    this.remover = remover;
  }

  /** Facts go unread for `LaunchRoute`'s reason: CoreServer has already screened the request. */
  public async handle(facts: RequestFacts, body: string): Promise<JsonResponse> {
    const ref = parseRef(body);
    if (ref === undefined) return json(400, { error: 'bad_session' });

    const removed = await this.remover.remove(ref);
    // 200 rather than 204: the body carries the id, and the deck drops the row by it.
    if (removed.ok) return json(200, { sessionId: removed.value });
    return json(removed.error === 'no_claude' ? 503 : 400, { error: removed.error });
  }
}

function parseRef(body: string): ReturnType<typeof parseSessionRefPayload> {
  try {
    return parseSessionRefPayload(JSON.parse(body));
  } catch {
    return undefined;
  }
}
