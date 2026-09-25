// What `POST /v1/metrics` keeps out of an OTLP/JSON `ExportMetricsServiceRequest` — P7-T5.
//
// **A projection, not a mirror** (statusline-report.ts's rule). Six of Claude Code's eight metrics
// are read, by name, and from each data point only its number and the allowlisted labels in
// otlp-values.ts. The names, units and `type` values are Claude Code's documented set
// (code.claude.com/docs/en/monitoring-usage, "Available metrics"; RESEARCH.md D.7):
//
// | metric | unit | split by |
// |---|---|---|
// | `claude_code.cost.usage` | USD | `model` |
// | `claude_code.token.usage` | tokens | `type`: input, output, cacheRead, cacheCreation |
// | `claude_code.active_time.total` | s | `type`: user, cli |
// | `claude_code.lines_of_code.count` | count | `type`: added, removed |
// | `claude_code.commit.count` / `pull_request.count` | count | — |
//
// **Delta temporality only**, which is Claude Code's default
// (`OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta`). A delta is a number to add; a
// cumulative point is a running total per attribute SET, and telling two sets apart would mean
// keeping every attribute — `user.email` included — as a key. So a cumulative point is counted as
// skipped rather than summed, and summing it would double every figure on the next export.

import {
  asRecord,
  labelsOf,
  pointValue,
  recordsAt,
  sessionIdOf,
  type Labels,
} from './otlp-values.ts';

export const TELEMETRY_METRICS = [
  'cost',
  'tokens',
  'activeTime',
  'lines',
  'commits',
  'pullRequests',
] as const;

export type TelemetryMetric = (typeof TELEMETRY_METRICS)[number];

/** Claude Code's metric names, mapped to what Flightdeck calls them. Anything else is not read. */
const METRIC_NAMES: Readonly<Record<string, TelemetryMetric>> = {
  'claude_code.cost.usage': 'cost',
  'claude_code.token.usage': 'tokens',
  'claude_code.active_time.total': 'activeTime',
  'claude_code.lines_of_code.count': 'lines',
  'claude_code.commit.count': 'commits',
  'claude_code.pull_request.count': 'pullRequests',
};

/** Protobuf's JSON mapping allows an enum as its number or its name. 1 is DELTA. */
const DELTA: readonly unknown[] = [1, 'AGGREGATION_TEMPORALITY_DELTA'];

/** One delta, attributed to one session. */
export interface TelemetryPoint {
  readonly sessionId: string;
  readonly metric: TelemetryMetric;
  /** The `type` label — `input`, `cli`, `added`… — or `undefined` for a metric with none. */
  readonly kind: string | undefined;
  readonly model: string | undefined;
  readonly value: number;
}

export interface MetricsBatch {
  readonly points: readonly TelemetryPoint[];
  /**
   * Points of a known metric that could not be used: cumulative, no session, or no number.
   *
   * Counted rather than logged one by one, because a misconfigured exporter sends the same
   * mistake every minute from every session.
   */
  readonly skipped: number;
}

/**
 * One export request, or `undefined` if the body is not one.
 *
 * Only the envelope is required — an object with a `resourceMetrics` list. A point that is wrong
 * is skipped rather than refusing the batch, because the batch also holds every other session's
 * points for the same minute.
 *
 * @throws never.
 */
export function parseOtlpMetrics(value: unknown): MetricsBatch | undefined {
  const envelope = asRecord(value);
  if (envelope === undefined || !Array.isArray(envelope['resourceMetrics'])) return undefined;
  const points: TelemetryPoint[] = [];
  let skipped = 0;
  for (const resource of recordsAt(envelope, 'resourceMetrics')) {
    const labelled = labelsOf(asRecord(resource['resource'])?.['attributes']);
    for (const metric of recordsAt(resource, 'scopeMetrics').flatMap(metricsOf)) {
      const read = readMetric(metric, labelled);
      points.push(...read.points);
      skipped += read.skipped;
    }
  }
  return { points, skipped };
}

function metricsOf(scope: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>>[] {
  return [...recordsAt(scope, 'metrics')];
}

/** One metric's data points. Unknown names contribute nothing and are not counted as skipped. */
function readMetric(metric: Readonly<Record<string, unknown>>, resource: Labels): MetricsBatch {
  const name = metric['name'];
  const known = typeof name === 'string' ? METRIC_NAMES[name] : undefined;
  if (known === undefined) return { points: [], skipped: 0 };
  const sum = asRecord(metric['sum']);
  const dataPoints = recordsAt(sum, 'dataPoints');
  if (sum === undefined || !DELTA.includes(sum['aggregationTemporality'])) {
    return { points: [], skipped: dataPoints.length };
  }
  const points = dataPoints.flatMap((point) => {
    const read = pointOf(known, point, resource);
    return read === undefined ? [] : [read];
  });
  return { points, skipped: dataPoints.length - points.length };
}

function pointOf(
  metric: TelemetryMetric,
  point: Readonly<Record<string, unknown>>,
  resource: Labels,
): TelemetryPoint | undefined {
  const labels = labelsOf(point['attributes'], resource);
  const sessionId = sessionIdOf(labels);
  const value = pointValue(point);
  if (sessionId === undefined || value === undefined) return undefined;
  return { sessionId, metric, kind: labels.type, model: labels.model, value };
}
