// `POST /sessions/adopt` — bring an ended interactive session back as a background one (P6-T7).
//
// Its own literal path beside the other session verbs, for `routes.ts`'s reason. It sits next to
// `resume` because it is what `resume` is for a session that was never a `--bg` job, and apart from
// it because the two cannot be one route: a resume is offered on a background session core is
// still being told about, and this is offered on one the listing has already forgotten (G.55).
//
// **The body is a ref and NOTHING else.** A handoff names a folder because only the owner knows
// which tree they want; an adoption has exactly one right answer — the folder that terminal was
// working in — and core read it off the machine itself. A browser that could name it would be
// choosing the directory a process starts in, which is what SEC-FS-1 exists to prevent.
//
// **404 is not among the answers, and that is deliberate.** `not_adoptable` is a 400: the session
// id is a real one core simply has nothing to adopt for — most often because core restarted and
// its memory of the ended terminal went with it — and a 404 would say the route was wrong.
// `no_claude` is 503 for a launch's reason: the operator's problem, not the request's.
import { parseSessionRefPayload } from '../../contracts/session-ref.ts';
import type { AdoptFailure } from '../../contracts/launch-reply.ts';
import type { Credential, RequestFacts } from './loopback-guard.ts';
import type { RouteLimit } from './limits.ts';
import type { Result } from '../shared/result.ts';
import { json, type JsonResponse, type Route } from './route.ts';
import type { SubscriptionId } from '../../contracts/session.ts';

/** The one method this route needs, as an interface — `SessionForker`'s reason. */
export interface SessionAdopterPort {
  adopt(request: {
    readonly subscription: SubscriptionId;
    readonly sessionId: string;
  }): Promise<Result<string, AdoptFailure>>;
}

export class AdoptRoute implements Route {
  public readonly method = 'POST';
  public readonly path = '/sessions/adopt';
  public readonly limit: RouteLimit = 'control';
  public readonly credential: Credential = 'token';

  private readonly adopter: SessionAdopterPort;

  constructor(adopter: SessionAdopterPort) {
    this.adopter = adopter;
  }

  /** Facts go unread for `StopRoute`'s reason: `CoreServer` has already screened the request. */
  public async handle(facts: RequestFacts, body: string): Promise<JsonResponse> {
    const ref = parse(body);
    if (ref === undefined) return json(400, { error: 'bad_request' });

    const adopted = await this.adopter.adopt(ref);
    // 200, not 201: an adoption does not create a session, it takes one that already exists and
    // changes what kind it is. The id in the reply is the id that went in, which is the promise.
    if (adopted.ok) return json(200, { sessionId: adopted.value });
    return json(adopted.error === 'no_claude' ? 503 : 400, { error: adopted.error });
  }
}

/**
 * The body, or `undefined` if it is not one.
 *
 * The same contract that screens every other session verb's ref, so the id cannot be a short one
 * here either — which for this verb is the control rather than hygiene: a short id does not fail,
 * it starts a copy under a new id (F.2.7, G.55).
 */
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
