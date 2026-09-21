// `POST /sessions/group` — start a named preset group on one press (P6-T4, D17).
//
// Its own literal path beside the other session verbs, for the reason `routes.ts` gives: the table
// says what is reachable, and a body field choosing between "start one" and "start six" would fold
// the most expensive verb in the product into the ordinary one.
//
// **The body carries a NAME and nothing else.** Not a list of presets, not a cwd, not a profile
// function — those all come from the presets core already holds, which have already been screened
// on the way in (`PresetBook.save` resolves both paths). A body that could name a folder would be
// a way to start a session outside every imported project, which is the failure SEC-FS-1 exists to
// prevent, reached through a door nobody was watching.
//
// **The status codes say who has to do something.** `409` for `busy`, because the answer is "you
// already pressed it"; `400` for a group that is not there or is too large, because the request is
// wrong; `200` for an accepted press, **including one where every session failed to start** — the
// press was accepted and the report says what happened, which is a different sentence from "core
// would not take this".
import type { GroupLaunchReport, GroupRefusal } from '../../contracts/preset-group.ts';
import type { Credential, RequestFacts } from './loopback-guard.ts';
import type { RouteLimit } from './limits.ts';
import type { Result } from '../shared/result.ts';
import { json, type JsonResponse, type Route } from './route.ts';

/** The one method this route needs. An interface over it, for `PresetSource`'s reason. */
export interface GroupStarter {
  launch(name: string): Promise<Result<GroupLaunchReport, GroupRefusal>>;
}

/** How long a group name may be. A preset's own name cap — it is the same kind of word. */
const MAX_GROUP_NAME_CHARS = 60;

export class GroupLaunchRoute implements Route {
  public readonly method = 'POST';
  public readonly path = '/sessions/group';
  public readonly limit: RouteLimit = 'control';
  public readonly credential: Credential = 'token';

  private readonly groups: GroupStarter;

  constructor(groups: GroupStarter) {
    this.groups = groups;
  }

  /** Facts go unread for `LaunchRoute`'s reason: `CoreServer` has already screened the request. */
  public async handle(facts: RequestFacts, body: string): Promise<JsonResponse> {
    const name = parseName(body);
    if (name === undefined) return json(400, { error: 'bad_request' });

    const launched = await this.groups.launch(name);
    if (launched.ok) return json(200, launched.value);
    return json(launched.error === 'busy' ? 409 : 400, { error: launched.error });
  }
}

/**
 * The group name out of the body, or `undefined` if it is not one.
 *
 * Length-capped here rather than only in the lookup, because a 4 MB string that will never match
 * anything should be refused before it is lower-cased and compared against every preset.
 */
function parseName(body: string): string | undefined {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value));
  const group = fields['group'];
  if (typeof group !== 'string') return undefined;
  const trimmed = group.trim();
  if (trimmed === '' || trimmed.length > MAX_GROUP_NAME_CHARS) return undefined;
  return trimmed;
}
