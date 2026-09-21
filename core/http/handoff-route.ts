// `POST /sessions/handoff` — fork a session into a new working tree (P6-T6, SPEC §6(8)).
//
// Its own literal path beside the other session verbs, for `routes.ts`'s reason. It is the one verb
// that ADDS a session without being able to lose one: the original keeps its id, its name and its
// conversation, which is what makes this safe to press and different from every other row in the
// table.
//
// **The body names a FOLDER, unlike every other session verb**, and that is why the screening is
// not optional: `SessionHandoff` hands it to `ProjectRegistry.resolveDirectory`, the only screen
// that admits a worktree, before anything is spawned (SEC-FS-1). Nothing here decides it.
//
// **404 for a session that could not be forked, 400 for a request that was wrong** — and `no_claude`
// is 503, because it is the operator's problem rather than the request's, exactly as a launch's is.
import { parseSessionRefPayload } from '../../contracts/session-ref.ts';
import type { HandoffFailure } from '../../contracts/launch-reply.ts';
import type { Credential, RequestFacts } from './loopback-guard.ts';
import type { RouteLimit } from './limits.ts';
import type { Result } from '../shared/result.ts';
import { json, type JsonResponse, type Route } from './route.ts';
import type { SubscriptionId } from '../../contracts/session.ts';

/** The one method this route needs, as an interface — `PresetSource`'s reason. */
export interface SessionForker {
  handOff(request: {
    readonly subscription: SubscriptionId;
    readonly sessionId: string;
    readonly cwd: string;
    readonly name: string;
  }): Promise<Result<string, HandoffFailure>>;
}

/** `-n`'s own cap. The service re-checks it; this refuses a body that could never be one. */
const MAX_NAME_CHARS = 80;
const MAX_CWD_CHARS = 400;

export class HandoffRoute implements Route {
  public readonly method = 'POST';
  public readonly path = '/sessions/handoff';
  public readonly limit: RouteLimit = 'control';
  public readonly credential: Credential = 'token';

  private readonly forker: SessionForker;

  constructor(forker: SessionForker) {
    this.forker = forker;
  }

  /** Facts go unread for `StopRoute`'s reason: `CoreServer` has already screened the request. */
  public async handle(facts: RequestFacts, body: string): Promise<JsonResponse> {
    const request = parse(body);
    if (request === undefined) return json(400, { error: 'bad_request' });

    const forked = await this.forker.handOff(request);
    // 201: a handoff CREATES a session, which is the one thing that separates it from a resume.
    if (forked.ok) return json(201, { sessionId: forked.value });
    return json(forked.error === 'no_claude' ? 503 : 400, { error: forked.error });
  }
}

/**
 * The body, or `undefined` if it is not one.
 *
 * The ref is screened by the contract that screens every other session verb's, so the id cannot be
 * a short one here either (F.2.7). The folder is length-capped and otherwise untouched: deciding
 * whether it may be written in is the registry's, and a parser that formed an opinion about a path
 * would be a second one (`ProjectImport`'s rule).
 */
function parse(body: string):
  | {
      readonly subscription: SubscriptionId;
      readonly sessionId: string;
      readonly cwd: string;
      readonly name: string;
    }
  | undefined {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return undefined;
  }
  const ref = parseSessionRefPayload(value);
  if (ref === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value));
  const cwd = boundedText(fields['cwd'], MAX_CWD_CHARS);
  const name = boundedText(fields['name'], MAX_NAME_CHARS);
  if (cwd === undefined || name === undefined) return undefined;
  return { subscription: ref.subscription, sessionId: ref.sessionId, cwd, name };
}

/** A trimmed string with something in it and a ceiling on it, or `undefined`. */
function boundedText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string' || value.length > max) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}
