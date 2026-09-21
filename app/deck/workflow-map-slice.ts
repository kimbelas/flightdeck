// The deck's third fetch path, as a class of its own — P3-T3.
//
// `DeckStore` owns the stream, the retry, the session detail and the two project reads, and it is
// at its line limit with little room (P3-T2 already moved `DeckState` out to make space). A third
// fetch path added as four more methods would have been the change that made the file impossible
// to read rather than merely long — so the map's fetch, its parse and its keying live here, and
// the store keeps one method that delegates.
//
// **It is a slice, not a second store.** There is one `DeckState` and one set of subscribers; this
// class is handed the API port and a way to publish, and never holds state of its own. That is the
// division the header of `deck-state.ts` describes: the store is behaviour over one snapshot, and
// splitting the snapshot would give the deck two clocks.
//
// **Replaced wholesale, never merged**, which is `loadProjectStatuses`' rule for its reason: core
// answers about every imported project, and a merge would leave a workflow map on screen for a
// folder that has just been forgotten.
//
// **A reply that cannot be read leaves what is held alone.** An empty map is a real and ordinary
// answer — `docs-tool` has no `.claude` at all and is half the P3 gate — so rendering "nothing
// configured" because a request failed would say something false about the repository rather than
// about the request.
import { parseConfigDrifts, type ConfigDrift } from '../../contracts/config-snapshot.ts';
import { CORE_PROJECT_MAP_PATH } from '../../contracts/deck-routes.ts';
import { projectKey } from '../../contracts/project.ts';
import { parseWorkflowMapList, type WorkflowMap } from '../../contracts/workflow-map.ts';
import type { DeckApi } from './deck-api.ts';

/** Maps by `projectKey` — the same key the panel draws its rows under. */
export type WorkflowMaps = Readonly<Record<string, WorkflowMap>>;

/** The last config change per folder, keyed the same way — P3-T7. Absent means none. */
export type ConfigDrifts = Readonly<Record<string, ConfigDrift>>;

/** The two fields of `DeckState` this slice owns, published together because they arrive so. */
export interface MapsHeld {
  readonly maps: WorkflowMaps;
  readonly drifts: ConfigDrifts;
}

export class WorkflowMapSlice {
  private readonly api: DeckApi;
  private readonly publish: (held: MapsHeld) => void;

  /**
   * @param publish what to do with a new set of maps. A callback rather than the store itself, so
   * this class can be unit-tested against a function and knows nothing about `DeckState`.
   */
  constructor(api: DeckApi, publish: (held: MapsHeld) => void) {
    this.api = api;
    this.publish = publish;
  }

  /**
   * Re-reads every imported folder's workflow map.
   *
   * Called beside the registry read rather than on a timer: a map moves when somebody edits a
   * config file, core holds one for five minutes anyway, and nothing on this machine can change
   * one without the owner doing it (`WorkflowMapReader`).
   */
  public async load(): Promise<void> {
    const reply = await this.api.get(CORE_PROJECT_MAP_PATH);
    if (reply?.status !== 200) return;
    const maps = parseWorkflowMapList(reply.body);
    // P3-T7. They arrive together and are published together: a map on screen beside a drift from
    // the previous reply would be the deck saying a hook changed that is no longer there.
    this.publish({
      maps: Object.fromEntries(maps.map((map) => [projectKey(map.path), map])),
      drifts: Object.fromEntries(
        parseConfigDrifts(bodyField(reply.body, 'drifts')).map((drift) => [
          projectKey(drift.path),
          drift,
        ]),
      ),
    });
  }
}

/** One field of a reply body, without asserting what the body is. */
function bodyField(body: unknown, field: string): unknown {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  return Object.fromEntries(Object.entries(body))[field];
}
