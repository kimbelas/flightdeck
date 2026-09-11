// SEC-HTTP-4's body caps and SEC-HTTP-6's rate limits, over a real socket — P1-T10's two open
// items, closed by P1-T5 (the task that added the first route that needs them).
//
// Its own file, and its own server per test, because a rate limit is state: a test that spends a
// budget would otherwise decide whether the test after it passes. That is also the bug this is
// guarding against in production, so it is worth the test suite obeying the same rule.
//
// `node:http` rather than `fetch`, as everywhere else here: undici will not let a caller set
// `Host`, and it hides a connection reset behind a generic `TypeError` — which is exactly the
// difference this file exists to measure (RESEARCH.md F.4.5).
import { request as httpRequest } from 'node:http';
import { describe, expect, it } from 'vitest';
import { UI_ORIGIN } from '../../../contracts/origins.ts';
import { ConsoleLogger } from '../../../core/adapters/console-logger.ts';
import { CoreServer } from '../../../core/http/core-server.ts';
import { BUDGETS, type RouteLimit } from '../../../core/http/limits.ts';
import { LoopbackGuard } from '../../../core/http/loopback-guard.ts';
import { RateLimiter } from '../../../core/http/rate-limiter.ts';
import { RequestRouter } from '../../../core/http/request-router.ts';
import { json, type JsonResponse, type Route, type StreamRoute } from '../../../core/http/route.ts';
import { SystemClock } from '../../../core/ports/clock.ts';

const TOKEN = 'c'.repeat(64);
const EPHEMERAL = 0;
const silent = new ConsoleLogger({ write: () => true } as unknown as NodeJS.WritableStream);
const authorised = {
  authorization: `Bearer ${TOKEN}`,
  origin: UI_ORIGIN,
  'content-type': 'application/json',
};

/** Answers 200 and reports what it was given, so a test can tell a refusal from a truncation. */
class EchoRoute implements Route {
  public readonly method = 'POST';
  public readonly limit: RouteLimit;
  public readonly path: string;

  constructor(path: string, limit: RouteLimit) {
    this.path = path;
    this.limit = limit;
  }

  public handle(request: unknown, body: string): JsonResponse {
    return json(200, { bytes: body.length });
  }
}

interface Reply {
  readonly status: number;
  readonly body: string;
}

/** A reply, or the socket error the client saw — the two outcomes F.4.5 was asking about. */
function call(port: number, path: string, payload: string): Promise<Reply | string> {
  return new Promise((resolve) => {
    const clientRequest = httpRequest(
      { host: '127.0.0.1', port, path, method: 'POST', headers: authorised },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString() });
        });
      },
    );
    clientRequest.on('error', (cause: NodeJS.ErrnoException) => {
      resolve(cause.code ?? 'ERROR');
    });
    clientRequest.end(payload);
  });
}

async function serverOn(routes: readonly Route[]): Promise<{ server: CoreServer; port: number }> {
  const guardFor = (forPort: number): LoopbackGuard =>
    new LoopbackGuard({
      port: forPort,
      uiOrigin: UI_ORIGIN,
      token: TOKEN,
      bodyLimitBytes: BUDGETS.control.bodyBytes,
    });
  const empty = {
    router: new RequestRouter<Route>([]),
    streams: new RequestRouter<StreamRoute>([]),
    limiter: new RateLimiter(new SystemClock()),
    logger: silent,
  };
  const probe = new CoreServer({ guard: guardFor(0), ...empty });
  await probe.listen(EPHEMERAL);
  const address = probe.raw.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await probe.close();

  const server = new CoreServer({
    guard: guardFor(port),
    router: new RequestRouter<Route>(routes),
    streams: new RequestRouter<StreamRoute>([]),
    // A limiter per server, so no test can spend another test's budget.
    limiter: new RateLimiter(new SystemClock()),
    logger: silent,
  });
  await server.listen(port);
  return { server, port };
}

function body(bytes: number): string {
  return JSON.stringify({ pad: 'x'.repeat(bytes) });
}

describe('the body cap (SEC-HTTP-4)', () => {
  it('accepts a control body under 64 KB', async () => {
    const { server, port } = await serverOn([new EchoRoute('/control', 'control')]);

    const reply = await call(port, '/control', body(1000));

    expect(reply).toMatchObject({ status: 200 });
    await server.close();
  });

  it('answers 413 rather than resetting the connection', async () => {
    // P1-T10 left this open: the old path destroyed the socket the moment the cap was passed, so a
    // hook that merely sent too much saw ECONNRESET and could not tell "too large" from "core
    // died mid-request" (RESEARCH.md F.4.5).
    const { server, port } = await serverOn([new EchoRoute('/control', 'control')]);

    const reply = await call(port, '/control', body(BUDGETS.control.bodyBytes + 1));

    expect(reply).toMatchObject({ status: 413 });
    expect(reply).not.toBe('ECONNRESET');
    await server.close();
  });

  it('says nothing but the status', async () => {
    const { server, port } = await serverOn([new EchoRoute('/control', 'control')]);

    const reply = await call(port, '/control', body(BUDGETS.control.bodyBytes + 1));

    expect(reply).toMatchObject({ body: '{"error":"too large"}' });
    await server.close();
  });

  it('lets an ingest route send far more than a control route may', async () => {
    // A hook's `tool_input` can be large, and a refused hook is not a dropped event — it is
    // `Stop hook error occurred` in front of the owner for every turn afterwards (F.1.5).
    const { server, port } = await serverOn([
      new EchoRoute('/control', 'control'),
      new EchoRoute('/hooks', 'ingest'),
    ]);
    const payload = body(BUDGETS.control.bodyBytes + 1);

    expect(await call(port, '/control', payload)).toMatchObject({ status: 413 });
    expect(await call(port, '/hooks', payload)).toMatchObject({ status: 200 });
    await server.close();
  });

  it('refuses an ingest body past 4 MB too, rather than having no cap at all', async () => {
    const { server, port } = await serverOn([new EchoRoute('/hooks', 'ingest')]);

    const reply = await call(port, '/hooks', body(BUDGETS.ingest.bodyBytes + 1));

    expect(reply).toMatchObject({ status: 413 });
    await server.close();
  });
});

describe('the rate limit (SEC-HTTP-6)', () => {
  it('allows the control budget and refuses past it', async () => {
    const { server, port } = await serverOn([new EchoRoute('/control', 'control')]);

    for (let index = 0; index < BUDGETS.control.perMinute; index += 1) {
      expect(await call(port, '/control', '{}')).toMatchObject({ status: 200 });
    }
    const refused = await call(port, '/control', '{}');

    expect(refused).toMatchObject({ status: 429, body: '{"error":"too many requests"}' });
    await server.close();
  });

  it('does not spend the control budget on an ingest route', async () => {
    // 60 a minute would make 600 hook events a minute impossible; the ingest routes count per
    // session id inside the handler instead (HooksRoute).
    const { server, port } = await serverOn([
      new EchoRoute('/control', 'control'),
      new EchoRoute('/hooks', 'ingest'),
    ]);

    for (let index = 0; index < BUDGETS.control.perMinute + 5; index += 1) {
      await call(port, '/hooks', '{}');
    }

    expect(await call(port, '/control', '{}')).toMatchObject({ status: 200 });
    await server.close();
  });
});
