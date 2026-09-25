// P7-T5 — the OTLP receiver over a real socket, behind the real screen, on an ephemeral port.
//
// Over a socket rather than through `handle`, because the claims worth pinning are the server's:
// the paths do not exist when the switch is off, the ingest key is accepted on these two POSTs and
// nowhere else, and SEC-HTTP-4's Content-Type rule is what keeps protobuf out.
import { request as httpRequest } from 'node:http';
import { describe, expect, it } from 'vitest';
import { UI_ORIGIN } from '../../../contracts/origins.ts';
import { TelemetryTally } from '../../../core/application/telemetry-tally.ts';
import { CoreServer } from '../../../core/http/core-server.ts';
import { BUDGETS } from '../../../core/http/limits.ts';
import { LoopbackGuard } from '../../../core/http/loopback-guard.ts';
import { OtlpLogsRoute, OtlpMetricsRoute } from '../../../core/http/otlp-routes.ts';
import { RateLimiter } from '../../../core/http/rate-limiter.ts';
import { RequestRouter } from '../../../core/http/request-router.ts';
import type { Route, StreamRoute } from '../../../core/http/route.ts';
import { telemetryRoutes } from '../../../core/routes.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import {
  attr,
  logRecord,
  logsBody,
  metricsBody,
  SESSION,
  standard,
  sumMetric,
} from '../../contracts/otlp-payloads.ts';

const TOKEN = 'd'.repeat(64);
const KEY = 'e'.repeat(64);

interface Reply {
  readonly status: number;
  readonly body: string;
}

interface Running {
  readonly port: number;
  readonly tally: TelemetryTally;
  readonly logger: FakeLogger;
  readonly send: (method: string, path: string, options?: SendOptions) => Promise<Reply>;
  readonly close: () => Promise<void>;
}

interface SendOptions {
  readonly secret?: string;
  readonly body?: unknown;
  readonly contentType?: string;
}

function guardOn(port: number): LoopbackGuard {
  return new LoopbackGuard({
    port,
    uiOrigin: UI_ORIGIN,
    token: TOKEN,
    ingestKey: KEY,
    bodyLimitBytes: BUDGETS.control.bodyBytes,
  });
}

/** Port 0 first, to learn a free port, because the guard screens Host against the real one. */
async function start(enabled: boolean): Promise<Running> {
  const clock = new FakeClock();
  const logger = new FakeLogger();
  const limiter = new RateLimiter(clock);
  const tally = new TelemetryTally({ enabled, clock });
  const empty = { streams: new RequestRouter<StreamRoute>([]), limiter, logger };
  const probe = new CoreServer({
    guard: guardOn(0),
    router: new RequestRouter<Route>([]),
    ...empty,
  });
  await probe.listen(0);
  const address = probe.raw.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await probe.close();

  const router = new RequestRouter<Route>(telemetryRoutes({ tally, limiter, logger }));
  const server = new CoreServer({ guard: guardOn(port), router, ...empty });
  await server.listen(port);
  return {
    port,
    tally,
    logger,
    send: (method, path, options = {}) => send(port, method, path, options),
    close: () => server.close(),
  };
}

function send(port: number, method: string, path: string, options: SendOptions): Promise<Reply> {
  const payload = options.body === undefined ? '' : JSON.stringify(options.body);
  const headers: Record<string, string> = {
    host: `127.0.0.1:${String(port)}`,
    authorization: `Bearer ${options.secret ?? TOKEN}`,
  };
  if (method === 'POST') headers['content-type'] = options.contentType ?? 'application/json';
  return new Promise((resolve) => {
    const outgoing = httpRequest({ host: '127.0.0.1', port, path, method, headers }, (reply) => {
      const chunks: Buffer[] = [];
      reply.on('data', (chunk: Buffer) => chunks.push(chunk));
      reply.on('end', () => {
        resolve({ status: reply.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    outgoing.on('error', () => {
      resolve({ status: 0, body: '' });
    });
    outgoing.end(payload);
  });
}

const COST = metricsBody([
  sumMetric('claude_code.cost.usage', [
    { value: 0.5, attributes: [...standard(SESSION), attr('model', 'claude-opus-5')] },
  ]),
]);

async function within(enabled: boolean, body: (running: Running) => Promise<void>): Promise<void> {
  const running = await start(enabled);
  try {
    await body(running);
  } finally {
    await running.close();
  }
}

describe('the OTLP receiver, switched on', () => {
  it('takes a metrics export on the ingest key and answers the OTLP success body', async () => {
    await within(true, async ({ send, tally }) => {
      const reply = await send('POST', '/v1/metrics', { secret: KEY, body: COST });

      expect(reply).toEqual({ status: 200, body: '{}' });
      expect(tally.report().sessions[0]?.costUsd).toBe(0.5);
    });
  });

  it('takes a logs export on the ingest key', async () => {
    await within(true, async ({ send, tally }) => {
      const body = logsBody([logRecord('user_prompt', SESSION)]);

      expect((await send('POST', '/v1/logs', { secret: KEY, body })).status).toBe(200);
      expect(tally.report().sessions[0]?.events).toEqual({ user_prompt: 1 });
    });
  });

  it('answers what it summed on GET /telemetry, to the token only', async () => {
    await within(true, async ({ send }) => {
      await send('POST', '/v1/metrics', { secret: KEY, body: COST });

      const read = await send('GET', '/telemetry');
      expect(read.status).toBe(200);
      expect(read.body).toContain('"enabled":true');
      expect(read.body).toContain('"costUsd":0.5');
      expect((await send('GET', '/telemetry', { secret: KEY })).status).toBe(401);
    });
  });

  // http/protobuf is refused by the screen, before any route: SEC-HTTP-4 admits JSON only.
  it('refuses protobuf with 415', async () => {
    await within(true, async ({ send }) => {
      const reply = await send('POST', '/v1/metrics', {
        secret: KEY,
        body: COST,
        contentType: 'application/x-protobuf',
      });

      expect(reply.status).toBe(415);
    });
  });

  it('refuses a body that is not an export with 400, logging only the reason', async () => {
    await within(true, async ({ send, logger }) => {
      const reply = await send('POST', '/v1/logs', { secret: KEY, body: { hello: 'world' } });

      expect(reply.status).toBe(400);
      expect(logger.last?.details).toEqual({ signal: 'logs', reason: 'unparseable' });
    });
  });

  it('refuses a wrong secret with 401', async () => {
    await within(true, async ({ send }) => {
      expect((await send('POST', '/v1/metrics', { secret: 'x', body: COST })).status).toBe(401);
    });
  });

  it('has no traces path — traces are not received', async () => {
    await within(true, async ({ send }) => {
      expect((await send('POST', '/v1/traces', { body: {} })).status).toBe(404);
    });
  });
});

describe('the OTLP receiver, off — the default', () => {
  it('has no metrics or logs path at all', async () => {
    await within(false, async ({ send }) => {
      expect((await send('POST', '/v1/metrics', { body: COST })).status).toBe(404);
      expect((await send('POST', '/v1/logs', { body: logsBody([]) })).status).toBe(404);
    });
  });

  // An unknown path is screened as strictly as a real one — the key buys nothing here.
  it('refuses the ingest key rather than answering 404 to it', async () => {
    await within(false, async ({ send }) => {
      expect((await send('POST', '/v1/metrics', { secret: KEY, body: COST })).status).toBe(401);
    });
  });

  it('still answers GET /telemetry, saying it is off', async () => {
    await within(false, async ({ send }) => {
      const read = await send('GET', '/telemetry');

      expect(read.status).toBe(200);
      expect(JSON.parse(read.body)).toMatchObject({ enabled: false, sessions: [] });
    });
  });
});

describe('the OTLP routes, on their own', () => {
  it('declares the ingest budget and the ingest credential', () => {
    const tally = new TelemetryTally({ enabled: true, clock: new FakeClock() });
    const parts = { tally, limiter: new RateLimiter(new FakeClock()), logger: new FakeLogger() };

    for (const route of [new OtlpMetricsRoute(parts), new OtlpLogsRoute(parts)]) {
      expect(route.method).toBe('POST');
      expect(route.limit).toBe('ingest');
      expect(route.credential).toBe('token-or-ingest-key');
    }
  });

  it('refuses past the ingest budget with 429, per signal', () => {
    const clock = new FakeClock();
    const tally = new TelemetryTally({ enabled: true, clock });
    const parts = { tally, limiter: new RateLimiter(clock), logger: new FakeLogger() };
    const metrics = new OtlpMetricsRoute(parts);
    const logs = new OtlpLogsRoute(parts);
    const facts = { method: 'POST', url: '/v1/metrics', headers: {} };
    const body = JSON.stringify(COST);

    for (let n = 0; n < BUDGETS.ingest.perMinute; n += 1) {
      expect(metrics.handle(facts, body).status).toBe(200);
    }

    expect(metrics.handle(facts, body).status).toBe(429);
    expect(logs.handle(facts, JSON.stringify(logsBody([]))).status).toBe(200);
  });
});
