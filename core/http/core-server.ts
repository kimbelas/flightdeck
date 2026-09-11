// The loopback HTTP surface. Binds, screens, dispatches, serialises — in that order, always.
//
// The screening is LoopbackGuard's, not this class's: P0-T7 settled which control refuses what,
// and CoreServer's job is to apply it to a real socket and to make the *reply* uniform. Every
// response leaves through `respond()`, so `no-store` and the generic body are structural rather
// than remembered — a client never learns why it was refused, and the reason goes to the local
// log only (SECURITY.md §11 rule 6).
//
// There is no unauthenticated route, `/health` included. The deck never needs one: it reads the
// token server-side in proxy.ts, and a core that is down fails the connection rather than
// answering, which is the same signal (RESEARCH.md F.3.3).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { LOOPBACK_ADDRESS } from '../../contracts/origins.ts';
import type { Logger } from '../ports/logger.ts';
import type { LoopbackGuard, RequestFacts, Rejection } from './loopback-guard.ts';
import type { RequestRouter } from './request-router.ts';
import { json, type JsonResponse } from './route.ts';

/** Methods that carry no body, and so cannot carry a Content-Type to screen (SEC-HTTP-4). */
const BODYLESS: readonly string[] = ['GET', 'HEAD'];

const NO_STORE_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

export class CoreServer {
  private readonly guard: LoopbackGuard;
  private readonly router: RequestRouter;
  private readonly logger: Logger;
  private readonly server: Server;

  constructor(guard: LoopbackGuard, router: RequestRouter, logger: Logger) {
    this.guard = guard;
    this.router = router;
    this.logger = logger;
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

    const route = this.router.find(request.method ?? 'GET', pathOf(request.url));
    if (route === undefined) {
      respond(response, json(404, { error: 'not found' }));
      return;
    }

    try {
      const body = await readBody(request, this.guard.bodyLimitBytes);
      respond(response, await route.handle(facts, body));
    } catch (cause) {
      const oversize = cause instanceof Error && cause.message === 'body_too_large';
      const rejected = oversize ? this.guard.oversize(this.guard.bodyLimitBytes) : undefined;
      this.logger.warn('route_failed', { path: pathOf(request.url), oversize });
      respond(
        response,
        json(rejected?.status ?? 500, { error: oversize ? 'too large' : 'internal' }),
      );
    }
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

/** Reads at most `limit` bytes, destroying the socket rather than buffering past the cap. */
function readBody(request: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        request.destroy();
        reject(new Error('body_too_large'));
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

function respond(response: ServerResponse, result: JsonResponse): void {
  response.writeHead(result.status, NO_STORE_HEADERS);
  response.end(JSON.stringify(result.body));
}
