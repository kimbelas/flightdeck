// `POST /sessions/takeover` — end a live, idle interactive session's terminal and adopt it (P6-T8).
//
// Beside `adopt` in the table and apart from it, for `adopt-route.ts`'s own reason: an adoption is
// offered on a session whose terminal has closed, and this is offered on one whose terminal is
// still open, and it is the verb that closes it. One route with a flag for "and end it first"
// would put the only verb in core that ends somebody else's process behind a body field.
//
// **The body is a ref and NOTHING else.** No pid and no folder: core reads both off the listing at
// the moment of the press (`SessionTakeover`). A browser that could name a pid could end any
// process the owner can.
//
// `busy` is a 409 rather than a 400: the request is right and the session's state is not, and it
// will succeed if it is sent again once the turn finishes. `no_claude` is 503 for a launch's
// reason. The rest are 400, `adopt`'s answer for the same kind of refusal.
import { parseSessionRefPayload } from '../../contracts/session-ref.ts';
import type { TakeoverFailure } from '../../contracts/launch-reply.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import type { Credential, RequestFacts } from './loopback-guard.ts';
import type { RouteLimit } from './limits.ts';
import type { Result } from '../shared/result.ts';
import { json, type JsonResponse, type Route } from './route.ts';

/** The one method this route needs, as an interface — `SessionForker`'s reason. */
export interface SessionTakeoverPort {
  takeOver(request: {
    readonly subscription: SubscriptionId;
    readonly sessionId: string;
  }): Promise<Result<string, TakeoverFailure>>;
}

export class TakeoverRoute implements Route {
  public readonly method = 'POST';
  public readonly path = '/sessions/takeover';
  public readonly limit: RouteLimit = 'control';
  public readonly credential: Credential = 'token';

  private readonly takeover: SessionTakeoverPort;

  constructor(takeover: SessionTakeoverPort) {
    this.takeover = takeover;
  }

  /** Facts go unread for `StopRoute`'s reason: `CoreServer` has already screened the request. */
  public async handle(facts: RequestFacts, body: string): Promise<JsonResponse> {
    const ref = parse(body);
    if (ref === undefined) return json(400, { error: 'bad_request' });

    const moved = await this.takeover.takeOver(ref);
    // 200 for `adopt`'s reason: the session is not created, it changes kind and keeps its id.
    if (moved.ok) return json(200, { sessionId: moved.value });
    return json(statusFor(moved.error), { error: moved.error });
  }
}

function statusFor(failure: TakeoverFailure): number {
  if (failure === 'no_claude') return 503;
  if (failure === 'busy') return 409;
  return 400;
}

/** The body, or `undefined` — the same contract every other session verb's ref is screened by. */
function parse(
  body: string,
): { readonly subscription: SubscriptionId; readonly sessionId: string } | undefined {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return undefined;
  }
  const ref = parseSessionRefPayload(value);
  if (ref === undefined) return undefined;
  return { subscription: ref.subscription, sessionId: ref.sessionId };
}
