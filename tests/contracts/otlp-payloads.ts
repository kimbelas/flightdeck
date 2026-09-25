// OTLP/JSON request bodies shaped like Claude Code's exports — P7-T5.
//
// **Written from the documented shapes, not captured.** The envelope is the OTLP/HTTP JSON
// encoding (opentelemetry-proto, `ExportMetricsServiceRequest` / `ExportLogsServiceRequest`); the
// metric names, units, `type` values and standard attributes are Claude Code's
// (code.claude.com/docs/en/monitoring-usage). Every body carries the identity attributes a real
// one does — `user.email`, `user.account_uuid`, `organization.id` — so a test can prove they are
// never read, and a `prompt` attribute so a test can prove the same of content.

export const SESSION = 'aaaaaaaa-1111-2222-3333-444444444444';
export const OTHER = 'bbbbbbbb-1111-2222-3333-444444444444';
export const EMAIL = 'owner@example.test';
export const PROMPT = 'deploy the worker to cloudflare please';

export interface KeyValue {
  readonly key: string;
  readonly value: Readonly<Record<string, unknown>>;
}

export function attr(key: string, value: string | number): KeyValue {
  return typeof value === 'string'
    ? { key, value: { stringValue: value } }
    : { key, value: { intValue: String(value) } };
}

/** The standard attributes, on both the resource and each point, as Claude Code sends them. */
export function standard(sessionId: string): readonly KeyValue[] {
  return [
    attr('session.id', sessionId),
    attr('user.email', EMAIL),
    attr('user.account_uuid', 'cccccccc-0000-0000-0000-000000000000'),
    attr('organization.id', 'dddddddd-0000-0000-0000-000000000000'),
    attr('terminal.type', 'vscode'),
  ];
}

export interface PointSpec {
  readonly value: number | string;
  readonly attributes?: readonly KeyValue[];
  readonly double?: boolean;
}

export function sumMetric(
  name: string,
  points: readonly PointSpec[],
  temporality: unknown = 1,
): Readonly<Record<string, unknown>> {
  return {
    name,
    unit: name.endsWith('cost.usage') ? 'USD' : '1',
    sum: {
      aggregationTemporality: temporality,
      isMonotonic: true,
      dataPoints: points.map((point) => ({
        attributes: point.attributes ?? [],
        startTimeUnixNano: '1790000000000000000',
        timeUnixNano: '1790000060000000000',
        ...(point.double === false ? { asInt: point.value } : { asDouble: point.value }),
      })),
    },
  };
}

export function metricsBody(
  metrics: readonly Readonly<Record<string, unknown>>[],
  resource: readonly KeyValue[] = standard(SESSION),
): Readonly<Record<string, unknown>> {
  return {
    resourceMetrics: [
      {
        resource: { attributes: [attr('service.name', 'claude-code'), ...resource] },
        scopeMetrics: [{ scope: { name: 'com.anthropic.claude_code', version: '2.1.0' }, metrics }],
      },
    ],
  };
}

export function logRecord(
  name: string,
  sessionId: string,
  extra: readonly KeyValue[] = [],
): Readonly<Record<string, unknown>> {
  return {
    timeUnixNano: '1790000000000000000',
    body: { stringValue: `claude_code.${name}` },
    attributes: [attr('event.name', name), ...standard(sessionId), ...extra],
  };
}

export function logsBody(
  records: readonly Readonly<Record<string, unknown>>[],
): Readonly<Record<string, unknown>> {
  return {
    resourceLogs: [
      {
        resource: { attributes: [attr('service.name', 'claude-code'), ...standard(SESSION)] },
        scopeLogs: [{ scope: { name: 'com.anthropic.claude_code.events' }, logRecords: records }],
      },
    ],
  };
}
