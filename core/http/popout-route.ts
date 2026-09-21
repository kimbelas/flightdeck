// `POST /sessions/popout` — hand a session to Windows Terminal, detaching the pane first (P6-T2).
//
// Its own literal path beside `/sessions/stop` and `/sessions/resume`, for the reason routes.ts
// gives: each verb is its own row in the table that says what is reachable.
//
// **The body carries more than a `SessionRef`**, unlike its three neighbours, and the two extra
// fields are the ones a terminal needs and core cannot look up: what to call the tab and where to
// open it. Both come off the row already on screen. Neither reaches a command STRING — the title
// is sanitised where the argv is built and the folder is refused if it carries a separator
// (`WindowsTerminalCommands`), and both are array elements either way (SEC-PROC-1).
import { parseSessionRefPayload, type SessionRef } from '../../contracts/session-ref.ts';
import { MAX_PROJECT_PATH_CHARS } from '../../contracts/project.ts';
import type { SessionPopper } from '../application/session-popper.ts';
import type { RouteLimit } from './limits.ts';
import type { Credential, RequestFacts } from './loopback-guard.ts';
import { json, type JsonResponse, type Route } from './route.ts';

/** A tab title. Long enough for a session name and a project; capped where it is parsed. */
const MAX_TITLE_CHARS = 200;

export class PopoutRoute implements Route {
  public readonly method = 'POST';
  public readonly path = '/sessions/popout';
  public readonly limit: RouteLimit = 'control';

  public readonly credential: Credential = 'token';
  private readonly popper: SessionPopper;

  constructor(popper: SessionPopper) {
    this.popper = popper;
  }

  /** Facts go unread for `LaunchRoute`'s reason: CoreServer has already screened the request. */
  public async handle(facts: RequestFacts, body: string): Promise<JsonResponse> {
    const request = parseBody(body);
    if (request === undefined) return json(400, { error: 'bad_session' });

    const opened = await this.popper.popOut(request);
    // 200: a window was opened. Nothing was created here and nothing was deleted.
    if (opened.ok) return json(200, { detached: opened.value });
    return json(opened.error === 'no_terminal' ? 503 : 400, { error: opened.error });
  }
}

interface PopoutBody {
  readonly ref: SessionRef;
  readonly title: string;
  readonly cwd: string | undefined;
}

function parseBody(body: string): PopoutBody | undefined {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return undefined;
  }
  const ref = parseSessionRefPayload(value);
  if (ref === undefined) return undefined;
  if (typeof value !== 'object' || value === null) return undefined;
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value));
  return {
    ref,
    title: textAt(fields['title'], MAX_TITLE_CHARS) ?? ref.shortId,
    cwd: textAt(fields['cwd'], MAX_PROJECT_PATH_CHARS),
  };
}

/** A capped string, or `undefined` — the rule every optional field on this wire follows. */
function textAt(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string' || value === '' || value.length > max) return undefined;
  return value;
}
