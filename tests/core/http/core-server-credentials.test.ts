// SEC-HTTP-7 over a real socket: the route decides which secrets authenticate it.
//
// Its own file because the change it pins is in `dispatch` — the route is now found BEFORE the
// screen runs, so the screen can be told what the route accepts. That reads backwards, and the one
// thing that makes it safe is that `find` is a Map lookup with no side effect. A test that proved
// only the guard in isolation would not have noticed if the server stopped passing the credential
// through at all, which is precisely the failure that would silently widen every route.
import { request as httpRequest } from 'node:http';
import { describe, expect, it } from 'vitest';
import { UI_ORIGIN } from '../../../contracts/origins.ts';
import { ConsoleLogger } from '../../../core/adapters/console-logger.ts';
import { CoreServer } from '../../../core/http/core-server.ts';
import { BUDGETS, type RouteLimit } from '../../../core/http/limits.ts';
import { type Credential, LoopbackGuard } from '../../../core/http/loopback-guard.ts';
import { RateLimiter } from '../../../core/http/rate-limiter.ts';
import { RequestRouter } from '../../../core/http/request-router.ts';
import { json, type JsonResponse, type Route, type StreamRoute } from '../../../core/http/route.ts';
import { SystemClock } from '../../../core/ports/clock.ts';

const TOKEN = 'd'.repeat(64);
const KEY = 'e'.repeat(64);
const silent = new ConsoleLogger({ write: () => true } as unknown as NodeJS.WritableStream);

class NamedRoute implements Route {
  public readonly method = 'POST';
  public readonly limit: RouteLimit = 'ingest';
  public readonly path: string;
  public readonly credential: Credential;

  constructor(path: string, credential: Credential) {
    this.path = path;
    this.credential = credential;
  }

  public handle(): JsonResponse {
    return json(200, { ok: true });
  }
}

async function serverOn(routes: readonly Route[]): Promise<{ server: CoreServer; port: number }> {
  const guardFor = (port: number): LoopbackGuard =>
    new LoopbackGuard({
      port,
      uiOrigin: UI_ORIGIN,
      token: TOKEN,
      ingestKey: KEY,
      bodyLimitBytes: BUDGETS.control.bodyBytes,
    });
  const empty = {
    router: new RequestRouter<Route>([]),
    streams: new RequestRouter<StreamRoute>([]),
    limiter: new RateLimiter(new SystemClock()),
    logger: silent,
  };
  const probe = new CoreServer({ guard: guardFor(0), ...empty });
  await probe.listen(0);
  const address = probe.raw.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await probe.close();

  const server = new CoreServer({
    guard: guardFor(port),
    router: new RequestRouter<Route>(routes),
    streams: new RequestRouter<StreamRoute>([]),
    limiter: new RateLimiter(new SystemClock()),
    logger: silent,
  });
  await server.listen(port);
  return { server, port };
}

function post(port: number, path: string, secret: string): Promise<number> {
  return new Promise((resolve) => {
    const clientRequest = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          host: `127.0.0.1:${String(port)}`,
          'content-type': 'application/json',
          authorization: `Bearer ${secret}`,
        },
      },
      (response) => {
        response.resume();
        response.on('end', () => {
          resolve(response.statusCode ?? 0);
        });
      },
    );
    clientRequest.on('error', () => {
      resolve(0);
    });
    clientRequest.end('{}');
  });
}

const ROUTES = [
  new NamedRoute('/ingest', 'token-or-ingest-key'),
  new NamedRoute('/strict', 'token'),
];

describe('per-route credentials over a socket (SEC-HTTP-7)', () => {
  it('lets the ingest key through on the route that declares it', async () => {
    const { server, port } = await serverOn(ROUTES);
    try {
      expect(await post(port, '/ingest', KEY)).toBe(200);
    } finally {
      await server.close();
    }
  });

  it('refuses the same key on a route that does not', async () => {
    const { server, port } = await serverOn(ROUTES);
    try {
      expect(await post(port, '/strict', KEY)).toBe(401);
    } finally {
      await server.close();
    }
  });

  it('takes the token on both', async () => {
    const { server, port } = await serverOn(ROUTES);
    try {
      expect(await post(port, '/ingest', TOKEN)).toBe(200);
      expect(await post(port, '/strict', TOKEN)).toBe(200);
    } finally {
      await server.close();
    }
  });

  it('screens an unknown path as strictly as any other — 401 before 404', async () => {
    const { server, port } = await serverOn(ROUTES);
    try {
      // Finding no route must mean `token`, not "no credential declared, so accept anything".
      expect(await post(port, '/nope', KEY)).toBe(401);
      expect(await post(port, '/nope', TOKEN)).toBe(404);
    } finally {
      await server.close();
    }
  });
});
