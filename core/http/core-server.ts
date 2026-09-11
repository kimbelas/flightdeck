// The loopback HTTP surface. Binds, screens, dispatches, serialises — in that order, always.
//
// The screening is LoopbackGuard's, not this class's: P0-T7 settled which control refuses what,
// and CoreServer's job is to apply it to a real socket and to make the *reply* uniform. Every
// response leaves through `respond()`, so `no-store` and the generic body are structural rather
// than remembered — a client never learns why it was refused, and the reason goes to the local
// log only (SECURITY.md §11 rule 6).
//
// A stream route is the one thing that does not leave through `respond()`, because it has no
// single response to serialise — it is screened by the same guard and then handed to `SseStream`,
// which owns every byte it writes. "Nothing but one class writes to a socket" is the rule that
// survives; which class it is depends on the route (route.ts, P1-T9).
//
// There is no unauthenticated route, `/health` included. The deck never needs one: it reads the
// token server-side in proxy.ts, and a core that is down fails the connection rather than
// answering, which is the same signal (RESEARCH.md F.3.3).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { LOOPBACK_ADDRESS } from '../../contracts/origins.ts';
import type { Logger } from '../ports/logger.ts';
import { budgetFor } from './limits.ts';
import type { LoopbackGuard, RequestFacts, Rejection } from './loopback-guard.ts';
import type { RateLimiter } from './rate-limiter.ts';
import type { RequestRouter } from './request-router.ts';
import { json, type JsonResponse, type Route, type StreamRoute } from './route.ts';
import { SseStream } from './sse-stream.ts';

/** Methods that carry no body, and so cannot carry a Content-Type to screen (SEC-HTTP-4). */
const BODYLESS: readonly string[] = ['GET', 'HEAD'];

const NO_STORE_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

/** Added to a `413` only. See `refuseOversize` — the connection cannot survive a refused body. */
const CLOSE_HEADERS: Readonly<Record<string, string>> = { connection: 'close' };

/**
 * Everything the server dispatches to.
 *
 * Named fields rather than four positional arguments: `router` and `streams` are both "the list of
 * things that answer", and a call site that transposed them would compile and then 404 every route
 * — the same reasoning that gave PtySocketServer a parts object in P5a-T2b.
 */
export interface CoreServerParts {
  readonly guard: LoopbackGuard;
  readonly router: RequestRouter<Route>;
  /** Routes that take over the socket. Empty is normal; a server with no stream still works. */
  readonly streams: RequestRouter<StreamRoute>;
  /** SEC-HTTP-6. Shared with the routes that limit per session rather than per token. */
  readonly limiter: RateLimiter;
  readonly logger: Logger;
}

export class CoreServer {
  private readonly guard: LoopbackGuard;
  private readonly router: RequestRouter<Route>;
  private readonly streams: RequestRouter<StreamRoute>;
  private readonly limiter: RateLimiter;
  private readonly logger: Logger;
  private readonly server: Server;

  constructor(parts: CoreServerParts) {
    this.guard = parts.guard;
    this.router = parts.router;
    this.streams = parts.streams;
    this.limiter = parts.limiter;
    this.logger = parts.logger;
    this.server = createServer((request, response) => {
      void this.dispatch(request, response);
    });
  }

  /** The underlying server, for the WebSocket upgrade in P5a-T2. Not for writing responses. */
  public get raw(): Server {
    return this.server;
  }

  /**
   * Binds 127.0.0.1 only, and rejects rather than falling back if the port is taken.
   *
   * A second core on another port would issue a second token and answer with a stale session list,
   * which is worse than not starting (SECURITY.md §7 rule 1).
   */
  public listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, LOOPBACK_ADDRESS, () => {
        this.server.removeListener('error', reject);
        this.logger.info('core_listening', { address: LOOPBACK_ADDRESS, port });
        resolve();
      });
    });
  }

  public close(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        resolve();
      });
    });
  }

  private async dispatch(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const facts: RequestFacts = {
      method: request.method,
      url: request.url,
      headers: request.headers,
    };
    const rejection = this.screen(facts);
    if (rejection !== undefined) {
      this.logger.warn('request_denied', { control: rejection.control, reason: rejection.reason });
      respond(response, json(rejection.status, { error: 'refused' }));
      return;
    }

    const method = request.method ?? 'GET';
    const path = pathOf(request.url);

    // Before the JSON router, because a stream answers with the socket rather than with a value:
    // there is no `JsonResponse` for it to return and nothing for `respond` to serialise.
    const streamRoute = this.streams.find(method, path);
    if (streamRoute !== undefined) {
      this.openStream(streamRoute, request, response, facts);
      return;
    }

    await this.serve(this.router.find(method, path), request, response, facts);
  }

  /** Reads the body, runs the handler, and turns anything either of them throws into a status. */
  private async serve(
    route: Route | undefined,
    request: IncomingMessage,
    response: ServerResponse,
    facts: RequestFacts,
  ): Promise<void> {
    if (route === undefined) {
      respond(response, json(404, { error: 'not found' }));
      return;
    }

    const budget = budgetFor(route.limit);
    // Per token, and only on the routes a person drives: the ingest routes are limited per session
    // id inside the handler, because one runaway session must not be able to spend the budget of
    // the nine that are behaving (SEC-HTTP-6).
    if (route.limit === 'control' && !this.allowed(facts)) {
      this.logger.warn('request_denied', { control: 'SEC-HTTP-6', reason: 'rate' });
      respond(response, json(429, { error: 'too many requests' }));
      return;
    }

    try {
      const body = await readBody(request, budget.bodyBytes);
      respond(response, await route.handle(facts, body));
    } catch (cause) {
      if (cause instanceof Error && cause.message === OVERSIZE) {
        this.refuseOversize(request, response, budget.bodyBytes);
        return;
      }
      this.logger.warn('route_failed', { path: pathOf(request.url) });
      respond(response, json(500, { error: 'internal' }));
    }
  }

  /**
   * Answers `413` and then hangs up — P1-T10's open question, settled (RESEARCH.md F.4.5).
   *
   * Three things have to happen together, and each of them was found by getting it wrong.
   *
   *  1. **Write the status first.** The old path destroyed the socket the moment the cap was
   *     passed, so a sender that merely sent too much saw `ECONNRESET` and could not tell "too
   *     large" from "core died mid-request".
   *  2. **Say `Connection: close`.** The sender is mid-body, so the connection cannot be reused
   *     whatever we do — and a client that was not told keeps the socket in its pool and fails its
   *     NEXT request on it. For a hook client that is an error banner in a live session for
   *     something it did a request ago (F.1.5). Measured: without this header the following
   *     request on the same agent gets `ECONNRESET`.
   *  3. **Then destroy it.** Node would otherwise drain the rest of the body to make the
   *     connection reusable, which is to say it would read the gigabyte we just refused.
   */
  private refuseOversize(request: IncomingMessage, response: ServerResponse, limit: number): void {
    const rejection = this.guard.oversize(limit);
    this.logger.warn('request_denied', { control: rejection.control, reason: rejection.reason });
    response.once('finish', () => {
      request.destroy();
    });
    respond(response, json(rejection.status, { error: 'too large' }), CLOSE_HEADERS);
  }

  /** One bucket for the token, which is one per boot — so this is the deck's whole allowance. */
  private allowed(facts: RequestFacts): boolean {
    const header = facts.headers['authorization'];
    const token = Array.isArray(header) ? header[0] : header;
    return this.limiter.allow(`control:${token ?? ''}`, budgetFor('control').perMinute);
  }

  /**
   * Hands one connection to a stream route and stops managing it.
   *
   * The `close` listener is this method's whole reason to exist: without it the route's
   * subscription and heartbeat outlive the socket, and an `EventSource` — which reconnects by
   * design — would leak one of each per reconnect, all day (RESEARCH.md F.6.8).
   */
  private openStream(
    route: StreamRoute,
    request: IncomingMessage,
    response: ServerResponse,
    facts: RequestFacts,
  ): void {
    const stream = new SseStream(response);
    response.on('close', () => {
      stream.close();
    });
    this.logger.info('stream_started', { path: pathOf(request.url) });
    route.open(stream, facts);
  }

  private screen(facts: RequestFacts): Rejection | undefined {
    const method = (facts.method ?? 'GET').toUpperCase();
    // A GET has no Content-Type to demand; screenStream is screenRequest without that one check.
    return BODYLESS.includes(method)
      ? this.guard.screenStream(facts)
      : this.guard.screenRequest(facts);
  }
}

/** A route is a literal path, so the query string is split off before matching (RequestRouter). */
function pathOf(url: string | undefined): string {
  return (url ?? '/').split('?')[0] ?? '/';
}

/** Thrown past `readBody` so `serve` can tell an oversize body from a handler that failed. */
const OVERSIZE = 'body_too_large';

/**
 * Reads at most `limit` bytes.
 *
 * It stops buffering at the cap and rejects immediately — it does NOT destroy the socket, because
 * the caller still has a `413` to write on it (`refuseOversize`). Nothing more is accumulated in
 * the meantime: whatever else the sender is still pushing lands in the kernel buffer and dies with
 * the connection.
 */
function readBody(request: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        request.pause();
        reject(new Error(OVERSIZE));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', reject);
  });
}

function respond(
  response: ServerResponse,
  result: JsonResponse,
  extra: Readonly<Record<string, string>> = {},
): void {
  response.writeHead(result.status, { ...NO_STORE_HEADERS, ...extra });
  response.end(JSON.stringify(result.body));
}
