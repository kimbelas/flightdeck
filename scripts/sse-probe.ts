// P0-T8 — the measurement, separated from the thing being measured so it can be unit-tested.
//
// A proxy that batches SSE is invisible to a client that only checks the events arrived: they all
// do, eventually, and the totals match. What separates streaming from buffering is WHEN each one
// landed, so this records an arrival timestamp per event and reports the gaps between them.
//
// The verdict is deliberately arithmetic rather than a judgement call: at a known cadence an
// unbuffered stream puts exactly one event in each window, and a buffered one puts all of them in
// the last window. `largestBurst` is that count, and it is the number the decision turns on.

export interface EventArrival {
  readonly sequence: number;
  /** Milliseconds from the request being issued to this event being parsed out of the stream. */
  readonly atMs: number;
}

export interface StreamMeasurement {
  readonly status: number;
  readonly contentType: string | undefined;
  readonly contentEncoding: string | undefined;
  /** Response headers back — not the first event, which is what SSE clients actually wait for. */
  readonly headersMs: number;
  readonly firstEventMs: number | undefined;
  readonly arrivals: readonly EventArrival[];
  readonly gapsMs: readonly number[];
  /** Most events that arrived inside one cadence window; 1 is a live stream, N is a batch. */
  readonly largestBurst: number;
  readonly streamed: boolean;
}

const PERCENTILE = 0.95;

function sortedCopy(values: readonly number[]): number[] {
  return [...values].sort((left, right) => left - right);
}

/** Median of an already-unsorted list; 0 for an empty one, which reads as "nothing to report". */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = sortedCopy(values);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export function percentile95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = sortedCopy(values);
  const index = Math.min(sorted.length - 1, Math.ceil(PERCENTILE * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

/**
 * The most events sharing one window of `windowMs`.
 *
 * A quarter of the producer's cadence is the window: wide enough that loopback jitter never puts
 * two genuinely separate events in one, narrow enough that a batch of ten lands in a single one.
 */
export function largestBurst(arrivals: readonly EventArrival[], windowMs: number): number {
  let largest = 0;
  for (const anchor of arrivals) {
    const inWindow = arrivals.filter(
      (other) => other.atMs >= anchor.atMs && other.atMs < anchor.atMs + windowMs,
    ).length;
    largest = Math.max(largest, inWindow);
  }
  return largest;
}

/** Splits a byte stream into SSE events on the blank-line terminator, keeping the remainder. */
export class SseParser {
  private buffer = '';

  public push(chunk: string): number {
    this.buffer += chunk;
    let complete = 0;
    let boundary = this.buffer.indexOf('\n\n');
    while (boundary !== -1) {
      if (this.buffer.slice(0, boundary).includes('data:')) complete += 1;
      this.buffer = this.buffer.slice(boundary + 2);
      boundary = this.buffer.indexOf('\n\n');
    }
    return complete;
  }
}

/** Opens one stream, records when each event landed, and says whether it was live or batched. */
export class SseProbe {
  private readonly cadenceMs: number;

  constructor(cadenceMs: number) {
    this.cadenceMs = cadenceMs;
  }

  public async measure(
    url: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<StreamMeasurement> {
    const startedAt = performance.now();
    const response = await fetch(url, { headers: { accept: 'text/event-stream', ...headers } });
    const headersMs = performance.now() - startedAt;
    const arrivals = response.body === null ? [] : await this.drain(response.body, startedAt);
    return this.report(response, headersMs, arrivals);
  }

  private async drain(
    body: ReadableStream<Uint8Array>,
    startedAt: number,
  ): Promise<readonly EventArrival[]> {
    const parser = new SseParser();
    const decoder = new TextDecoder();
    const arrivals: EventArrival[] = [];
    for await (const chunk of body) {
      const at = performance.now() - startedAt;
      const complete = parser.push(decoder.decode(chunk, { stream: true }));
      for (let index = 0; index < complete; index += 1) {
        arrivals.push({ sequence: arrivals.length, atMs: Number(at.toFixed(1)) });
      }
    }
    return arrivals;
  }

  private report(
    response: Response,
    headersMs: number,
    arrivals: readonly EventArrival[],
  ): StreamMeasurement {
    const gapsMs = arrivals
      .slice(1)
      .map((arrival, index) => Number((arrival.atMs - (arrivals[index]?.atMs ?? 0)).toFixed(1)));
    const burst = largestBurst(arrivals, this.cadenceMs / 4);
    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? undefined,
      contentEncoding: response.headers.get('content-encoding') ?? undefined,
      headersMs: Number(headersMs.toFixed(1)),
      firstEventMs: arrivals[0]?.atMs,
      arrivals,
      gapsMs,
      largestBurst: burst,
      streamed: arrivals.length > 1 && burst === 1,
    };
  }
}
