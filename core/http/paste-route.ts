// `POST /pasted-images` — the browser hands over one image, core writes it and says where.
//
// The route decodes and does nothing else: `PastedImage` decides whether the bytes are an image
// and `PasteInbox` decides what the file is called. That split is the point — everything a client
// could lie about is checked by a class with no file system, and everything that touches a file
// system takes no string from the wire.
//
// **`application/json` with base64, not `multipart/form-data`.** Not a preference: SEC-HTTP-4
// requires a JSON content type on every POST precisely because it forces a CORS preflight that
// core never answers, and a multipart upload is a *simple request* — the one shape a page on
// another origin can send without being asked first. The third that base64 adds to the wire is
// the price of that control, and it is what the `paste` body budget is sized around.
//
// **Nothing here writes to a PTY** (SEC-WS-3). The path goes back to the page, which types it into
// its own pane over the authenticated socket, so the only thing that can put bytes in front of a
// session is still the socket bound to it.
import { PASTED_IMAGE_PATH } from '../../contracts/pasted-image.ts';
import type { PasteInbox } from '../application/paste-inbox.ts';
import type { Credential, RequestFacts } from './loopback-guard.ts';
import type { RouteLimit } from './limits.ts';
import { json, type JsonResponse, type Route } from './route.ts';

/** Strict base64: `Buffer.from` silently DROPS anything outside this, and would decode gibberish. */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/u;

export class PasteRoute implements Route {
  public readonly method = 'POST';
  public readonly path = PASTED_IMAGE_PATH;
  public readonly limit: RouteLimit = 'paste';
  public readonly credential: Credential = 'token';

  private readonly inbox: PasteInbox;

  constructor(inbox: PasteInbox) {
    this.inbox = inbox;
  }

  /** The request facts go unread: CoreServer screened the headers, and the body carries the rest. */
  public async handle(facts: RequestFacts, body: string): Promise<JsonResponse> {
    const request = parsePasteBody(body);
    if (request === undefined) return json(400, { error: 'bad request' });

    const written = await this.inbox.accept(request.kind, request.bytes);
    // The refusal is named back. It is not a leak — the client supplied both halves of what was
    // refused — and "that was 9 MB" is the difference between a fixable paste and a dead button.
    if (!written.ok)
      return json(written.error === 'too_large' ? 413 : 400, { error: written.error });
    return json(201, { path: written.value });
  }
}

interface PasteBody {
  readonly kind: unknown;
  readonly bytes: Uint8Array;
}

/**
 * `{ kind, data }` → bytes, or `undefined`.
 *
 * `kind` deliberately stays `unknown` all the way to the domain: this function's job is the
 * envelope, and a second opinion here about which kinds exist is a second list to keep in step.
 */
function parsePasteBody(body: string): PasteBody | undefined {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const fields = value as Record<string, unknown>;

  const data = fields['data'];
  if (typeof data !== 'string' || data.length === 0) return undefined;
  if (data.length % 4 !== 0 || !BASE64.test(data)) return undefined;

  return { kind: fields['kind'], bytes: new Uint8Array(Buffer.from(data, 'base64')) };
}
