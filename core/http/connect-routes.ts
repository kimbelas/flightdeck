// `GET /connect` and `POST /connect` — the plan, then the write (P4-T6, D13, SEC-FS-3).
//
// Two routes on one path, exactly as `keybindings-route.ts` is, and for the same structural
// argument: a GET that cannot write cannot be talked into writing early, so "the owner sees the
// whole diff before a byte moves" is kept by the shape rather than by remembering to.
//
// **The POST re-plans from what is on disk NOW** rather than trusting anything the page sends. The
// browser has no say in what gets written: not a path, not a byte of content, not which
// subscription. All it carries is `direction`, and both directions are a closed union
// (`ConnectDirection`). A file that moved between the diff and the button comes back as a refusal
// from `Connector.apply`, which re-reads and compares `before` — not as a surprise on disk.
//
// **Both writes audit, and the read does not** — P4-T5's rule. `doctor` writes no row because a row
// per panel open would bury the rows a reviewer looks for; the same is true of a diff nobody
// pressed. Connect and Disconnect are the two most consequential writes core can make to somebody
// else's config, so they are rows whether they succeeded or not (SEC-PROC-3).
import type { AppliedChange, ConnectDirection } from '../../contracts/connect-plan.ts';
import type { AuditLog } from '../application/audit-log.ts';
import type { Connector } from '../application/connector.ts';
import type { Credential, RequestFacts } from './loopback-guard.ts';
import type { RouteLimit } from './limits.ts';
import { json, type JsonResponse, type Route } from './route.ts';

export class ConnectPlanRoute implements Route {
  public readonly method = 'GET';
  public readonly path = '/connect';
  public readonly limit: RouteLimit = 'control';
  public readonly credential: Credential = 'token';

  private readonly connector: Connector;

  constructor(connector: Connector) {
    this.connector = connector;
  }

  public handle(facts: RequestFacts): JsonResponse {
    const direction = directionFrom(facts.url);
    if (direction === undefined) return json(400, { error: 'bad request' });
    return json(200, { direction, plan: this.connector.plan(direction) });
  }
}

export class ConnectWriteRoute implements Route {
  public readonly method = 'POST';
  public readonly path = '/connect';
  public readonly limit: RouteLimit = 'control';
  public readonly credential: Credential = 'token';

  private readonly connector: Connector;
  private readonly audit: AuditLog;

  constructor(connector: Connector, audit: AuditLog) {
    this.connector = connector;
    this.audit = audit;
  }

  /**
   * Plans afresh, then writes it.
   *
   * A refusal is a 409 carrying core's own sentence AND whatever had already been written, because
   * a Connect that stopped half way has already taken backups and the operator needs to be told
   * where they are. `applied` is therefore on both answers, not only the good one.
   */
  public async handle(facts: RequestFacts, body: string): Promise<JsonResponse> {
    const direction = parseDirection(body);
    if (direction === undefined) return json(400, { error: 'bad request' });

    const plan = this.connector.plan(direction);
    if (!plan.ok) {
      this.record(direction, 'refused', [], 'the plan was refused');
      return json(409, { error: 'refused', reason: 'the plan was refused', applied: [] });
    }

    const outcome = await this.connector.apply(direction, plan);
    if (!outcome.ok) {
      this.record(direction, 'refused', outcome.applied, outcome.reason);
      return json(409, { error: 'refused', reason: outcome.reason, applied: outcome.applied });
    }
    this.record(direction, 'ok', outcome.applied);
    return json(200, {
      direction,
      applied: outcome.applied,
      environment: plan.environment,
      environmentLabel: plan.environmentLabel,
      alreadyDone: plan.alreadyDone,
    });
  }

  /**
   * One row per press.
   *
   * `target` is the direction rather than a path, because this write is machine-wide: it is both
   * config directories and the shared statusline.py, and naming one of them would be the row
   * claiming a narrower blast radius than the action has. The paths go in `args`, where a reader
   * looking for "which files" finds all of them.
   */
  private record(
    direction: ConnectDirection,
    outcome: 'ok' | 'refused',
    applied: readonly AppliedChange[],
    reason?: string,
  ): void {
    this.audit.record({
      action: `flightdeck_${direction}`,
      target: direction,
      args: applied.map((change) => change.path),
      outcome,
      ...(reason === undefined ? {} : { reason }),
    });
  }
}

/**
 * `?direction=connect` | `?direction=disconnect`. Absent means `connect`, which is what a panel
 * opening for the first time asks.
 *
 * Present and unrecognised is a 400; only ABSENT is a default. `directionFrom` in
 * `keybindings-route.ts` learned that the hard way — a narrower capture made `direction=CONNECT`
 * match nothing at all, so "a value this does not recognise" quietly became "no value".
 */
function directionFrom(url: string | undefined): ConnectDirection | undefined {
  const raw = /[?&]direction=([^&]*)/u.exec(url ?? '')?.[1];
  if (raw === undefined) return 'connect';
  return asDirection(raw);
}

function parseDirection(body: string): ConnectDirection | undefined {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  return asDirection(Object.fromEntries(Object.entries(value))['direction']);
}

function asDirection(raw: unknown): ConnectDirection | undefined {
  return raw === 'connect' || raw === 'disconnect' ? raw : undefined;
}
