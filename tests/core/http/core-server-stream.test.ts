// `GET /stream` over a real socket — the wiring P1-T9 added to CoreServer.
//
// Split from core-server.test.ts because it is a different contract: a stream answers with the
// socket rather than with a value, so none of the assertions about a uniform JSON reply apply to
// it, and the two halves were one file over the size limit.
//
// `node:http` rather than `fetch`, for the same reason as the other half: undici will not let a
// caller set `Host`, and forging `Host` is the attack SEC-HTTP-1 answers.
import { request as httpRequest, type ClientRequest } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UI_ORIGIN } from '../../../contracts/origins.ts';
import { ConsoleLogger } from '../../../core/adapters/console-logger.ts';
import { CoreServer } from '../../../core/http/core-server.ts';
import { LoopbackGuard } from '../../../core/http/loopback-guard.ts';
import { RateLimiter } from '../../../core/http/rate-limiter.ts';
import { RequestRouter } from '../../../core/http/request-router.ts';
import type { EventStream, Route, StreamRoute } from '../../../core/http/route.ts';
import { SystemClock } from '../../../core/ports/clock.ts';

const TOKEN = 'c'.repeat(64);
const BODY_LIMIT = 1024;
const EPHEMERAL = 0;

interface Reply {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: string;
}

/** Reads a stream to completion. Only usable against a route that ends one. */
function call(port: number, path: string, headers: Record<string, string>): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const clientRequest = httpRequest({ host: '127.0.0.1', port, path, headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    clientRequest.on('error', reject);
    clientRequest.end();
  });
}

// A refusal logs by design, and a passing test should still be quiet.
const silent = new ConsoleLogger({ write: () => true } as unknown as NodeJS.WritableStream);

function guardFor(forPort: number): LoopbackGuard {
  return new LoopbackGuard({
    port: forPort,
    uiOrigin: UI_ORIGIN,
    token: TOKEN,
    bodyLimitBytes: BODY_LIMIT,
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
  private readonly streams: EventStream[] = [];

  public get openStreams(): number {
    return this.streams.length;
  }

  public open(stream: EventStream): void {
    this.streams.push(stream);
    stream.onClose(() => {
      this.closed += 1;
    });
  }

  /** What `Core.shutdown` does, on the class that owns the streams. */
  public closeAll(): void {
    for (const stream of [...this.streams]) stream.close();
    this.streams.length = 0;
  }
}

/**
 * A server of its own on a free port, for a test that closes it.
 *
 * The guard matches on host:port, so the port has to be known before the guard is built — hence
 * the bind-and-release probe. A permissive stand-in would test a screen that never ships.
 */
async function serverOn(streams: readonly StreamRoute[]): Promise<{
  server: CoreServer;
  port: number;
}> {
  const probe = new CoreServer({
    guard: guardFor(0),
    router: new RequestRouter<Route>([]),
    streams: new RequestRouter<StreamRoute>([]),
    limiter: new RateLimiter(new SystemClock()),
    logger: silent,
  });
  await probe.listen(EPHEMERAL);
  const address = probe.raw.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await probe.close();

  const server = new CoreServer({
    guard: guardFor(port),
    router: new RequestRouter<Route>([]),
    streams: new RequestRouter<StreamRoute>(streams),
    limiter: new RateLimiter(new SystemClock()),
    logger: silent,
  });
  await server.listen(port);
  return { server, port };
}

/** Opens a stream and keeps it open. The caller destroys the socket when it is done with it. */
function hold(port: number, path: string, headers: Record<string, string>): ClientRequest {
  const clientRequest = httpRequest({ host: '127.0.0.1', port, path, headers });
  clientRequest.end();
  return clientRequest;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
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

describe('CoreServer — streams', () => {
  let port = 0;
  let server: CoreServer;
  const authorised = { authorization: `Bearer ${TOKEN}`, origin: UI_ORIGIN };
  const held = new HeldOpenRoute();

  beforeAll(async () => {
    const started = await serverOn([new OneFrameRoute(), held]);
    server = started.server;
    port = started.port;
  });

  afterAll(async () => {
    held.closeAll();
    await server.close();
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

  it('does not finish closing while a stream is open', async () => {
    const held = new HeldOpenRoute();
    const { server: alone, port: alonePort } = await serverOn([held]);
    const client = hold(alonePort, '/held', authorised);
    await waitFor(() => held.openStreams > 0);

    let finished = false;
    const closing = alone.close().then(() => {
      finished = true;
    });
    await pause(250);

    // `close()` waits for open connections to end, and an SSE response never does on its own.
    expect(finished).toBe(false);

    // Worse than it looks, and measured rather than assumed: ending the stream NOW would not help.
    // `close()` reaps the idle connections once, on the way in, and stops the interval that would
    // reap them later — so a stream that finishes after that point leaves a keep-alive socket
    // nothing is left to collect. Only the client going away frees it, which is why shutdown
    // closes the streams first rather than in any order (core/main.ts `stopCore`).
    client.destroy();
    await closing;
    expect(finished).toBe(true);
  });

  it('finishes closing when the streams are closed first, which is the shutdown order', async () => {
    const held = new HeldOpenRoute();
    const { server: alone, port: alonePort } = await serverOn([held]);
    const client = hold(alonePort, '/held', authorised);
    await waitFor(() => held.openStreams > 0);

    held.closeAll();
    await alone.close();

    // Reached at all = core exits on Ctrl+C with a deck open. The test times out if it does not.
    expect(held.closed).toBe(1);
    client.destroy();
  });
});
