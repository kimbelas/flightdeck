// `GET /toasts/mutes` and `POST /toasts/mutes` — which sessions are silenced (P6-T3, SPEC §5.5).
//
// Two routes on one path, which is `keybindings-route.ts`'s shape and for a weaker version of its
// reason: a GET that cannot write is a read the deck can make on every load without any chance of
// changing what it is reading. The deck asks once when it connects and then keeps the set the POST
// answers with.
//
// **Both answer with the WHOLE set**, not with an acknowledgement. The page holds a copy of it to
// draw a switch on every pane, and a reply that said only "done" would leave that copy to be
// inferred — a mute the deck believed in and core did not is a switch that lies.
//
// `/toasts/` rather than `/sessions/`, though the key is a session: nothing here starts, stops or
// reaches a session, and the literal-path table in `routes.ts` is easier to read when a path says
// which subsystem answers it.
import { parseMuteRequest } from '../../contracts/session-mute.ts';
import type { Credential, RequestFacts } from './loopback-guard.ts';
import type { MuteBook } from '../application/mute-book.ts';
import type { RouteLimit } from './limits.ts';
import { json, type JsonResponse, type Route } from './route.ts';

export class MutesReadRoute implements Route {
  public readonly method = 'GET';
  public readonly path = '/toasts/mutes';
  public readonly limit: RouteLimit = 'control';
  public readonly credential: Credential = 'token';

  private readonly mutes: MuteBook;

  constructor(mutes: MuteBook) {
    this.mutes = mutes;
  }

  public handle(): JsonResponse {
    return json(200, { muted: this.mutes.keys() });
  }
}

export class MutesWriteRoute implements Route {
  public readonly method = 'POST';
  public readonly path = '/toasts/mutes';
  public readonly limit: RouteLimit = 'control';
  public readonly credential: Credential = 'token';

  private readonly mutes: MuteBook;

  constructor(mutes: MuteBook) {
    this.mutes = mutes;
  }

  /** Facts go unread for `StopRoute`'s reason: `CoreServer` has already screened the request. */
  public handle(facts: RequestFacts, body: string): JsonResponse {
    const request = parse(body);
    if (request === undefined) return json(400, { error: 'bad_session' });

    // 200 and not 201: a mute is a switch with two positions, and setting one that is already set
    // creates nothing. `MuteBook.set` is idempotent for the same reason.
    return json(200, { muted: this.mutes.set(request, request.muted) });
  }
}

function parse(body: string): ReturnType<typeof parseMuteRequest> {
  try {
    return parseMuteRequest(JSON.parse(body));
  } catch {
    return undefined;
  }
}
