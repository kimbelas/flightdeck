// The pieces of OTLP/JSON both signal parsers read — P7-T5, RESEARCH.md D.7.
//
// OTLP's JSON encoding is protobuf's canonical JSON mapping, and two of its rules are traps for a
// hand-written reader. **An `int64` may arrive as a string** (`"asInt": "42"`), because JSON
// numbers cannot carry 64 bits and the mapping allows either form. **An attribute is a list of
// `{ key, value: { stringValue | intValue | doubleValue | boolValue } }`**, not an object, so
// `attributes['session.id']` is always `undefined` and a parser that tried it would see nothing.
//
// **Only the attributes named below are ever read** — the `statusline-report.ts` rule, for a
// sharper reason. Claude Code puts `user.email`, `user.account_uuid` and `organization.id` on every
// data point and every event, and the events can carry prompt and response text when the owner
// opts in (`OTEL_LOG_USER_PROMPTS`). None of that is Flightdeck's to hold, and what is never read
// cannot be kept, logged or shown (SEC-DATA-1).

/** Lowercase 8-4-4-4-12, as everywhere else an id crosses a boundary (SEC-ING-1). */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Short, plain words — `input`, `cacheRead`, `claude-opus-5`, `tool_result`. Nothing else. */
const LABEL = /^[A-Za-z0-9._[\]-]{1,64}$/;

/**
 * The attribute keys a parser may read. Everything else in a payload is skipped unread.
 *
 * `type` splits tokens, active time and lines; `model` splits cost; `event.name` names an event.
 */
export const READ_ATTRIBUTES = ['session.id', 'type', 'model', 'event.name'] as const;

export type ReadAttribute = (typeof READ_ATTRIBUTES)[number];

/** The allowlisted attributes of one data point or record, as plain strings. */
export type Labels = Readonly<Partial<Record<ReadAttribute, string>>>;

/** As in daemon-roster.ts: an annotated return is what keeps `any` from escaping `Object.entries`. */
export function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}

/** Every element of `source[key]` that is an object; a missing or malformed list is empty. */
export function recordsAt(
  source: Readonly<Record<string, unknown>> | undefined,
  key: string,
): readonly Readonly<Record<string, unknown>>[] {
  const list = source?.[key];
  if (!Array.isArray(list)) return [];
  return list.flatMap((item: unknown) => {
    const record = asRecord(item);
    return record === undefined ? [] : [record];
  });
}

/**
 * The allowlisted attributes of an OTLP `KeyValue[]`, merged over `inherited`.
 *
 * `inherited` is the resource's labels: Claude Code puts the standard attributes on both the
 * resource and each data point (monitoring-usage, "Standard attributes"), and a point that lacks
 * one — `OTEL_METRICS_INCLUDE_SESSION_ID=false` drops it from points — still belongs to the
 * resource's session. A value that is not a short plain word is dropped, never truncated.
 */
export function labelsOf(attributes: unknown, inherited: Labels = {}): Labels {
  const labels: Partial<Record<ReadAttribute, string>> = { ...inherited };
  if (!Array.isArray(attributes)) return labels;
  for (const item of attributes) {
    const pair = asRecord(item);
    const key = pair?.['key'];
    const name = READ_ATTRIBUTES.find((allowed) => allowed === key);
    if (name === undefined) continue;
    const text = scalarText(asRecord(pair?.['value']));
    if (text !== undefined && LABEL.test(text)) labels[name] = text;
  }
  return labels;
}

/** The session id among `labels`, or `undefined` when it is absent or not an id. */
export function sessionIdOf(labels: Labels): string | undefined {
  const id = labels['session.id'];
  return id !== undefined && SESSION_ID.test(id) ? id : undefined;
}

/**
 * A number from a data point: `asDouble`, or `asInt` in either of its JSON forms.
 *
 * Negative and non-finite values are refused: every counter Claude Code exports is monotonic, and
 * a negative delta would be a sender bug that turns a cost down.
 */
export function pointValue(point: Readonly<Record<string, unknown>>): number | undefined {
  const raw = point['asDouble'] ?? point['asInt'];
  const value = typeof raw === 'string' && /^\d{1,15}$/.test(raw) ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

/** `stringValue` as is, `intValue` in either JSON form as digits. Other kinds are not labels. */
function scalarText(value: Readonly<Record<string, unknown>> | undefined): string | undefined {
  if (value === undefined) return undefined;
  const text = value['stringValue'];
  if (typeof text === 'string') return text;
  const integer = value['intValue'];
  if (typeof integer === 'number' && Number.isInteger(integer)) return String(integer);
  return typeof integer === 'string' ? integer : undefined;
}
