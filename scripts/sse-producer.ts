// P0-T8 — a core-shaped SSE producer, so the buffering question is asked of a realistic stream.
//
// "It worked in dev" is not a finding, and neither is a stream of one-byte ticks. Two properties
// of the real thing decide whether a proxy batches: the events are SMALL (a session update is a
// few hundred bytes, far under any byte-threshold flush) and they arrive on a CADENCE with idle
// gaps between them. A padded or chatty producer hides exactly the bug this task exists to find.
//
// This is what P1-T7's `GET /stream` will look like from the outside — same screen, same headers,
// same event names — so the transport decision in DECISIONS.md D27 is made against the stream the
// deck will actually carry.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { LoopbackGuard } from '../core/http/loopback-guard.ts';

/** What core received, kept structurally so the harness never has to re-parse a log line. */
export interface SeenRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

export interface ProducerOptions {
  readonly port: number;
  readonly uiOrigin: string;
  readonly token: string;
  readonly cadenceMs: number;
  readonly events: number;
}

const SUBSCRIPTIONS = ['isg', '365'] as const;
const STATES = ['working', 'blocked', 'idle', 'done'] as const;

/**
 * Response headers for a stream.
 *
 * `no-transform` is not boilerplate. P0-T8 measured Next's rewrite gzipping a proxied
 * `text/event-stream`, and a compressor holds the whole stream until it ends — 10 events arrived
 * in one chunk after 2142 ms instead of one every 200 ms. `no-transform` is the only one of the
 * three candidate headers that stopped it; `Content-Encoding: identity` and `X-Accel-Buffering:
 * no` were both ignored (RESEARCH.md F.6.3).
 */
const STREAM_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-store, no-transform',
  'x-content-type-options': 'nosniff',
  connection: 'keep-alive',
};

/** One `session.updated` frame, shaped like the reconciler's output (SPEC.md §4). */
function sessionEvent(sequence: number, at: number): string {
  const payload = {
    type: 'session.updated',
    seq: sequence,
    at,
    session: {
      id: `9f2c${String(sequence).padStart(4, '0')}-0000-4000-8000-000000000000`,
      subscription: SUBSCRIPTIONS[sequence % SUBSCRIPTIONS.length],
      name: `fd-probe-${String(sequence)}`,
      state: STATES[sequence % STATES.length],
      model: 'claude-opus-5',
      contextPercent: 40 + (sequence % 30),
      costUsd: Number((sequence * 0.017).toFixed(3)),
    },
  };
  return `event: session.updated\nid: ${String(sequence)}\ndata: ${JSON.stringify(payload)}\n\n`;
}

/**
 * A loopback SSE server screened by the same `LoopbackGuard` the rest of P0 measured.
 *
 * Binds 127.0.0.1 explicitly (SEC-NET-1) and refuses anything the guard refuses, so a stream that
 * arrives here has already proved Host, Origin, Sec-Fetch-Site and token.
 */
export class SseProducer {
  private readonly options: ProducerOptions;
  private readonly guard: LoopbackGuard;
  private readonly server: Server;
  private readonly requests: SeenRequest[] = [];
  private open = 0;

  constructor(options: ProducerOptions) {
    this.options = options;
    this.guard = new LoopbackGuard({
      port: options.port,
      uiOrigin: options.uiOrigin,
      token: options.token,
      bodyLimitBytes: 64 * 1024,
    });
    this.server = createServer((request, response) => {
      this.route(request, response);
    });
  }

  /** Every request core saw, so the harness can report what the rewrite actually forwards. */
  public get seen(): readonly SeenRequest[] {
    return this.requests;
  }

  /**
   * Streams core still has open.
   *
   * The number that says whether a browser closing an EventSource actually reaches core. If it
   * does not, every reconnect leaves a producer running with nobody reading it — the HTTP form of
   * the leak SEC-WS-2 caps with an idle timeout.
   */
  public get activeStreams(): number {
    return this.open;
  }

  public start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.options.port, '127.0.0.1', () => {
        resolve();
      });
    });
  }

  public stop(): Promise<void> {
    this.server.closeAllConnections();
    return new Promise((resolve) => {
      this.server.close(() => {
        resolve();
      });
    });
  }

  private route(request: IncomingMessage, response: ServerResponse): void {
    const path = (request.url ?? '/').split('?')[0] ?? '/';
    this.requests.push({ method: request.method ?? '?', path, headers: request.headers });

    if (path === '/stream') {
      this.stream(request, response);
      return;
    }
    response.writeHead(404).end();
  }

  private stream(request: IncomingMessage, response: ServerResponse): void {
    const rejection = this.guard.screenStream({
      method: request.method,
      url: request.url,
      headers: request.headers,
    });
    if (rejection !== undefined) {
      response.writeHead(rejection.status, { 'content-type': 'text/plain' });
      response.end(`${rejection.control}\n`);
      return;
    }

    // `?transformable=1` is the control for F.6.3: the same stream with `no-transform` dropped,
    // so the harness can show the compressor batching it rather than assert that it would.
    const transformable = (request.url ?? '').includes('transformable=1');
    response.writeHead(200, {
      ...STREAM_HEADERS,
      ...(transformable ? { 'cache-control': 'no-store' } : {}),
    });
    this.open += 1;
    // The first event goes out immediately, which is both what core will do — a subscriber needs
    // the current state before it needs changes — and what makes "first event" a transport
    // measurement rather than a restatement of the cadence.
    let sequence = 0;
    response.write(sessionEvent(sequence, Date.now()));
    sequence += 1;

    const timer = setInterval(() => {
      response.write(sessionEvent(sequence, Date.now()));
      sequence += 1;
      if (sequence >= this.options.events) {
        clearInterval(timer);
        response.end();
      }
    }, this.options.cadenceMs);
    request.on('close', () => {
      clearInterval(timer);
      this.open -= 1;
    });
  }
}
