// `POST /sessions/stop` — stop a running background session without deleting it.
//
// Its own literal path beside `/sessions` and `/sessions/resume`, for the reason routes.ts gives:
// `RequestRouter` matches method and path exactly, so each verb is its own row in the table that
// says what is reachable. A body field choosing between three verbs would collapse them into one.
//
// The body is a `SessionRef` — both ids and the subscription — screened by the contract that also
// screens the detail route's query string. `shortId` is what reaches the command line here, which
// is why that shape check is not optional (F.2.8b: `stop` refuses the full uuid).
import { parseSessionRefPayload } from '../../contracts/session-ref.ts';
import type { Credential, RequestFacts } from './loopback-guard.ts';
import type { SessionStopper } from '../application/session-stopper.ts';
import type { RouteLimit } from './limits.ts';
import { json, type JsonResponse, type Route } from './route.ts';

export class StopRoute implements Route {
  public readonly method = 'POST';
  public readonly path = '/sessions/stop';
  public readonly limit: RouteLimit = 'control';

  public readonly credential: Credential = 'token';
  private readonly stopper: SessionStopper;

  constructor(stopper: SessionStopper) {
    this.stopper = stopper;
  }

  /** Facts go unread for `LaunchRoute`'s reason: CoreServer has already screened the request. */
  public async handle(facts: RequestFacts, body: string): Promise<JsonResponse> {
    const ref = parseRef(body);
    if (ref === undefined) return json(400, { error: 'bad_session' });

    const stopped = await this.stopper.stop(ref);
    // 200: nothing was created and nothing was deleted — a session changed state.
    if (stopped.ok) return json(200, { sessionId: stopped.value });
    return json(stopped.error === 'no_claude' ? 503 : 400, { error: stopped.error });
  }
}

function parseRef(body: string): ReturnType<typeof parseSessionRefPayload> {
  try {
    return parseSessionRefPayload(JSON.parse(body));
  } catch {
    return undefined;
  }
}
