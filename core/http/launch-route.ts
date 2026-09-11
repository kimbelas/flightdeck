// `POST /sessions` — start a background session that a pane can then attach to.
//
// The body is `unknown` until the guard below accepts it (CODING-STANDARDS §11 rule 1). It carries
// a prompt, which is user text on its way to a process, so it is validated for shape and length
// here and passed as an argv element by SessionLauncher — never interpolated (SEC-PROC-1).
import { SUBSCRIPTION_IDS, type SubscriptionId } from '../../contracts/session.ts';
import type { RequestFacts } from './loopback-guard.ts';
import type { LaunchRequest, SessionLauncher } from '../application/session-launcher.ts';
import type { RouteLimit } from './limits.ts';
import { json, type JsonResponse, type Route } from './route.ts';

export class LaunchRoute implements Route {
  public readonly method = 'POST';
  public readonly path = '/sessions';
  public readonly limit: RouteLimit = 'control';
  private readonly launcher: SessionLauncher;

  constructor(launcher: SessionLauncher) {
    this.launcher = launcher;
  }

  /**
   * The request facts go unread: everything this route needs is in the body, and the screening
   * that would have used the headers already happened in CoreServer.
   */
  public async handle(facts: RequestFacts, body: string): Promise<JsonResponse> {
    const launch = parseLaunchBody(body);
    if (launch === undefined) return json(400, { error: 'bad request' });

    const launched = await this.launcher.launch(launch);
    if (launched.ok) return json(201, { sessionId: launched.value });
    // `no_claude` is the operator's problem and worth naming; the rest stays generic.
    return json(launched.error === 'no_claude' ? 503 : 400, { error: launched.error });
  }
}

function parseLaunchBody(body: string): LaunchRequest | undefined {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const fields = value as Record<string, unknown>;

  const subscription = fields['subscription'];
  const prompt = fields['prompt'];
  if (!isSubscriptionId(subscription) || typeof prompt !== 'string') return undefined;

  return {
    subscription,
    prompt,
    name: optionalString(fields['name']),
    cwd: optionalString(fields['cwd']),
  };
}

function isSubscriptionId(value: unknown): value is SubscriptionId {
  return typeof value === 'string' && SUBSCRIPTION_IDS.some((id) => id === value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}
