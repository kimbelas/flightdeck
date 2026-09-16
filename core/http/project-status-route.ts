// `GET /projects/status` — stack and git for every imported folder (P3-T2, SPEC §5.1).
//
// **The opposite trade from `GET /projects`.** That route answers from memory and opens nothing,
// which is why it can be called every time the panel redraws. This one stats a git directory per
// project and may spawn a `git` per project, so it is its own path — a caller asking "which
// folders did I import" must not pay for "and what has changed in each of them".
//
// **Every project in one reply, not one request per project.** The deck draws the whole list at
// once; core caches each project's reading separately anyway (`SignatureCache`), so the batching
// costs nothing and saves N round trips through the rewrite. It also means a project that cannot
// be read does not fail anything: it comes back with an empty stack and no git, beside the ones
// that could.
//
// **A REQUEST rather than a stream frame**, like the registry it reports on. Git state does change
// without anybody touching this page — that is the argument for a frame — but the reader is a
// person looking at a panel, the cache already bounds how stale an answer can be, and putting
// every machine-wide `git commit` onto the event stream would be publishing to a deck that is
// usually not open.
import type { ProjectStatus } from '../../contracts/project-status.ts';
import type { RouteLimit } from './limits.ts';
import type { Credential } from './loopback-guard.ts';
import { json, type JsonResponse, type Route } from './route.ts';

/**
 * What this route needs, which is one method.
 *
 * An interface rather than `ProjectStatusReader` itself, for the reason every port in core is one:
 * a test of "the readings come back as `{ statuses }`" should not have to own a process runner, a
 * filesystem and a registry.
 */
export interface ProjectStatusSource {
  readAll(): Promise<readonly ProjectStatus[]>;
}

export class ProjectStatusRoute implements Route {
  public readonly method = 'GET';
  public readonly path = '/projects/status';
  public readonly limit: RouteLimit = 'control';

  public readonly credential: Credential = 'token';
  private readonly reader: ProjectStatusSource;

  constructor(reader: ProjectStatusSource) {
    this.reader = reader;
  }

  /** Wrapped in an object for the reason `ProjectsRoute` gives: an array cannot grow a field. */
  public async handle(): Promise<JsonResponse> {
    return json(200, { statuses: await this.reader.readAll() });
  }
}
