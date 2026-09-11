// P0-T8 — the harness: one token file, one producer, one Next server per mode, four measurements.
//
// Both modes are measured because they are different programs. `next dev` and `next start` build
// and serve a response through different pipelines, and a proxy that batches events is invisible
// until it is not — so a transport signed off in dev is a transport that has not been tested.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { coreTokenFile } from '../contracts/core-token.ts';
import { SseProbe, type StreamMeasurement } from './sse-probe.ts';
import { SseProducer, type SeenRequest } from './sse-producer.ts';

export type ServerMode = 'dev' | 'start';

export interface Candidate {
  readonly id: string;
  readonly path: string;
  readonly what: string;
}

export interface Measured extends Candidate {
  readonly mode: ServerMode;
  readonly measurement: StreamMeasurement;
  /** The request core saw for THIS candidate — the transports rewrite headers differently. */
  readonly seenByCore: SeenRequest | undefined;
}

export const UI_ORIGIN = 'http://127.0.0.1:4949';
export const CORE_PORT = 4950;
export const CADENCE_MS = 200;
export const EVENTS = 12;

/**
 * The two transports SPEC.md R16 names, plus the control that isolates why one of them fails.
 *
 * `rewrite-compressible` is not a third candidate; it is `rewrite` with the producer's
 * `no-transform` dropped, which is what turns the mitigation from a guess into a measurement.
 */
export const CANDIDATES: readonly Candidate[] = [
  { id: 'rewrite', path: '/api/core/stream', what: 'next.config rewrite, token from proxy.ts' },
  {
    id: 'rewrite-compressible',
    path: '/api/core/stream?transformable=1',
    what: 'same, with core omitting no-transform',
  },
  { id: 'route', path: '/api/stream', what: 'force-dynamic route handler, token read in-process' },
];

/** Writes the token where core would (SEC-HTTP-3), and removes it on the way out (F.3.3). */
export class TokenFile {
  private readonly path: string;
  private readonly value: string;

  constructor() {
    this.path = coreTokenFile();
    this.value = randomBytes(32).toString('hex');
  }

  public get token(): string {
    return this.value;
  }

  public get location(): string {
    return this.path;
  }

  public write(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, this.value, { encoding: 'utf8', mode: 0o600 });
  }

  /**
   * Removed rather than merely abandoned: a stale token file is the liveness check for
   * statusline.py, and leaving one behind costs every render 51 ms against a core that is not
   * there (RESEARCH.md F.3.3).
   */
  public remove(): void {
    rmSync(this.path, { force: true });
  }
}

/** Runs `next dev` or `next start` on 4949 and waits for it to actually answer. */
export class NextServer {
  private static readonly BIN = fileURLToPath(
    new URL('../node_modules/next/dist/bin/next', import.meta.url),
  );

  private readonly mode: ServerMode;
  private child: ChildProcess | undefined;

  constructor(mode: ServerMode) {
    this.mode = mode;
  }

  private static async waitFor(url: string, budgetMs: number): Promise<void> {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
        if (response.ok) return;
      } catch {
        // Not up yet; the deadline is the only thing that ends this loop.
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`${url} did not answer within ${String(budgetMs)} ms`);
  }

  public async start(): Promise<void> {
    // `npm.cmd` cannot be spawned directly on Node 26 (EINVAL — .cmd needs a shell, and
    // SEC-PROC-1 bans `shell: true`), so the Next binary is run by this interpreter instead.
    this.child = spawn(process.execPath, [NextServer.BIN, this.mode, '-p', '4949'], {
      stdio: 'ignore',
    });
    await NextServer.waitFor(UI_ORIGIN, 120_000);
    // `next dev` compiles a route on first request. Warming it here keeps a one-off 2 s compile
    // out of the first-byte number, which would otherwise read as buffering.
    for (const candidate of CANDIDATES) {
      await fetch(`${UI_ORIGIN}${candidate.path}`, { signal: AbortSignal.timeout(60_000) }).then(
        (response) => response.body?.cancel(),
        () => undefined,
      );
    }
  }

  public stop(): void {
    this.child?.kill();
  }
}

/** Producer up, both servers in turn, every candidate measured in each. */
export class SseSpike {
  private readonly producer: SseProducer;
  private readonly probe = new SseProbe(CADENCE_MS);
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
    this.producer = new SseProducer({
      port: CORE_PORT,
      uiOrigin: UI_ORIGIN,
      token,
      cadenceMs: CADENCE_MS,
      events: EVENTS,
    });
  }

  public get seenByCore(): readonly SeenRequest[] {
    return this.producer.seen;
  }

  public get seenCount(): number {
    return this.producer.seen.length;
  }

  public get activeStreams(): number {
    return this.producer.activeStreams;
  }

  public start(): Promise<void> {
    return this.producer.start();
  }

  public stop(): Promise<void> {
    return this.producer.stop();
  }

  public baseline(): Promise<StreamMeasurement> {
    return this.probe.measure(`http://127.0.0.1:${String(CORE_PORT)}/stream`, {
      authorization: `Bearer ${this.token}`,
      'accept-encoding': 'gzip, deflate, br',
    });
  }

  /** Every candidate against an already-running server; the caller owns the server's lifetime. */
  public async measureAll(mode: ServerMode): Promise<readonly Measured[]> {
    const measured: Measured[] = [];
    for (const candidate of CANDIDATES) {
      const before = this.producer.seen.length;
      const measurement = await this.probe.measure(`${UI_ORIGIN}${candidate.path}`, {
        // Exactly what a browser's EventSource sends and a page cannot change.
        'accept-encoding': 'gzip, deflate, br',
      });
      measured.push({ ...candidate, mode, measurement, seenByCore: this.streamSince(before) });
    }
    return measured;
  }

  /**
   * The stream request core saw after `index`.
   *
   * Attribution by position rather than by taking the most recent one: the candidates run back to
   * back, and the route handler sets headers of its own on the upstream leg, so "the last request
   * core saw" describes whichever candidate ran last rather than the one being reported.
   */
  public streamSince(index: number): SeenRequest | undefined {
    return this.producer.seen.slice(index).find((entry) => entry.path === '/stream');
  }

  /**
   * Opens a stream, abandons it after the first event, and reports how many core still holds.
   *
   * A transport that relays bytes but not the disconnect passes every latency test and still
   * leaks a producer per reconnect, which is invisible until a day's worth of them are running.
   */
  public async abandon(path: string): Promise<number> {
    const controller = new AbortController();
    const response = await fetch(`${UI_ORIGIN}${path}`, {
      headers: { accept: 'text/event-stream' },
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    await reader?.read();
    controller.abort();
    // The close travels client → Next → core, and core's 'close' handler is a later tick still.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    return this.producer.activeStreams;
  }

  /** What each transport does when core is not there — the ordinary state, not an exception. */
  public async withCoreDown(path: string): Promise<number> {
    const response = await fetch(`${UI_ORIGIN}${path}`, {
      headers: { accept: 'text/event-stream' },
      signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel();
    return response.status;
  }
}
