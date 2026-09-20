// `GET /keybindings` and `POST /keybindings` — the plan, then the write (P5a-T7, SEC-FS-3).
//
// Two routes rather than one with a flag, and it is the same structural argument `ConnectPlanner`
// makes about being a separate object from `Connector`: a GET that cannot write cannot be talked
// into writing early, and D13's promise — the owner sees the whole diff before a byte moves — is
// kept by the shape rather than by remembering to.
//
// The POST re-plans from what is on disk NOW rather than trusting anything the page sends. The
// browser has no say in what gets written: not the path, not the contents, not which keys. All it
// carries is `direction`, and both directions are a closed union.
import type { KeybindingDirection } from '../../contracts/keybinding-plan.ts';
import type { Credential, RequestFacts } from './loopback-guard.ts';
import type { KeybindingHelper } from '../application/keybinding-helper.ts';
import type { RouteLimit } from './limits.ts';
import { json, type JsonResponse, type Route } from './route.ts';

export class KeybindingPlanRoute implements Route {
  public readonly method = 'GET';
  public readonly path = '/keybindings';
  public readonly limit: RouteLimit = 'control';
  public readonly credential: Credential = 'token';

  private readonly helper: KeybindingHelper;

  constructor(helper: KeybindingHelper) {
    this.helper = helper;
  }

  public handle(facts: RequestFacts): JsonResponse {
    const direction = directionFrom(facts.url);
    if (direction === undefined) return json(400, { error: 'bad request' });
    return json(200, { direction, plan: this.helper.plan(direction) });
  }
}

export class KeybindingWriteRoute implements Route {
  public readonly method = 'POST';
  public readonly path = '/keybindings';
  public readonly limit: RouteLimit = 'control';
  public readonly credential: Credential = 'token';

  private readonly helper: KeybindingHelper;

  constructor(helper: KeybindingHelper) {
    this.helper = helper;
  }

  public handle(facts: RequestFacts, body: string): JsonResponse {
    const direction = parseDirection(body);
    if (direction === undefined) return json(400, { error: 'bad request' });

    const written = this.helper.write(direction);
    if (written.ok) return json(200, written.value);
    return json(409, { error: 'refused', refusals: written.error });
  }
}

/**
 * `?direction=apply` | `?direction=restore`. Absent means `apply`, which is what the sheet asks.
 *
 * The capture is `[^&]*` and not `[a-z]+` deliberately. With the narrower one, `direction=APPLY`
 * did not match at all, so "a value this does not recognise" became "no value" and fell through to
 * the default — a parameter that silently means something other than what it says. Present and
 * unrecognised is a 400; only ABSENT is a default.
 */
function directionFrom(url: string | undefined): KeybindingDirection | undefined {
  const raw = /[?&]direction=([^&]*)/u.exec(url ?? '')?.[1];
  if (raw === undefined) return 'apply';
  return raw === 'apply' || raw === 'restore' ? raw : undefined;
}

function parseDirection(body: string): KeybindingDirection | undefined {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = (value as Record<string, unknown>)['direction'];
  return raw === 'apply' || raw === 'restore' ? raw : undefined;
}
