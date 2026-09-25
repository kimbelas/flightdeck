// `GET /analytics/spend` — cost per project, subscription and week (P7-T3, SPEC §6(9)).
//
// Token-gated like every read, and nothing arrives with the request: the window is `SPEND_WEEKS`
// ending this week, decided by core, so there is no parameter to screen. It answers for every
// project at once, unlike `/projects/observed`, because the reading was done in the background by
// the ledger and what is left is two queries over a few hundred rows.
import type { SpendSummary } from '../../contracts/spend-summary.ts';
import type { RouteLimit } from './limits.ts';
import type { Credential } from './loopback-guard.ts';
import { json, type JsonResponse, type Route } from './route.ts';

/** The one method this route needs — `TranscriptSearch`'s reason. */
export interface SpendSource {
  summary(): SpendSummary;
}

export class SpendRoute implements Route {
  public readonly method = 'GET';
  public readonly path = '/analytics/spend';
  public readonly limit: RouteLimit = 'control';
  public readonly credential: Credential = 'token';

  private readonly source: SpendSource;

  constructor(source: SpendSource) {
    this.source = source;
  }

  /** Synchronous, because `node:sqlite` is (R17) and the `Route` contract allows it. */
  public handle(): JsonResponse {
    return json(200, this.source.summary());
  }
}
