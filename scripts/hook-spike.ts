// P0-T3 — a stand-in for flightdeck-core's `POST /hooks` while the payload shapes are unknown.
//
// It applies the controls the real receiver will need (SEC-NET-1, SEC-HTTP-1, SEC-HTTP-4,
// SEC-ING-1, SEC-ING-2) so the spike measures the real thing rather than a simplification.
// Raw captures land under fixtures/raw/, which is git-ignored; scripts/capture-fixtures.mjs
// scrubs them into fixtures/hooks/ before anything is committed.
import { timingSafeEqual } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';

/** Headers whose values never reach a log or a capture file (SEC-DATA-2). */
const REDACTED_HEADERS: readonly string[] = ['authorization', 'cookie', 'proxy-authorization'];

export interface ReceiverOptions {
  readonly port: number;
  readonly token: string;
  readonly outputDir: string;
}

export interface CapturedHook {
  readonly event: string;
  readonly ackMs: number;
  readonly bytes: number;
  readonly file: string;
}

/** Writes one file per received payload, with the request headers redacted. */
export class PayloadRecorder {
  private readonly outputDir: string;
  private sequence = 0;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
    mkdirSync(outputDir, { recursive: true });
  }

  public static redact(headers: NodeJS.Dict<string | string[]>): Record<string, string> {
    const safe: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
      if (value === undefined) continue;
      const text = Array.isArray(value) ? value.join(', ') : value;
      safe[name] = REDACTED_HEADERS.includes(name.toLowerCase()) ? '<redacted>' : text;
    }
    return safe;
  }

  private static tryParse(body: string): unknown {
    try {
      return JSON.parse(body);
    } catch {
      return { unparseable_body: body };
    }
  }

  /** Returns the path written. Never throws on an unparseable body — it records the text. */
  public record(event: string, body: string, headers: NodeJS.Dict<string | string[]>): string {
    this.sequence += 1;
    const file = join(this.outputDir, `${String(this.sequence).padStart(2, '0')}-${event}.json`);
    const capture = {
      captured_at: new Date().toISOString(),
      headers: PayloadRecorder.redact(headers),
      payload: PayloadRecorder.tryParse(body),
    };
    writeFileSync(file, `${JSON.stringify(capture, null, 2)}\n`, 'utf8');
    return file;
  }
}

/**
 * Loopback-only hook receiver. Acks before doing any work so a slow receiver can never slow a
 * session (SEC-ING-2); the disk write happens after the response is flushed.
 */
export class HookReceiver {
  private static readonly BODY_LIMIT_BYTES = 4 * 1024 * 1024;
  private static readonly ALLOWED_HOST_NAMES: readonly string[] = ['127.0.0.1', 'localhost'];

  private readonly options: ReceiverOptions;
  private readonly recorder: PayloadRecorder;
  private readonly server: Server;
  private readonly capturedHooks: CapturedHook[] = [];
  private readonly onCapture: (hook: CapturedHook) => void;

  constructor(
    options: ReceiverOptions,
    recorder: PayloadRecorder,
    onCapture: (hook: CapturedHook) => void,
  ) {
    this.options = options;
    this.recorder = recorder;
    this.onCapture = onCapture;
    this.server = createServer((request, response) => {
      void this.handle(request, response, performance.now());
    });
  }

  /** The payload is untrusted, so the event name is only ever used to build a file name. */
  private static eventNameOf(body: string): string {
    try {
      const parsed: unknown = JSON.parse(body);
      if (typeof parsed !== 'object' || parsed === null) return 'unknown';
      const name: unknown = (parsed as Record<string, unknown>)['hook_event_name'];
      if (typeof name !== 'string') return 'unknown';
      return /^[A-Za-z]{1,40}$/.test(name) ? name : 'unknown';
    } catch {
      return 'unparseable';
    }
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
      this.server.close(() => {
        resolve();
      });
      this.server.closeAllConnections();
    });
  }

  public captured(): readonly CapturedHook[] {
    return this.capturedHooks;
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
    startedAt: number,
  ): Promise<void> {
    const rejection = this.screen(request);
    if (rejection !== undefined) {
      // Rejections are recorded too: "no POST arrived" and "a POST was refused" are different
      // findings, and only logging successes makes them indistinguishable.
      this.note(`rejected-${String(rejection)}`, this.reply(response, rejection, startedAt), 0);
      return;
    }
    const body = await this.readBody(request);
    if (body === null) {
      this.note('rejected-413', this.reply(response, 413, startedAt), 0);
      return;
    }

    // Ack first, record after — the session is waiting on this response (SEC-ING-2).
    const ackMs = this.reply(response, 200, startedAt);
    setImmediate(() => {
      this.persist(request, body, ackMs);
    });
  }

  /** Returns the status to reject with, or undefined to accept. Fails closed (§3.3). */
  private screen(request: IncomingMessage): number | undefined {
    const host = (request.headers.host ?? '').split(':')[0] ?? '';
    if (!HookReceiver.ALLOWED_HOST_NAMES.includes(host)) return 421; // SEC-HTTP-1
    if (request.method !== 'POST') return 405;
    const contentType = request.headers['content-type'] ?? '';
    if (!contentType.startsWith('application/json')) return 415; // SEC-HTTP-4
    if (!this.isAuthorised(request.headers.authorization)) return 401; // SEC-ING-2
    return undefined;
  }

  private isAuthorised(header: string | undefined): boolean {
    const presented = Buffer.from((header ?? '').replace(/^Bearer\s+/i, ''), 'utf8');
    const expected = Buffer.from(this.options.token, 'utf8');
    // timingSafeEqual throws on a length mismatch, which would itself leak the length.
    if (presented.length !== expected.length) return false;
    return timingSafeEqual(presented, expected);
  }

  private readBody(request: IncomingMessage): Promise<string | null> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let size = 0;
      request.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > HookReceiver.BODY_LIMIT_BYTES) {
          request.destroy();
          resolve(null);
          return;
        }
        chunks.push(chunk);
      });
      request.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
      request.on('error', () => {
        resolve(null);
      });
    });
  }

  /** Returns the ack latency in milliseconds. */
  private reply(response: ServerResponse, status: number, startedAt: number): number {
    response.writeHead(status, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    response.end(status === 200 ? '{}' : '{"error":"rejected"}');
    return performance.now() - startedAt;
  }

  private persist(request: IncomingMessage, body: string, ackMs: number): void {
    const event = HookReceiver.eventNameOf(body);
    const file = this.recorder.record(event, body, request.headers);
    this.note(event, ackMs, Buffer.byteLength(body), file);
  }

  private note(event: string, ackMs: number, bytes: number, file = '-'): void {
    const hook: CapturedHook = { event, ackMs, bytes, file };
    this.capturedHooks.push(hook);
    this.onCapture(hook);
  }
}
