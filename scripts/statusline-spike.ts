// P0-T5 — the receiver flightdeck-core's `POST /statusline` will be, and a probe that runs a
// real statusline.py against a real payload and times it.
//
// The measurement that matters is not the POST, it is what the POST costs the *render*: the
// status line runs on every assistant message and every refreshInterval tick, so anything it
// adds is felt on every keystroke. The probe therefore times the whole python process and
// compares its stdout byte for byte with the unpatched script (SEC-ING-3).
import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { LoopbackGuard } from '../core/http/loopback-guard.ts';

/** 'hang' never answers, which is how the 150 ms timeout in the block gets exercised. */
export type ReceiverMode = 'ack' | 'hang';

export interface StatuslineReceiverOptions {
  readonly port: number;
  readonly token: string;
  readonly mode: ReceiverMode;
}

export interface ReceivedPost {
  readonly status: number;
  readonly ackMs: number;
  readonly bytes: number;
  readonly sessionId: string;
}

/**
 * Loopback-only statusline receiver. Applies the controls the real route will (SEC-NET-1,
 * SEC-HTTP-1, SEC-HTTP-4, SEC-ING-1/2) so the spike measures the real handshake — a receiver
 * that skipped the token check would understate the round trip by a TLS-free but real hash.
 */
export class StatuslineReceiver {
  private static readonly BODY_LIMIT_BYTES = 256 * 1024;

  private readonly options: StatuslineReceiverOptions;
  private readonly guard: LoopbackGuard;
  private readonly server: Server;
  private readonly posts: ReceivedPost[] = [];
  private readonly held: ServerResponse[] = [];

  constructor(options: StatuslineReceiverOptions) {
    this.options = options;
    // One screen, shared with the P0-T7 probe — see core/http/loopback-guard.ts. A statusline POST
    // carries no Origin and no Sec-Fetch-Site, so those checks are no-ops on this path; the
    // Host, Content-Type and token checks are the ones doing work here.
    this.guard = new LoopbackGuard({
      port: options.port,
      uiOrigin: `http://127.0.0.1:${String(options.port - 1)}`,
      token: options.token,
      bodyLimitBytes: StatuslineReceiver.BODY_LIMIT_BYTES,
    });
    this.server = createServer((request, response) => {
      void this.handle(request, response, performance.now());
    });
  }

  /** The payload is untrusted; the id is only ever echoed into a report line (SEC-ING-1). */
  private static sessionIdOf(body: string): string {
    try {
      const parsed: unknown = JSON.parse(body);
      if (typeof parsed !== 'object' || parsed === null) return '-';
      const id: unknown = (parsed as Record<string, unknown>)['session_id'];
      return typeof id === 'string' && /^[0-9a-f-]{8,36}$/i.test(id) ? id.slice(0, 8) : '-';
    } catch {
      return '-';
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
      for (const response of this.held) response.destroy();
      this.server.close(() => {
        resolve();
      });
      this.server.closeAllConnections();
    });
  }

  public received(): readonly ReceivedPost[] {
    return this.posts;
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
    startedAt: number,
  ): Promise<void> {
    const rejection = this.screen(request);
    if (rejection !== undefined) {
      this.note(rejection, this.reply(response, rejection, startedAt), 0, '-');
      return;
    }
    const body = await this.readBody(request);
    if (body === null) {
      this.note(413, this.reply(response, 413, startedAt), 0, '-');
      return;
    }
    if (this.options.mode === 'hang') {
      // Held open, never answered: the block's recv() must give up at 150 ms, not wait forever.
      this.held.push(response);
      this.note(0, performance.now() - startedAt, Buffer.byteLength(body), '-');
      return;
    }
    const ackMs = this.reply(response, 200, startedAt);
    this.note(200, ackMs, Buffer.byteLength(body), StatuslineReceiver.sessionIdOf(body));
  }

  /** Routing first, then the shared security screen. Fails closed either way. */
  private screen(request: IncomingMessage): number | undefined {
    if (request.method !== 'POST') return 405;
    if (request.url !== '/statusline') return 404;
    return this.guard.screenRequest({
      method: request.method,
      url: request.url,
      headers: request.headers,
    })?.status;
  }

  private readBody(request: IncomingMessage): Promise<string | null> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let size = 0;
      request.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > StatuslineReceiver.BODY_LIMIT_BYTES) {
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

  private note(status: number, ackMs: number, bytes: number, sessionId: string): void {
    this.posts.push({ status, ackMs, bytes, sessionId });
  }
}

export interface RenderResult {
  readonly stdout: Buffer;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly totalMs: number;
}

export interface RenderProbeOptions {
  readonly python: string;
  readonly cwd: string;
  /** Both the git-state cache root and, via TEMP/TMP, everything statusline.py writes. */
  readonly temp: string;
  /** Where the block looks for the token — pointed at the scratchpad so the real one is never read. */
  readonly localAppData: string;
}

/**
 * Runs one statusline script against one payload and returns exactly what the terminal would
 * have been given. `totalMs` is process spawn to exit — the number a user feels, not the POST.
 *
 * The environment is fixed (COLUMNS included) so two runs of the same script over the same
 * payload differ only if the script itself is non-deterministic: `until()` renders a countdown
 * at minute granularity, so the caller runs unpatched twice around the patched run and only
 * trusts a comparison whose two unpatched renders agree.
 */
export class RenderProbe {
  private static readonly INHERITED: readonly string[] = [
    'PATH',
    'USERPROFILE',
    'APPDATA',
    'SystemRoot',
  ];

  private readonly options: RenderProbeOptions;

  constructor(options: RenderProbeOptions) {
    this.options = options;
  }

  public run(script: string, payload: string): Promise<RenderResult> {
    return new Promise((resolve) => {
      const startedAt = performance.now();
      const child = spawn(this.options.python, [script], {
        cwd: this.options.cwd,
        env: this.environment(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const out: Buffer[] = [];
      const err: string[] = [];
      child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => err.push(chunk.toString('utf8')));
      child.on('close', (code) => {
        resolve({
          stdout: Buffer.concat(out),
          stderr: err.join(''),
          exitCode: code,
          totalMs: performance.now() - startedAt,
        });
      });
      child.stdin.end(payload);
    });
  }

  /** Minimal, fixed environment — SECURITY.md §3 rule 5, and determinism for the byte compare. */
  private environment(): Record<string, string> {
    const env: Record<string, string> = {
      TEMP: this.options.temp,
      TMP: this.options.temp,
      LOCALAPPDATA: this.options.localAppData,
      COLUMNS: '110',
      CC_STATUSLINE_ICONS: 'unicode',
      PYTHONIOENCODING: 'utf-8',
      // parallel_chip() re-runs a repo hook DETACHED when its state file is stale. Harmless, but
      // a spawned node process is noise in a latency measurement — and the chip renders either way.
      CC_STATUSLINE_NO_REFRESH: '1',
    };
    for (const name of RenderProbe.INHERITED) {
      const value = process.env[name];
      if (value !== undefined) env[name] = value;
    }
    return env;
  }
}
