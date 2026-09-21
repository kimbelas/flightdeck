// `POST /run` — start one headless Ask and answer with its id.
//
// **It returns as soon as the run is accepted, not when the answer is ready** (D48). The records
// arrive as `ask` frames on `GET /stream`, beside `snapshot` and `quota`, so this route answers in
// milliseconds and a deck that reloads mid-run keeps receiving the answer. A route that streamed
// its own response body would be the deck's second live feed, which is what P1-T9 and P2-T3 both
// decided against.
//
// **202, not 200.** The work has been accepted and has not been done, which is precisely what the
// code means — and it is the honest answer to give something that might otherwise read `{runId}`
// as "here is the finished run".
import { parseAskRequest, type AskRefusal } from '../../contracts/ask-run.ts';
import type { AskRunner } from '../application/ask-runner.ts';
import type { Credential, RequestFacts } from './loopback-guard.ts';
import type { RouteLimit } from './limits.ts';
import { json, type JsonResponse, type Route } from './route.ts';

export class AskRoute implements Route {
  public readonly method = 'POST';
  public readonly path = '/run';
  public readonly limit: RouteLimit = 'control';

  public readonly credential: Credential = 'token';
  private readonly runner: AskRunner;

  constructor(runner: AskRunner) {
    this.runner = runner;
  }

  /** Facts go unread for `LaunchRoute`'s reason: CoreServer has already screened the request. */
  public handle(facts: RequestFacts, body: string): Promise<JsonResponse> {
    const request = parseAskRequest(body);
    if (request === undefined) return Promise.resolve(json(400, { error: 'empty' }));

    const started = this.runner.start(request);
    if (started.ok) return Promise.resolve(json(202, { runId: started.value }));
    return Promise.resolve(json(statusOf(started.error), { error: started.error }));
  }
}

/**
 * Which code each refusal is.
 *
 * `busy` is 409 rather than 400 — the request was fine and the state was not, and a deck that
 * treated it as a malformed body would tell the owner to fix their prompt. `no_claude` is 503 for
 * the reason every other route uses it: the binary is missing, which is core's problem, not the
 * caller's.
 */
function statusOf(refusal: AskRefusal): number {
  if (refusal === 'busy') return 409;
  if (refusal === 'no_claude') return 503;
  return 400;
}
