// The verdict in RESEARCH.md F.6 is arithmetic, so the arithmetic is the thing under test.
//
// The measurements themselves need two servers and a browser and live in
// scripts/sse-spike-cli.ts; what belongs in `npm run check` is the rule that turns arrival
// timestamps into "streamed" or "BATCHED", because that rule is what a future reader will trust
// without rerunning the spike.
import { describe, expect, it } from 'vitest';
import {
  SseParser,
  largestBurst,
  median,
  percentile95,
  type EventArrival,
} from '../../scripts/sse-probe.ts';

const CADENCE_MS = 200;
const WINDOW_MS = CADENCE_MS / 4;

function arrivals(times: readonly number[]): readonly EventArrival[] {
  return times.map((atMs, sequence) => ({ sequence, atMs }));
}

describe('median', () => {
  it('is 0 for nothing, which reads as "no gaps to report"', () => {
    expect(median([])).toBe(0);
  });

  it('takes the middle of an odd list and the mean of the middle two of an even one', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('does not mutate its input', () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe('percentile95', () => {
  it('is nearest-rank, so one outlier in twenty is p100 and not p95', () => {
    const values = Array.from({ length: 20 }, (unused, index) => (index === 19 ? 900 : 200));
    expect(percentile95(values)).toBe(200);
  });

  it('reports the outlier once enough samples are that bad', () => {
    const values = Array.from({ length: 20 }, (unused, index) => (index >= 18 ? 900 : 200));
    expect(percentile95(values)).toBe(900);
  });

  it('falls back to the single value it has', () => {
    expect(percentile95([42])).toBe(42);
  });
});

describe('largestBurst', () => {
  it('is 1 for a stream arriving on cadence', () => {
    expect(largestBurst(arrivals([0, 200, 400, 600]), WINDOW_MS)).toBe(1);
  });

  it('counts the whole batch when a proxy flushes at the end', () => {
    expect(largestBurst(arrivals([2450, 2450.1, 2450.2, 2450.3]), WINDOW_MS)).toBe(4);
  });

  it('tolerates loopback jitter inside a window without calling it a batch', () => {
    // 12 ms of jitter on a 200 ms cadence is still one event per window.
    expect(largestBurst(arrivals([0, 206, 394, 612]), WINDOW_MS)).toBe(1);
  });

  it('is 0 when nothing arrived, so an empty stream never reads as streamed', () => {
    expect(largestBurst([], WINDOW_MS)).toBe(0);
  });
});

describe('SseParser', () => {
  it('counts one event per blank-line terminator', () => {
    const parser = new SseParser();
    expect(parser.push('event: a\ndata: 1\n\nevent: b\ndata: 2\n\n')).toBe(2);
  });

  it('holds a partial event until its terminator arrives — the split-chunk case', () => {
    const parser = new SseParser();
    expect(parser.push('event: a\nda')).toBe(0);
    expect(parser.push('ta: 1\n\n')).toBe(1);
  });

  it('ignores a comment-only frame, which SSE uses as a keep-alive', () => {
    const parser = new SseParser();
    expect(parser.push(': keep-alive\n\n')).toBe(0);
  });
});
