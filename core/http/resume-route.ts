// `POST /sessions/resume` — wake a stopped background session so a pane can attach to it.
//
// Its own path rather than a verb on `POST /sessions`, because `RequestRouter` matches method and
// path literally and that is a structural control (routes.ts): a body field deciding between
// "start a new session" and "wake this one" would put the two behind one entry in the table, and
// the table is the list of what is reachable.
//
// The body carries no free text at all — a subscription from a closed union and a session id that
// must be a full lowercase uuid — which is why this route is shorter than `LaunchRoute`. The id is
// checked again in `SessionResumer`, and deliberately: a short id does not fail at the CLI, it
// forks a copy of the session (RESEARCH.md F.2.7), so the rule lives with the argv that depends on
// it rather than only at the door.
import { SUBSCRIPTION_IDS, type SubscriptionId } from '../../contracts/session.ts';
import type { Credential, RequestFacts } from './loopback-guard.ts';
import type { ResumeRequest, SessionResumer } from '../application/session-resumer.ts';
import type { RouteLimit } from './limits.ts';
import { json, type JsonResponse, type Route } from './route.ts';

export class ResumeRoute implements Route {
  public readonly method = 'POST';
  public readonly path = '/sessions/resume';
  public readonly limit: RouteLimit = 'control';

  public readonly credential: Credential = 'token';
  private readonly resumer: SessionResumer;

  constructor(resumer: SessionResumer) {
    this.resumer = resumer;
  }

  /** Facts go unread for `LaunchRoute`'s reason: CoreServer has already screened the request. */
  public async handle(facts: RequestFacts, body: string): Promise<JsonResponse> {
    const request = parseResumeBody(body);
    if (request === undefined) return json(400, { error: 'bad_session' });

    const resumed = await this.resumer.resume(request);
    if (resumed.ok) return json(200, { sessionId: resumed.value });
    // 200 rather than 201: nothing was created. `no_claude` is the operator's to fix and says so.
    return json(resumed.error === 'no_claude' ? 503 : 400, { error: resumed.error });
  }
}

function parseResumeBody(body: string): ResumeRequest | undefined {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const fields = value as Record<string, unknown>;

  const subscription = fields['subscription'];
  const sessionId = fields['sessionId'];
  if (!isSubscriptionId(subscription) || typeof sessionId !== 'string') return undefined;
  return { subscription, sessionId };
}

function isSubscriptionId(value: unknown): value is SubscriptionId {
  return typeof value === 'string' && SUBSCRIPTION_IDS.some((id) => id === value);
}
