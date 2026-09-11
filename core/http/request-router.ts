// Exact method + path matching, and nothing more.
//
// No patterns, no parameters, no prefixes. Every path core answers is a literal listed by a Route,
// so there is no way to reach a handler with a path that merely *starts* like an allowed one —
// the class of bug that turns `/sessions` into `/sessions/../../token`.
import type { Route } from './route.ts';

export class RequestRouter {
  private readonly routes: ReadonlyMap<string, Route>;

  constructor(routes: readonly Route[]) {
    this.routes = new Map(routes.map((route) => [key(route.method, route.path), route]));
  }

  /** The route for this request, or `undefined` for a 404. */
  public find(method: string, path: string): Route | undefined {
    return this.routes.get(key(method, path));
  }
}

function key(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}
