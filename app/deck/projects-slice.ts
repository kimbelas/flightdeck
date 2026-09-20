// The registry and its readings, as a class of its own — P4-T1.
//
// `WorkflowMapSlice` set the shape and `PresetsSlice` is the reason this one exists now: adding a
// fifth fetch path put `deck-store.ts` back over its 250-line limit, and the registry is the
// coherent piece to lift out — four methods that are all about one list, where the store keeps the
// stream, the retry and the session verbs. That is the same split the file has taken twice already
// (`deck-state.ts` for the shape, `workflow-map-slice.ts` for the third read).
//
// **It is a slice, not a second store.** There is one `DeckState` and one set of subscribers; this
// is handed the API port and a way to publish, and holds nothing of its own. The ORCHESTRATION
// stays in the store — which read follows which, and what rides along with a refresh — because
// that is a fact about the page rather than about the registry.
//
// **A reply that cannot be read leaves what is held alone.** An empty registry is a real and
// ordinary state (DECISIONS.md D26), so rendering one because a request failed would tell the
// owner their projects are gone.
import {
  CORE_PROJECT_FORGET_PATH,
  CORE_PROJECT_STATUS_PATH,
  CORE_PROJECTS_PATH,
} from '../../contracts/deck-routes.ts';
import {
  parseImportRefusal,
  parseProjectList,
  projectKey,
  type ImportRefusal,
  type ProjectRecord,
} from '../../contracts/project.ts';
import { parseProjectStatusList, type ProjectStatus } from '../../contracts/project-status.ts';
import type { DeckApi } from './deck-api.ts';

/** The three fields of `DeckState` this slice owns. */
export interface ProjectsHeld {
  readonly projects: readonly ProjectRecord[];
  readonly importRefusal: ImportRefusal | undefined;
  readonly statuses: Readonly<Record<string, ProjectStatus>>;
}

export class ProjectsSlice {
  private readonly api: DeckApi;
  private readonly publish: (changes: Partial<ProjectsHeld>) => void;

  constructor(api: DeckApi, publish: (changes: Partial<ProjectsHeld>) => void) {
    this.api = api;
    this.publish = publish;
  }

  /**
   * Re-reads the registry.
   *
   * @returns whether core answered with one, so the caller can decide whether the readings that
   * annotate it are worth asking for. A registry nobody could read has nothing to annotate.
   */
  public async load(): Promise<boolean> {
    const reply = await this.api.get(CORE_PROJECTS_PATH);
    if (reply?.status !== 200) return false;
    this.publish({ projects: parseProjectList(reply.body) });
    return true;
  }

  /**
   * Re-reads stack and git for every imported folder — P3-T2.
   *
   * **Replaced wholesale, never merged.** Core answers about every imported project, so a merge
   * would leave a branch name on screen for a folder that has just been forgotten.
   */
  public async loadStatuses(): Promise<void> {
    const reply = await this.api.get(CORE_PROJECT_STATUS_PATH);
    if (reply?.status !== 200) return;
    this.publish({ statuses: byProject(parseProjectStatusList(reply.body)) });
  }

  /**
   * Imports one folder by path — the owner's deliberate act (DECISIONS.md D26).
   *
   * @returns whether it was imported. The refusal, when there is one, goes into `importRefusal`
   * for `ProjectsViewModel` to put into English — it is core's own closed union, not a sentence
   * core composed, so nothing displayed came from the request.
   */
  public async import(path: string): Promise<boolean> {
    this.publish({ importRefusal: undefined });
    const reply = await this.api.post(CORE_PROJECTS_PATH, { path });
    if (reply?.status === 201) return true;
    // `empty` for a request that reached nobody, and for a 400 carrying a code this build does not
    // know — both render as the generic sentence rather than as silence.
    this.publish({ importRefusal: parseImportRefusal(reply?.body) ?? 'empty' });
    return false;
  }

  /**
   * Withdraws one folder, taking the read permission with it.
   *
   * @returns whether core answered at all. The list is re-read by the caller rather than filtered
   * locally: what the registry holds is core's answer, and a deck that removed the row itself
   * would be guessing at the outcome of a write.
   */
  public async forget(path: string): Promise<boolean> {
    return (await this.api.post(CORE_PROJECT_FORGET_PATH, { path })) !== undefined;
  }
}

/** Readings by `projectKey`, which is the same key the panel draws its rows under. */
function byProject(statuses: readonly ProjectStatus[]): Readonly<Record<string, ProjectStatus>> {
  return Object.fromEntries(statuses.map((status) => [projectKey(status.path), status]));
}
