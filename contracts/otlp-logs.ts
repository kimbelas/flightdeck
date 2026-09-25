// What `POST /v1/logs` keeps out of an OTLP/JSON `ExportLogsServiceRequest` — P7-T5.
//
// Claude Code exports its events as log records (code.claude.com/docs/en/monitoring-usage,
// "Available events"). **An event here is a name and a session, and nothing else is read**: a
// `user_prompt` record can carry the prompt, an `assistant_response` the reply and an
// `api_response_body` the whole API body when the owner has opted into them — redacted by default,
// and never Flightdeck's to hold either way (SEC-DATA-1). So the body is read only as a fallback
// for the name, the attributes only through otlp-values.ts's allowlist, and a record of any event
// not named below is skipped unread.

import { asRecord, labelsOf, recordsAt, sessionIdOf, type Labels } from './otlp-values.ts';

/** The events counted — Claude Code's documented set, less the two that are configuration. */
export const TELEMETRY_EVENTS = [
  'user_prompt',
  'assistant_response',
  'tool_result',
  'tool_decision',
  'api_request',
  'api_error',
] as const;

export type TelemetryEventName = (typeof TELEMETRY_EVENTS)[number];

/** One event, attributed to one session. */
export interface TelemetryEvent {
  readonly sessionId: string;
  readonly name: TelemetryEventName;
}

export interface LogsBatch {
  readonly events: readonly TelemetryEvent[];
  /** Records that named no counted event or no session. Counted, for `MetricsBatch`'s reason. */
  readonly skipped: number;
}

/** The body's `claude_code.` prefix, which the `event.name` attribute does not carry. */
const EVENT_PREFIX = 'claude_code.';

/**
 * One export request, or `undefined` if the body is not one.
 *
 * @throws never.
 */
export function parseOtlpLogs(value: unknown): LogsBatch | undefined {
  const envelope = asRecord(value);
  if (envelope === undefined || !Array.isArray(envelope['resourceLogs'])) return undefined;
  const events: TelemetryEvent[] = [];
  let skipped = 0;
  for (const resource of recordsAt(envelope, 'resourceLogs')) {
    const inherited = labelsOf(asRecord(resource['resource'])?.['attributes']);
    const records = recordsAt(resource, 'scopeLogs').flatMap((scope) => [
      ...recordsAt(scope, 'logRecords'),
    ]);
    for (const record of records) {
      const event = eventOf(record, inherited);
      if (event === undefined) skipped += 1;
      else events.push(event);
    }
  }
  return { events, skipped };
}

function eventOf(
  record: Readonly<Record<string, unknown>>,
  inherited: Labels,
): TelemetryEvent | undefined {
  const labels = labelsOf(record['attributes'], inherited);
  const sessionId = sessionIdOf(labels);
  const name = TELEMETRY_EVENTS.find((known) => known === nameOf(record, labels));
  if (sessionId === undefined || name === undefined) return undefined;
  return { sessionId, name };
}

/** `event.name`, or the body's string with its `claude_code.` prefix taken off. */
function nameOf(record: Readonly<Record<string, unknown>>, labels: Labels): string | undefined {
  const named = labels['event.name'];
  if (named !== undefined) return named;
  const body = asRecord(record['body'])?.['stringValue'];
  if (typeof body !== 'string' || !body.startsWith(EVENT_PREFIX)) return undefined;
  return body.slice(EVENT_PREFIX.length);
}
