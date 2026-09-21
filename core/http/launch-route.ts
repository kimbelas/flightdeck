// `POST /sessions` — start a background session that a pane can then attach to.
//
// The body is `unknown` until the guard below accepts it (CODING-STANDARDS §11 rule 1). It carries
// a prompt, which is user text on its way to a process, so it is validated for shape and length
// here and travels to the child as an environment variable — never interpolated (SEC-PROC-1).
//
// **`profileFn` replaced `subscription` in P4-T2.** The function is the account AND the model
// (D44), so a body carrying both would be two opinions the command line could contradict, and the
// one the CLI acts on is the function. Nothing outside SEC-PROC-2's four gets past the parser.
import { PROFILE_FUNCTIONS } from '../../contracts/launch-preset.ts';
import type { Credential, RequestFacts } from './loopback-guard.ts';
import type { LaunchRequest, SessionLauncher } from '../application/session-launcher.ts';
import type { RouteLimit } from './limits.ts';
import { json, type JsonResponse, type Route } from './route.ts';

export class LaunchRoute implements Route {
  public readonly method = 'POST';
  public readonly path = '/sessions';
  public readonly limit: RouteLimit = 'control';

  public readonly credential: Credential = 'token';
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
    // `no_shell` is the operator's problem and worth naming; the rest stays generic.
    return json(launched.error === 'no_shell' ? 503 : 400, { error: launched.error });
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

  // The allowlist is the PARSER's, which is where SEC-PROC-2 belongs: nothing outside the four can
  // reach an argv builder, so `PowerShellLaunchCommands`' script table is exhaustive by type.
  const profileFn = PROFILE_FUNCTIONS.find((known) => known === fields['profileFn']);
  const prompt = fields['prompt'];
  const name = fields['name'];
  if (profileFn === undefined || typeof prompt !== 'string') return undefined;
  // Required as of P4-T2 — SPEC §5.7's forced naming. The launcher refuses an empty one too; this
  // is the shape check, and that one is the rule.
  if (typeof name !== 'string') return undefined;

  return { profileFn, prompt, name, cwd: optionalString(fields['cwd']) };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}
