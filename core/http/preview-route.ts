// `GET /preview` — what one session looks like when it cannot be given a terminal (P5a-T4).
//
// `SessionDetailRoute`'s sibling in every structural respect: the same three screened parameters
// on the query string for the same reason (`RequestRouter` matches literally and has no path
// parameters), the same `SessionRef`, the same refusal with no explanation of which field was
// wrong. What differs is the cost, and it is the reason this is not a field on the detail.
//
// **A detail is two small file reads; a preview spawns `claude.exe` and reads 330 KB.** Measured:
// 2.7 s against a live daemon, 1.7-2.5 s to fail against a dead one (RESEARCH.md G.34, F.2.5).
// Folding it into `GET /session` would put that on every row somebody expanded, which is exactly
// the "never poll it" F.2.5 ends with — so it is its own route, asked for by its own click.
import type { SessionPreview } from '../../contracts/session-preview.ts';
import { parseSessionRef, type SessionRef } from '../../contracts/session-ref.ts';
import type { RouteLimit } from './limits.ts';
import type { Credential, RequestFacts } from './loopback-guard.ts';
import { json, type JsonResponse, type Route } from './route.ts';

/** One method, for the reason `DetailSource` is one method — see that interface. */
export interface PreviewSource {
  read(ref: SessionRef): Promise<SessionPreview>;
}

export class PreviewRoute implements Route {
  public readonly method = 'GET';
  public readonly path = '/preview';
  public readonly limit: RouteLimit = 'control';

  public readonly credential: Credential = 'token';
  private readonly reader: PreviewSource;

  constructor(reader: PreviewSource) {
    this.reader = reader;
  }

  /** @returns 400 for a reference that is not one, with no body saying why (SECURITY.md §3 rule 3). */
  public async handle(request: RequestFacts): Promise<JsonResponse> {
    const ref = parseSessionRef(query(request.url));
    if (ref === undefined) return json(400, { error: 'bad_request' });
    return json(200, await this.reader.read(ref));
  }
}

/** The query parameters, as plain strings. `SessionDetailRoute`'s, and the same throwaway base. */
function query(url: string | undefined): Readonly<Record<string, string>> {
  if (url === undefined) return {};
  try {
    return Object.fromEntries(new URL(url, 'http://127.0.0.1').searchParams);
  } catch {
    return {};
  }
}
