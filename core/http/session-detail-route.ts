// `GET /session` — everything known about one session, for an expanded row (P2-T4).
//
// **Why a query string and not `/sessions/:id`.** BUILD-PLAN §4 spells it with a path parameter and
// `RequestRouter` has none, on purpose: it matches method and path literally so that "no handler is
// reachable by a path that merely *starts* like an allowed one" is a structural fact rather than a
// careful regex. Adding parameters to the router to serve one route would trade that away, so the
// id rides the query instead. The BUILD-PLAN row is a sketch of a REST shape, not a promise about
// punctuation.
//
// **Three parameters, because two of them are identity and one is a filename.** A session id is
// unique only within a config directory, so `subscription` is not a convenience; and `shortId` is
// what names the job directory, which is a different string from the session uuid (F.7.1). All
// three are screened here, in the shapes P0 measured, before anything composes a path out of them —
// `SessionDetailReader` screens the composed path too (SEC-FS-2), and neither check makes the other
// redundant: this one refuses a request, that one refuses an open.
import type { SessionDetail } from '../../contracts/session-detail.ts';
import { parseSessionRef, type SessionRef } from '../../contracts/session-ref.ts';
import type { RouteLimit } from './limits.ts';
import type { Credential, RequestFacts } from './loopback-guard.ts';
import { json, type JsonResponse, type Route } from './route.ts';

/**
 * What this route needs, which is one method.
 *
 * An interface rather than `SessionDetailReader` itself, for the reason every port in core is one:
 * proving that a malformed `shortId` never reaches a path composer should not require building a
 * policy, a clock, a vitals registry and a file adapter.
 */
export interface DetailSource {
  read(ref: SessionRef): Promise<SessionDetail>;
}

export class SessionDetailRoute implements Route {
  public readonly method = 'GET';
  public readonly path = '/session';
  public readonly limit: RouteLimit = 'control';

  public readonly credential: Credential = 'token';
  private readonly reader: DetailSource;

  constructor(reader: DetailSource) {
    this.reader = reader;
  }

  /**
   * @returns 400 for a reference that is not one, never a body explaining which field was wrong.
   * The deck composes this URL from a row it already has, so a malformed one is not a user error to
   * be helped with — it is either a bug or somebody probing, and the detail goes to the log
   * (SECURITY.md §3 rule 3).
   */
  public async handle(request: RequestFacts): Promise<JsonResponse> {
    const ref = parseSessionRef(query(request.url));
    if (ref === undefined) return json(400, { error: 'bad_request' });
    return json(200, await this.reader.read(ref));
  }
}

/**
 * The query parameters, as plain strings.
 *
 * `URL` needs an absolute input and `request.url` is origin-relative, so a base is supplied. It is
 * a throwaway — the host has already been screened by `LoopbackGuard` before any route is reached,
 * and nothing here reads it back.
 */
function query(url: string | undefined): Readonly<Record<string, string>> {
  if (url === undefined) return {};
  try {
    return Object.fromEntries(new URL(url, 'http://127.0.0.1').searchParams);
  } catch {
    return {};
  }
}
