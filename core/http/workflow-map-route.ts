// `GET /projects/map` — what Claude is configured to do in every imported folder (P3-T3, SPEC §5.1).
//
// **A third project route rather than a field on either of the first two**, and the reason is the
// same one that split `/projects/status` off `/projects`: the three cost different things and
// change on different clocks. Listing the registry opens nothing; a status stats a git directory
// and may spawn `git`; a map is a directory listing per asset kind, a head read per asset and two
// JSON parses. A panel drawing the list of folders must not pay for the third, and the map is
// held for five minutes anyway (`WorkflowMapReader`) because almost nothing moves it.
//
// **Every project in one reply.** `ProjectStatusRoute`'s argument applies unchanged: core caches
// each project's map separately, so the batching costs nothing and saves N round trips through the
// rewrite — and a folder that cannot be read comes back as an empty map beside the ones that could
// rather than failing the request.
//
// **A REQUEST, not a stream frame.** A workflow map changes when somebody edits a config file,
// which is a thing that happens a few times a week; pushing that to a deck that is usually not
// open would be publishing to nobody. The same reasoning as the registry it reports on.
import type { WorkflowMap } from '../../contracts/workflow-map.ts';
import type { RouteLimit } from './limits.ts';
import type { Credential } from './loopback-guard.ts';
import { json, type JsonResponse, type Route } from './route.ts';

/**
 * What this route needs, which is one method.
 *
 * An interface rather than `WorkflowMapReader` itself, for the reason every port in core is one: a
 * test of "the maps come back as `{ maps }`" should not have to own a filesystem and a registry.
 */
export interface WorkflowMapSource {
  readAll(): Promise<readonly WorkflowMap[]>;
}

export class WorkflowMapRoute implements Route {
  public readonly method = 'GET';
  public readonly path = '/projects/map';
  public readonly limit: RouteLimit = 'control';

  public readonly credential: Credential = 'token';
  private readonly reader: WorkflowMapSource;

  constructor(reader: WorkflowMapSource) {
    this.reader = reader;
  }

  /** Wrapped in an object for the reason `ProjectsRoute` gives: an array cannot grow a field. */
  public async handle(): Promise<JsonResponse> {
    return json(200, { maps: await this.reader.readAll() });
  }
}
