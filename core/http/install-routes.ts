// The version chip's three verbs — P4-T5.
//
// Three routes in one file because they are one panel's worth, and because the split that matters
// is not between them but between the READ and the two WRITES:
//
//  - `GET /doctor` reads and changes nothing, so it is a GET and writes no audit row;
//  - `POST /update` can replace the binary every session on this machine then starts, and there is
//    no check-only form of it (RESEARCH.md F.10.2);
//  - `POST /sessions/respawn` restarts background sessions.
//
// Literal paths, no parameters, as every route here is (`routes.ts`): the subscription arrives in
// a body or a query and is matched against the closed union, never used as a path.
import { parseSessionRefPayload, type SessionRef } from '../../contracts/session-ref.ts';
import { SUBSCRIPTION_IDS, type SubscriptionId } from '../../contracts/session.ts';
import type { InstallDoctor } from '../application/install-doctor.ts';
import type { SessionRespawner } from '../application/session-respawner.ts';
import type { Credential, RequestFacts } from './loopback-guard.ts';
import type { RouteLimit } from './limits.ts';
import { json, type JsonResponse, type Route } from './route.ts';

/** `GET /doctor?subscription=365` — the installation's health, narrowed (SEC-DATA-2). */
export class DoctorRoute implements Route {
  public readonly method = 'GET';
  public readonly path = '/doctor';
  public readonly limit: RouteLimit = 'control';

  public readonly credential: Credential = 'token';
  private readonly doctor: InstallDoctor;

  constructor(doctor: InstallDoctor) {
    this.doctor = doctor;
  }

  /** The only GET of the three: the subscription arrives as a query, so the body goes unread. */
  public async handle(facts: RequestFacts): Promise<JsonResponse> {
    const subscription = subscriptionIn(facts.url);
    if (subscription === undefined) return json(400, { error: 'bad_subscription' });
    const health = await this.doctor.check(subscription);
    if (health.ok) return json(200, health.value);
    return json(health.error === 'no_claude' ? 503 : 502, { error: health.error });
  }
}

/**
 * `POST /update` — check for an update and install one if there is one.
 *
 * A POST although it takes almost nothing, because it is not safe and not idempotent: there is no
 * check-only form (F.10.2), so this is the button that can change the binary.
 */
export class UpdateRoute implements Route {
  public readonly method = 'POST';
  public readonly path = '/update';
  public readonly limit: RouteLimit = 'control';

  public readonly credential: Credential = 'token';
  private readonly doctor: InstallDoctor;

  constructor(doctor: InstallDoctor) {
    this.doctor = doctor;
  }

  public async handle(facts: RequestFacts, body: string): Promise<JsonResponse> {
    const subscription = subscriptionInBody(body);
    if (subscription === undefined) return json(400, { error: 'bad_subscription' });
    const updated = await this.doctor.update(subscription);
    if (updated.ok) return json(200, updated.value);
    return json(updated.error === 'no_claude' ? 503 : 502, { error: updated.error });
  }
}

/**
 * `POST /sessions/respawn` — one session by short id, or every one the CLI chooses.
 *
 * The body is either a `SessionRef` or `{subscription, all: true}`. Two shapes on one route rather
 * than two routes, unlike `rm`, because both are the same verb with the same blast radius class —
 * and unlike `rm` neither destroys anything, which is what earned that one its own path.
 */
export class RespawnRoute implements Route {
  public readonly method = 'POST';
  public readonly path = '/sessions/respawn';
  public readonly limit: RouteLimit = 'control';

  public readonly credential: Credential = 'token';
  private readonly respawner: SessionRespawner;

  constructor(respawner: SessionRespawner) {
    this.respawner = respawner;
  }

  public async handle(facts: RequestFacts, body: string): Promise<JsonResponse> {
    const all = allRequest(body);
    if (all !== undefined) return this.answer(await this.respawner.all(all));
    const ref = refIn(body);
    if (ref === undefined) return json(400, { error: 'bad_session' });
    return this.answer(await this.respawner.one(ref));
  }

  private answer(result: Awaited<ReturnType<SessionRespawner['one']>>): JsonResponse {
    if (result.ok) return json(200, result.value);
    return json(result.error === 'no_claude' ? 503 : 400, { error: result.error });
  }
}

/** `?subscription=` matched against the closed union — never used as a path (SECURITY §11 r2). */
function subscriptionIn(url: string | undefined): SubscriptionId | undefined {
  if (url === undefined) return undefined;
  const asked = new URL(url, 'http://127.0.0.1').searchParams.get('subscription');
  return SUBSCRIPTION_IDS.find((id) => id === asked);
}

function subscriptionInBody(body: string): SubscriptionId | undefined {
  const fields = readJson(body);
  return SUBSCRIPTION_IDS.find((id) => id === fields?.['subscription']);
}

/** `{subscription, all: true}`, or `undefined` for a body that is not one. */
function allRequest(body: string): SubscriptionId | undefined {
  const fields = readJson(body);
  if (fields?.['all'] !== true) return undefined;
  return SUBSCRIPTION_IDS.find((id) => id === fields['subscription']);
}

function refIn(body: string): SessionRef | undefined {
  const fields = readJson(body);
  return fields === undefined ? undefined : parseSessionRefPayload(fields);
}

function readJson(body: string): Readonly<Record<string, unknown>> | undefined {
  try {
    const value: unknown = JSON.parse(body);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    return Object.fromEntries(Object.entries(value));
  } catch {
    return undefined;
  }
}
