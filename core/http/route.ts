// What a handler is, and what it may return.
//
// Every route returns a plain value rather than writing to the response: a handler that owns the
// socket can forget the no-store header or send a stack trace, and both are security controls
// (SEC-HTTP-6, SECURITY.md §11 rule 6). CoreServer serialises; routes only decide.
//
// **A stream is the one exception, and it is narrowed rather than excused** (P1-T9). An SSE
// response is open for hours, so there is no single value to return — but a `StreamRoute` still
// never touches the socket: it is handed an `EventStream`, which is the only thing that writes, and
// the header block is that class's, not the route's. The structural guarantee is unchanged; what
// changes is which class holds it.
import type { RequestFacts } from './loopback-guard.ts';

export interface JsonResponse {
  readonly status: number;
  readonly body: unknown;
}

/** Method and path, exactly matched. Both kinds of route are found the same way (RequestRouter). */
export interface Routable {
  readonly method: string;
  readonly path: string;
}

export interface Route extends Routable {
  /** @throws never — a route that cannot answer returns a status, so one bad request is not a 500. */
  handle(request: RequestFacts, body: string): Promise<JsonResponse> | JsonResponse;
}

/**
 * One open server-sent-event connection, from the route's side.
 *
 * An interface rather than the `ServerResponse` so a route is unit-testable without a socket, and
 * so the SSE framing lives in exactly one class. Every method is safe to call after the client has
 * gone: a stream that has ended drops writes rather than throwing, because the alternative is a
 * producer that has to know whether a browser is still there (core/ports/event-sink.ts).
 */
export interface EventStream {
  /** Sends one frame. `data` is JSON-encoded, which is also what keeps it to a single line. */
  send(name: string, data: unknown): void;

  /** An SSE comment. Invisible to `EventSource`; it exists to prove the socket is still writable. */
  comment(text: string): void;

  /** Runs `handler` when the stream ends, from either side. Called once, or never. */
  onClose(handler: () => void): void;

  /** Ends it. Idempotent, and fires the close handlers exactly as a client disconnect does. */
  close(): void;
}

export interface StreamRoute extends Routable {
  /**
   * Takes over the connection. Returns immediately; the stream stays open until it is closed.
   *
   * The stream comes first because it is the subject and the facts are optional to a handler that
   * does not read the URL — a route may implement this with one parameter (CODING-STANDARDS §8:
   * a name that lies, including `request` on something that ignores it).
   *
   * @throws never — there is no status left to send by the time this is called, so a route that
   * cannot start closes the stream instead.
   */
  open(stream: EventStream, request: RequestFacts): void;
}

export function json(status: number, body: unknown): JsonResponse {
  return { status, body };
}
