// `POST /projects/forget` — withdrawing a folder from the allowlist (P3-T1, SEC-FS-1).
//
// **A POST at its own literal path, not a `DELETE /projects`.** `RequestRouter` matches method and
// path exactly and has no patterns, which is a structural control rather than a style — no handler
// can be reached by a path that merely starts like an allowed one. A verb-shaped URL is the price
// of that, and it is a small one. It is a POST rather than a GET because every control that
// protects a mutation is a POST control (the `TicketRoute` argument): the Content-Type check forces
// a preflight that core never answers, the Origin must be the deck, and the bearer is attached
// server-side by the rewrite.
//
// **Removing a permission is not a security risk; being unable to remove one is.** The absence of
// this route is what would need justifying — an allowlist that only grows makes the first typo
// permanent, and D26's "one deliberate act at a time" reads very differently if the acts cannot be
// undone (SEC-OPS-2 makes the same argument for Disconnect).
import { parseProjectPathBody } from '../../contracts/project.ts';
import type { RouteLimit } from './limits.ts';
import type { Credential, RequestFacts } from './loopback-guard.ts';
import { json, type JsonResponse, type Route } from './route.ts';

/** What this route needs, which is one method. See `ProjectSource` for why it is an interface. */
export interface ProjectForgetter {
  forget(path: string): boolean;
}

export class ForgetProjectRoute implements Route {
  public readonly method = 'POST';
  public readonly path = '/projects/forget';
  public readonly limit: RouteLimit = 'control';

  public readonly credential: Credential = 'token';
  private readonly registry: ProjectForgetter;

  constructor(registry: ProjectForgetter) {
    this.registry = registry;
  }

  /**
   * @returns 200 with whether a project was actually removed.
   *
   * Not a 404 for a path that was not imported. The request asked for a state — "this folder is not
   * a project" — and that state holds either way; a 404 would make the deck render an error for an
   * outcome the owner wanted. The boolean is there because "withdrawn" and "was never there" are
   * different sentences to put on screen, and they are different audit rows.
   */
  public handle(facts: RequestFacts, body: string): JsonResponse {
    const path = parseProjectPathBody(body);
    if (path === undefined) return json(400, { error: 'empty' });
    return json(200, { forgotten: this.registry.forget(path) });
  }
}
