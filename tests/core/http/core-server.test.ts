// The server over a real socket. LoopbackGuard's refusals are table-tested in its own file; this
// pins the wiring — that the screen is actually applied, and that every reply looks the same.
//
// `node:http` rather than `fetch`: undici refuses to let a caller set `Host`, and forging `Host`
// is precisely the attack SEC-HTTP-1 answers. A test that cannot send the hostile header cannot
// prove the refusal.
import { request as httpRequest } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UI_ORIGIN } from '../../../contracts/origins.ts';
import { ConsoleLogger } from '../../../core/adapters/console-logger.ts';
import { CoreServer } from '../../../core/http/core-server.ts';
import { HealthRoute } from '../../../core/http/health-route.ts';
import { LoopbackGuard } from '../../../core/http/loopback-guard.ts';
import { RequestRouter } from '../../../core/http/request-router.ts';
import type { EventStream, Route, StreamRoute } from '../../../core/http/route.ts';

const TOKEN = 'c'.repeat(64);
const BODY_LIMIT = 1024;
const EPHEMERAL = 0;

interface Reply {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: string;
}

function call(
  port: number,
  path: string,
  headers: Record<string, string>,
  payload?: string,
): Promise<Reply> {
  const method = payload === undefined ? 'GET' : 'POST';
  return new Promise((resolve, reject) => {
    const clientRequest = httpRequest(
      { host: '127.0.0.1', port, path, method, headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    clientRequest.on('error', reject);
    clientRequest.end(payload);
  });
}

/** Sends one frame and ends, so an ordinary buffered request can read a stream to completion. */
class OneFrameRoute implements StreamRoute {
  public readonly method = 'GET';
  public readonly path = '/stream';

  public open(stream: EventStream): void {
    stream.send('snapshot', { rows: [] });
    stream.close();
  }
}

/** Never ends on its own — the client going away is the only thing that can close it. */
class HeldOpenRoute implements StreamRoute {
  public readonly method = 'GET';
  public readonly path = '/held';
  public closed = 0;

  public open(stream: EventStream): void {
    stream.onClose(() => {
      this.closed += 1;
    });
  }
}

function guardFor(forPort: number): LoopbackGuard {
  return new LoopbackGuard({
    port: forPort,
    uiOrigin: UI_ORIGIN,
    token: TOKEN,
    bodyLimitBytes: BODY_LIMIT,
  });
}

/** Opens a request, waits for the first byte, then destroys the socket without reading the rest. */
function abandon(port: number, path: string, headers: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const clientRequest = httpRequest({ host: '127.0.0.1', port, path, headers }, (response) => {
      response.once('data', () => {
        clientRequest.destroy();
        resolve();
      });
    });
    clientRequest.on('error', reject);
    clientRequest.end();
  });
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('CoreServer', () => {
  let port = 0;
  let server: CoreServer;
  // A refusal logs by design, and a passing test should still be quiet.
  const silent = new ConsoleLogger({ write: () => true } as unknown as NodeJS.WritableStream);
  const authorised = { authorization: `Bearer ${TOKEN}`, origin: UI_ORIGIN };
  const held = new HeldOpenRoute();

  beforeAll(async () => {
    // The guard matches on host:port, so the real port has to be known before it is built. A
    // permissive stand-in here would test a screen that never ships.
    const probe = new CoreServer({
      guard: guardFor(0),
      router: new RequestRouter<Route>([]),
      streams: new RequestRouter<StreamRoute>([]),
      logger: silent,
    });
    await probe.listen(EPHEMERAL);
    const address = probe.raw.address();
    port = typeof address === 'object' && address !== null ? address.port : 0;
    await probe.close();

    server = new CoreServer({
      guard: guardFor(port),
      router: new RequestRouter<Route>([new HealthRoute('9.9.9')]),
      streams: new RequestRouter<StreamRoute>([new OneFrameRoute(), held]),
      logger: silent,
    });
    await server.listen(port);
  });

  afterAll(async () => {
    await server.close();
  });

  it('answers an authorised /health', async () => {
    const reply = await call(port, '/health', authorised);

    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toMatchObject({ status: 'ok', version: '9.9.9' });
  });

  it('marks every response no-store and nosniff', async () => {
    const reply = await call(port, '/health', authorised);

    expect(reply.headers['cache-control']).toBe('no-store');
    expect(reply.headers['x-content-type-options']).toBe('nosniff');
  });

  it('applies the host screen before anything else (SEC-HTTP-1)', async () => {
    const reply = await call(port, '/health', { ...authorised, host: 'evil.com' });

    expect(reply.status).toBe(421);
  });

  it('refuses a GET with no token, /health included (SEC-HTTP-3)', async () => {
    const reply = await call(port, '/health', { origin: UI_ORIGIN });

    expect(reply.status).toBe(401);
  });

  it('refuses a hostile origin (SEC-HTTP-2)', async () => {
    const reply = await call(port, '/health', { ...authorised, origin: 'http://evil.com' });

    expect(reply.status).toBe(403);
  });

  it('does not demand a Content-Type on a GET, which cannot carry one', async () => {
    const reply = await call(port, '/health', authorised);

    expect(reply.status).toBe(200);
  });

  it('demands application/json on a POST (SEC-HTTP-4)', async () => {
    const reply = await call(port, '/health', authorised, '{}');

    expect(reply.status).toBe(415);
  });

  it('tells a refused client nothing about which control refused it', async () => {
    const reply = await call(port, '/health', { ...authorised, origin: 'http://evil.com' });

    expect(reply.body).toBe('{"error":"refused"}');
    expect(reply.body).not.toContain('origin');
    expect(reply.body).not.toContain('SEC-');
  });

  it('404s an unknown path that passed the screen', async () => {
    const reply = await call(port, '/nope', authorised);

    expect(reply.status).toBe(404);
  });

  it('answers a stream route with the SSE headers rather than JSON (P1-T9)', async () => {
    const reply = await call(port, '/stream', authorised);

    expect(reply.status).toBe(200);
    expect(reply.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(reply.body).toContain('event: snapshot');
  });

  it('sends no-transform on a stream, which is the only thing that stops gzip batching it', async () => {
    const reply = await call(port, '/stream', authorised);

    // RESEARCH.md F.6.3: without it, twelve events arrive as one chunk at 2.2 s with a 200 OK.
    expect(reply.headers['cache-control']).toBe('no-store, no-transform');
  });

  it('screens a stream exactly like every other route (SEC-HTTP-3)', async () => {
    const reply = await call(port, '/stream', { origin: UI_ORIGIN });

    expect(reply.status).toBe(401);
    expect(reply.headers['content-type']).toBe('application/json; charset=utf-8');
  });

  it('tells the route when the client goes away, so its subscription does not outlive it', async () => {
    const before = held.closed;
    await abandon(port, '/held', authorised);

    // The socket closing is asynchronous; anything under a second is the measured behaviour
    // (RESEARCH.md F.6.8 — 0 streams open at core within a second on both transports).
    await waitFor(() => held.closed > before);
    expect(held.closed).toBe(before + 1);
  });

  it('refuses to bind a port that is already taken, rather than choosing another', async () => {
    const second = new CoreServer({
      guard: guardFor(port),
      router: new RequestRouter<Route>([]),
      streams: new RequestRouter<StreamRoute>([]),
      logger: silent,
    });

    await expect(second.listen(port)).rejects.toThrow(/EADDRINUSE/);
  });
});
