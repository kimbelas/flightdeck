// Exact method + path matching, and nothing more.
//
// No patterns, no parameters, no prefixes. Every path core answers is a literal listed by a Route,
// so there is no way to reach a handler with a path that merely *starts* like an allowed one —
// the class of bug that turns `/sessions` into `/sessions/../../token`.
//
// Generic over what it holds because P1-T9 added a second kind of route: a JSON handler returns a
// value, a stream handler takes over the socket, and they cannot share a return type — but "find
// the one thing registered at this method and path" is the same job for both, and two copies of it
// would be two places for the matching rule above to drift.
import type { Routable } from './route.ts';

export class RequestRouter<T extends Routable> {
  private readonly routes: ReadonlyMap<string, T>;

  constructor(routes: readonly T[]) {
    this.routes = new Map(routes.map((route) => [key(route.method, route.path), route]));
  }

  /** The route for this request, or `undefined` for a 404. */
  public find(method: string, path: string): T | undefined {
    return this.routes.get(key(method, path));
  }
}

function key(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}
