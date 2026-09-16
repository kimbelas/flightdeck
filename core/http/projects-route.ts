// `GET /projects` — the registry, as the deck's list (P3-T1).
//
// It answers from memory: `ProjectRegistry` loaded the rows at boot and re-reads them on every
// write, so this costs nothing and opens nothing. That matters more than it sounds — a list route
// that stat'd each folder would turn "show me my projects" into one syscall per project per page
// load, and would make an unplugged external drive look like a lost import.
//
// A REQUEST rather than a stream frame, and for the reason the session detail is one
// (contracts/deck-routes.ts): the rows are the picture of the machine and belong on the stream,
// while the registry changes only when a person imports something, which is the same person who is
// looking at the answer.
import type { ProjectRecord } from '../../contracts/project.ts';
import type { RouteLimit } from './limits.ts';
import type { Credential } from './loopback-guard.ts';
import { json, type JsonResponse, type Route } from './route.ts';

/**
 * What this route needs, which is one method.
 *
 * An interface rather than `ProjectRegistry` itself, for the reason every port in core is one: a
 * test of "the list comes back as `{ projects }`" should not have to build a store, a clock, an
 * audit log and a path canonicaliser.
 */
export interface ProjectSource {
  list(): readonly ProjectRecord[];
}

export class ProjectsRoute implements Route {
  public readonly method = 'GET';
  public readonly path = '/projects';
  public readonly limit: RouteLimit = 'control';

  public readonly credential: Credential = 'token';
  private readonly registry: ProjectSource;

  constructor(registry: ProjectSource) {
    this.registry = registry;
  }

  /** Wrapped in an object rather than returned as a bare array — a top-level JSON array is a
   * shape that cannot grow a field, and every other route here answers with an object. */
  public handle(): JsonResponse {
    return json(200, { projects: this.registry.list() });
  }
}
