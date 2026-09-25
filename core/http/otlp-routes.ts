// `POST /v1/metrics` and `POST /v1/logs` — the optional OTLP/http-json receiver (P7-T5).
//
// Registered only when core was started with `FLIGHTDECK_OTLP=1` (routes.ts); otherwise these
// paths do not exist. Two classes in one file, like keybindings-route.ts: they are one receiver
// with two signals, and a reader looking for "where does telemetry come in" wants both.
//
// **Every rule `/hooks` follows, for its reasons.** The sender is a Claude Code session, so the
// route answers and gets out of the way; the success body is a constant, never assembled from what
// arrived; a refusal is a generic body and a log line naming the reason and nothing else — a
// payload that reached this far carries the owner's email on every point (SEC-DATA-2).
//
// **`200 {}` is the OTLP success reply.** An `Export*ServiceResponse` with no `partialSuccess` is
// "all accepted"; points this receiver skips are skipped by choice, not rejected, and a
// `partialSuccess` would only put a warning in the session's debug log every minute.
//
// **Rate limited per signal, not per session.** One export carries every session in that process
// for the interval, so the session is not known until the body is parsed — and it is the parse
// the budget is there to protect.
import { parseJsonBody } from '../../contracts/hook-event.ts';
import { parseOtlpLogs } from '../../contracts/otlp-logs.ts';
import { parseOtlpMetrics } from '../../contracts/otlp-metrics.ts';
import { OTLP_LOGS_PATH, OTLP_METRICS_PATH } from '../../contracts/otlp-receiver.ts';
import type { TelemetryTally } from '../application/telemetry-tally.ts';
import type { Logger } from '../ports/logger.ts';
import { BUDGETS, type RouteLimit } from './limits.ts';
import type { Credential, RequestFacts } from './loopback-guard.ts';
import type { RateLimiter } from './rate-limiter.ts';
import { json, type JsonResponse, type Route } from './route.ts';

/** The one success body — an `Export*ServiceResponse` with nothing to report. */
const ACK: Readonly<Record<string, never>> = {};

export interface OtlpRouteParts {
  readonly tally: TelemetryTally;
  readonly limiter: RateLimiter;
  readonly logger: Logger;
}

export class OtlpMetricsRoute implements Route {
  public readonly method = 'POST';
  public readonly path = OTLP_METRICS_PATH;
  /** Machine traffic from every session, once a minute each — the ingest budget. */
  public readonly limit: RouteLimit = 'ingest';
  /**
   * The ingest key as well as the token (SEC-HTTP-7): an exporter's headers are fixed when the
   * helper last ran, and a per-boot token would be stale for up to 29 minutes after every restart.
   */
  public readonly credential: Credential = 'token-or-ingest-key';

  private readonly parts: OtlpRouteParts;

  constructor(parts: OtlpRouteParts) {
    this.parts = parts;
  }

  /** @throws never. */
  public handle(request: RequestFacts, body: string): JsonResponse {
    const { tally, limiter, logger } = this.parts;
    if (!limiter.allow('otlp:metrics', BUDGETS.ingest.perMinute)) {
      logger.warn('otlp_rejected', { signal: 'metrics', reason: 'rate' });
      return json(429, { error: 'too many requests' });
    }
    const batch = parseOtlpMetrics(parseJsonBody(body));
    if (batch === undefined) {
      logger.warn('otlp_rejected', { signal: 'metrics', reason: 'unparseable' });
      return json(400, { error: 'bad request' });
    }
    tally.addPoints(batch.points, batch.skipped);
    return json(200, ACK);
  }
}

export class OtlpLogsRoute implements Route {
  public readonly method = 'POST';
  public readonly path = OTLP_LOGS_PATH;
  /** Every five seconds per process by default — the ingest budget, as for metrics. */
  public readonly limit: RouteLimit = 'ingest';
  /** As `OtlpMetricsRoute.credential`. */
  public readonly credential: Credential = 'token-or-ingest-key';

  private readonly parts: OtlpRouteParts;

  constructor(parts: OtlpRouteParts) {
    this.parts = parts;
  }

  /** @throws never. */
  public handle(request: RequestFacts, body: string): JsonResponse {
    const { tally, limiter, logger } = this.parts;
    if (!limiter.allow('otlp:logs', BUDGETS.ingest.perMinute)) {
      logger.warn('otlp_rejected', { signal: 'logs', reason: 'rate' });
      return json(429, { error: 'too many requests' });
    }
    const batch = parseOtlpLogs(parseJsonBody(body));
    if (batch === undefined) {
      logger.warn('otlp_rejected', { signal: 'logs', reason: 'unparseable' });
      return json(400, { error: 'bad request' });
    }
    tally.addEvents(batch.events, batch.skipped);
    return json(200, ACK);
  }
}
