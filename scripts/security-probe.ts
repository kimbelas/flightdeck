// P0-T7 — the target: a loopback server shaped like core, screened by LoopbackGuard.
//
// The server binds 127.0.0.1 explicitly (SEC-NET-1) and screens with LoopbackGuard, recording
// every decision so the probe can report which control refused rather than only that something
// did. The origins that attack it live in page-origin.ts.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  LoopbackGuard,
  type ControlId,
  type GuardOptions,
  type Rejection,
} from '../core/http/loopback-guard.ts';

/** One screening decision, in the order it happened. */
export interface Decision {
  readonly kind: 'http' | 'upgrade' | 'frame';
  readonly label: string;
  readonly accepted: boolean;
  readonly status: number;
  readonly control: ControlId | '-';
  readonly reason: string;
}

const FIRST_FRAME_TIMEOUT_MS = 2_000;

/** Loopback-only, screened by LoopbackGuard, and it writes down what it decided and why. */
export class ProbeServer {
  private readonly guard: LoopbackGuard;
  private readonly options: GuardOptions;
  private readonly server: Server;
  private readonly sockets: WebSocketServer;
  private readonly decisions: Decision[] = [];

  constructor(options: GuardOptions) {
    this.options = options;
    this.guard = new LoopbackGuard(options);
    this.sockets = new WebSocketServer({ noServer: true });
    this.server = createServer((request, response) => {
      this.handle(request, response);
    });
    this.server.on('upgrade', (request, socket, head) => {
      this.upgrade(request, socket, head);
    });
  }

  private static label(request: IncomingMessage): string {
    const origin = request.headers.origin ?? '(no origin)';
    return `${request.method ?? '?'} ${request.url ?? '?'} from ${origin}`;
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      // Explicitly 127.0.0.1, never localhost or :: — SEC-NET-1.
      this.server.listen(this.options.port, '127.0.0.1', () => {
        resolve();
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      this.sockets.close();
      this.server.close(() => {
        resolve();
      });
      this.server.closeAllConnections();
    });
  }

  public taken(): readonly Decision[] {
    return this.decisions;
  }

  /** The last decision whose label contains `needle` — how the CLI reads its own probes back. */
  public lastFor(needle: string): Decision | undefined {
    return [...this.decisions].reverse().find((decision) => decision.label.includes(needle));
  }

  private handle(request: IncomingMessage, response: ServerResponse): void {
    const facts = { method: request.method, url: request.url, headers: request.headers };
    const rejection = this.guard.screenRequest(facts);
    if (rejection !== undefined) {
      this.note('http', ProbeServer.label(request), rejection);
      this.reply(response, rejection.status);
      return;
    }
    this.drain(request, response);
  }

  /** Accepted requests still have to respect the body limit, which is checked as it arrives. */
  private drain(request: IncomingMessage, response: ServerResponse): void {
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= this.guard.bodyLimitBytes) return;
      const rejection = this.guard.oversize(this.guard.bodyLimitBytes);
      this.note('http', ProbeServer.label(request), rejection);
      request.destroy();
      this.reply(response, rejection.status);
    });
    request.on('end', () => {
      if (response.writableEnded) return;
      this.note('http', ProbeServer.label(request), 200);
      this.reply(response, 200);
    });
  }

  private upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const facts = { method: request.method, url: request.url, headers: request.headers };
    const rejection = this.guard.screenUpgrade(facts);
    if (rejection !== undefined) {
      this.note('upgrade', ProbeServer.label(request), rejection);
      socket.destroy();
      return;
    }
    this.note('upgrade', ProbeServer.label(request), 101);
    this.sockets.handleUpgrade(request, socket, head, (client) => {
      this.awaitToken(client, ProbeServer.label(request));
    });
  }

  /**
   * The credential has to be in the first frame, inside 2 s, or the socket closes (SEC-WS-1).
   *
   * The probe compares against the token, because the shape it measures is a browser one — what a
   * hostile page can send on a socket it opened, and what happens when it sends nothing. Core
   * itself takes a single-use ticket here rather than the token (DECISIONS.md D32, P5a-T2b); that
   * redemption belongs to TicketOffice and is proven by its own tests, not by a probe whose
   * subject is the browser.
   */
  private awaitToken(client: WebSocket, label: string): void {
    const timer = setTimeout(() => {
      this.note('frame', label, {
        status: 1008,
        control: 'SEC-WS-1',
        reason: 'no first frame within 2 s',
      });
      client.close(1008);
    }, FIRST_FRAME_TIMEOUT_MS);

    client.once('message', (data: Buffer) => {
      clearTimeout(timer);
      if (!this.guard.isAuthorised(data.toString('utf8').trim())) {
        const rejection: Rejection = {
          status: 1008,
          control: 'SEC-WS-1',
          reason: 'first frame is not the credential',
        };
        this.note('frame', label, rejection);
        client.close(rejection.status);
        return;
      }
      this.note('frame', label, 1000);
      client.send('ok');
    });
  }

  private reply(response: ServerResponse, status: number): void {
    if (response.writableEnded) return;
    response.writeHead(status, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
    // No CORS headers, ever — a cross-origin page never gets to read the answer (SEC-HTTP-5).
    response.end(status === 200 ? '{"ok":true}' : '{"error":"rejected"}');
  }

  /** `outcome` is the accepted status code, or the rejection that stopped it. */
  private note(kind: Decision['kind'], label: string, outcome: number | Rejection): void {
    const accepted = typeof outcome === 'number';
    this.decisions.push({
      kind,
      label,
      accepted,
      status: accepted ? outcome : outcome.status,
      control: accepted ? '-' : outcome.control,
      reason: accepted ? 'accepted' : outcome.reason,
    });
  }
}
