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
import type { ConfigDrift } from '../../contracts/config-snapshot.ts';
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

/**
 * What changed in each of those folders — P3-T7. See `ConfigHistorian`.
 *
 * A second collaborator rather than a field the reader fills in, because the two differ in kind:
 * the map is a reading that goes nowhere (D37) and a drift is an observation that is WRITTEN. The
 * reader stays a pure read and the writing is in the class whose whole job is the history.
 */
export interface ConfigDriftSource {
  observeAll(maps: readonly WorkflowMap[]): readonly ConfigDrift[];
}

export class WorkflowMapRoute implements Route {
  public readonly method = 'GET';
  public readonly path = '/projects/map';
  public readonly limit: RouteLimit = 'control';

  public readonly credential: Credential = 'token';
  private readonly reader: WorkflowMapSource;
  private readonly history: ConfigDriftSource;

  constructor(reader: WorkflowMapSource, history: ConfigDriftSource) {
    this.reader = reader;
    this.history = history;
  }

  /**
   * Wrapped in an object for the reason `ProjectsRoute` gives: an array cannot grow a field.
   *
   * **Two lists rather than a `drift` field on each map**, and the reason is that they are two
   * kinds of fact. A map is what is configured NOW and is re-derived from the disk every five
   * minutes; a drift is what happened, at an instant, and survives in the store. Hanging the
   * second off the first would also mean `parseWorkflowMap` had to grow a field whose value the
   * map reader never produces. The deck joins them by `projectKey`, which is what it keys every
   * other project reading by.
   *
   * The drifts are computed from the maps that were just read, so the two cannot disagree: there
   * is no second walk of the disk and no second cache to go stale against this one.
   */
  public async handle(): Promise<JsonResponse> {
    const maps = await this.reader.readAll();
    return json(200, { maps, drifts: this.history.observeAll(maps) });
  }
}
