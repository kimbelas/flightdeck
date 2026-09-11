// P0-T8 runner — SSE through the Next rewrite, measured rather than asserted.
//
//   npm run build && node scripts/sse-spike-cli.ts
//
// Starts a core-shaped SSE producer on 4950, then `next dev` and `next start` in turn on 4949,
// and measures every candidate transport in both. The build is required because `next start`
// needs one; dev is measured against the same tree.
import { BrowserSseCheck } from './sse-spike-browser.ts';
import {
  CADENCE_MS,
  EVENTS,
  NextServer,
  SseSpike,
  TokenFile,
  UI_ORIGIN,
  type Measured,
  type ServerMode,
} from './sse-spike.ts';
import type { SeenRequest } from './sse-producer.ts';
import type { StreamMeasurement } from './sse-probe.ts';
import { median, percentile95 } from './sse-probe.ts';

const MODES: readonly ServerMode[] = ['dev', 'start'];

function row(label: string, value: string): void {
  console.log(`  ${label.padEnd(34)}${value}`);
}

function verdict(measurement: StreamMeasurement): string {
  if (measurement.status !== 200) return `HTTP ${String(measurement.status)}`;
  return measurement.streamed
    ? 'streamed'
    : `BATCHED (${String(measurement.largestBurst)} at once)`;
}

function reportMeasurement(label: string, measurement: StreamMeasurement): void {
  console.log(`\n${label}\n`);
  row('verdict', verdict(measurement));
  row('response headers', `${String(measurement.headersMs)} ms`);
  row('first event', `${String(measurement.firstEventMs ?? -1)} ms`);
  row('events received', `${String(measurement.arrivals.length)} of ${String(EVENTS)}`);
  row('inter-event median', `${String(median(measurement.gapsMs))} ms`);
  row('inter-event p95', `${String(percentile95(measurement.gapsMs))} ms`);
  row(
    'inter-event min / max',
    `${String(Math.min(...measurement.gapsMs, 0))} / ${String(Math.max(...measurement.gapsMs, 0))} ms`,
  );
  row('content-encoding', measurement.contentEncoding ?? 'none');
  row('largest burst in one window', String(measurement.largestBurst));
}

function reportTable(results: readonly Measured[]): void {
  console.log('\nsummary — cadence is', `${String(CADENCE_MS)} ms\n`);
  console.log(
    '  ' +
      'mode'.padEnd(7) +
      'candidate'.padEnd(24) +
      'verdict'.padEnd(22) +
      'first'.padEnd(10) +
      'median gap'.padEnd(12) +
      'encoding',
  );
  for (const result of results) {
    const { measurement } = result;
    const first = `${String(measurement.firstEventMs ?? -1)} ms`;
    const gap = `${String(median(measurement.gapsMs))} ms`;
    console.log(
      '  ' +
        result.mode.padEnd(7) +
        result.id.padEnd(24) +
        verdict(measurement).padEnd(22) +
        first.padEnd(10) +
        gap.padEnd(12) +
        (measurement.contentEncoding ?? 'none'),
    );
  }
}

async function reportBrowser(path: string): Promise<void> {
  console.log(`\nChromium EventSource on ${path} (next start, under the real CSP)\n`);
  const stream = await new BrowserSseCheck(UI_ORIGIN).run(path, EVENTS);
  row('opened', String(stream.opened));
  row('events', String(stream.events));
  row('first event', `${String(stream.firstEventMs)} ms`);
  row('inter-event median', `${String(median(stream.gapsMs))} ms`);
  row('error', stream.error ?? 'none');
}

const REPORTED_HEADERS = ['host', 'origin', 'sec-fetch-site', 'accept', 'accept-encoding'];

/** What core actually received, which is the only way to know what a transport forwards. */
function reportSeen(request: SeenRequest | undefined): void {
  if (request === undefined) {
    row('core saw', 'no stream request');
    return;
  }
  for (const name of REPORTED_HEADERS) {
    const value = request.headers[name];
    row(`core saw ${name}`, Array.isArray(value) ? value.join(', ') : (value ?? '(absent)'));
  }
  row(
    'core saw authorization',
    request.headers['authorization'] === undefined ? '(absent)' : 'Bearer <token>',
  );
  row(
    'core saw content-security-policy',
    request.headers['content-security-policy'] === undefined ? '(absent)' : 'present',
  );
}

const TRANSPORTS: readonly string[] = ['/api/core/stream', '/api/stream'];

/** Does closing the stream reach core, or does each reconnect leave a producer behind? */
async function reportDisconnect(spike: SseSpike): Promise<void> {
  console.log('\nclient disconnect — streams core still holds one second later\n');
  for (const path of TRANSPORTS) {
    row(path, `${String(await spike.abandon(path))} still open`);
  }
}

/** Core down is an ordinary state, not an exception (RESEARCH.md F.3.3). */
async function reportCoreDown(spike: SseSpike): Promise<void> {
  console.log('\ncore stopped — what the browser is told\n');
  for (const path of TRANSPORTS) {
    try {
      row(path, `HTTP ${String(await spike.withCoreDown(path))}`);
    } catch (error) {
      row(path, `no response — ${String(error).slice(0, 60)}`);
    }
  }
}

/** One Next server, every candidate measured against it, then the checks only `start` can host. */
async function runMode(spike: SseSpike, mode: ServerMode): Promise<readonly Measured[]> {
  const server = new NextServer(mode);
  await server.start();
  try {
    const measured = await spike.measureAll(mode);
    for (const result of measured) {
      reportMeasurement(`${mode} — ${result.id} (${result.what})`, result.measurement);
      reportSeen(result.seenByCore);
    }
    if (mode === 'start') await reportProduction(spike);
    return measured;
  } finally {
    server.stop();
  }
}

/**
 * The checks that need a production server and a real browser, in the order they can run.
 *
 * The core-down check is last because it stops the producer, and nothing after it could measure a
 * stream again.
 */
async function reportProduction(spike: SseSpike): Promise<void> {
  const before = spike.seenCount;
  await reportBrowser('/api/core/stream');
  reportSeen(spike.streamSince(before));
  await reportDisconnect(spike);
  await spike.stop();
  await reportCoreDown(spike);
}

async function main(): Promise<number> {
  const tokenFile = new TokenFile();
  tokenFile.write();
  const spike = new SseSpike(tokenFile.token);
  await spike.start();
  console.log(
    `core-shaped producer on 4950 — ${String(EVENTS)} events every ${String(CADENCE_MS)} ms`,
  );
  console.log(`token at ${tokenFile.location}`);

  const results: Measured[] = [];
  try {
    reportMeasurement(
      'baseline — straight to core on 4950, no Next in the path',
      await spike.baseline(),
    );
    for (const mode of MODES) {
      results.push(...(await runMode(spike, mode)));
    }
    reportTable(results);
  } finally {
    // Stopping twice is deliberate and harmless: the core-down check stops it early, and this is
    // the path that runs when the measurements threw before ever getting there.
    await spike.stop();
    tokenFile.remove();
  }
  return results.some(
    (result) => result.id !== 'rewrite-compressible' && !result.measurement.streamed,
  )
    ? 1
    : 0;
}

process.exitCode = await main();
