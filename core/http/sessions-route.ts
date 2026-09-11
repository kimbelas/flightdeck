// `GET /sessions` — every session on both subscriptions, as the deck's rows.
//
// It sweeps on request rather than serving a cached model, because the reconciler (P1-T4) and the
// store it would feed (P1-T8, P1-T9) are not built: D30 pulled the terminal ahead of them and said
// so. The cost is a ~1.5 s round trip and a deck that does not update itself until asked.
import type { DeckQuery } from '../application/deck-query.ts';
import type { RouteLimit } from './limits.ts';
import { json, type JsonResponse, type Route } from './route.ts';

export class SessionsRoute implements Route {
  public readonly method = 'GET';
  public readonly path = '/sessions';
  public readonly limit: RouteLimit = 'control';
  private readonly deck: DeckQuery;

  constructor(deck: DeckQuery) {
    this.deck = deck;
  }

  public async handle(): Promise<JsonResponse> {
    return json(200, await this.deck.snapshot());
  }
}
