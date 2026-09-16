// `POST /projects` — the owner's deliberate act, and the only way a folder becomes readable.
//
// P3-T1, SEC-FS-1, DECISIONS.md D26. The body carries one path, typed by a person into the deck,
// and it is `unknown` until the guard below accepts it (CODING-STANDARDS §11 rule 1). Everything
// this route does with it is hand it to `ProjectRegistry`: the canonicalisation, the four SEC-FS-1
// checks and the audit row all live there, because they are the same whoever asked.
//
// **The refusal is repeated back, and that is a decision.** `SessionDetailRoute` deliberately says
// only `bad_request` — the deck composes that URL from a row it already has, so a malformed one is
// a bug or a probe. This is the opposite case: a person typed the path, they are looking at the
// screen, and "that folder is not there" versus "that is a config directory" is the difference
// between a typo they can fix in two seconds and a rule they need to know about. `ImportRefusal`
// is a closed union of codes with no free text in it, so nothing this route says was composed from
// what the request contained.
import {
  parseProjectPathBody,
  type ImportRefusal,
  type ProjectRecord,
} from '../../contracts/project.ts';
import type { Result } from '../shared/result.ts';
import type { RouteLimit } from './limits.ts';
import type { Credential, RequestFacts } from './loopback-guard.ts';
import { json, type JsonResponse, type Route } from './route.ts';

/** What this route needs, which is one method. See `ProjectSource` for why it is an interface. */
export interface ProjectImporter {
  import(path: string): Promise<Result<ProjectRecord, ImportRefusal>>;
}

export class ImportProjectRoute implements Route {
  public readonly method = 'POST';
  public readonly path = '/projects';
  public readonly limit: RouteLimit = 'control';

  public readonly credential: Credential = 'token';
  private readonly registry: ProjectImporter;

  constructor(registry: ProjectImporter) {
    this.registry = registry;
  }

  /**
   * @returns 201 with the stored project, or 400 with the refusal code.
   *
   * 201 even when the folder was already imported. It is the state the request asked for and the
   * body says which project it is; inventing a 200-versus-201 distinction would make the deck
   * branch on something it has no use for.
   *
   * The request facts go unread, as they do in `LaunchRoute`: everything this route needs is in
   * the body, and the screening that would have used the headers happened in `CoreServer`.
   */
  public async handle(facts: RequestFacts, body: string): Promise<JsonResponse> {
    const path = parseProjectPathBody(body);
    if (path === undefined) return json(400, { error: 'empty' });
    const imported = await this.registry.import(path);
    if (imported.ok) return json(201, { project: imported.value });
    return json(400, { error: imported.error });
  }
}
