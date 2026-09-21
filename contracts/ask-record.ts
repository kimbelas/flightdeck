// One line of headless `stream-json`, narrowed to what the deck may draw — P4-T4, SEC-UI-2.
//
// **This file is a security boundary, not a convenience.** The `system/init` record measured in
// RESEARCH.md F.9.1 carries `messaging_socket_path` (a named pipe D12 says never to touch),
// `memory_paths` and every plugin `path` — all of which contain the Windows account name — plus
// the full tool list, the MCP server roster and the slash-command inventory. Relaying the record
// and letting the deck pick fields would put all of it in the DOM, which is exactly what
// `contracts/core-status.ts` already refuses to do with `transcriptPath` (SEC-DATA-2). So nothing
// is relayed. Each line is rebuilt into one of six small shapes below, by name, and a line that
// matches none of them is DROPPED rather than passed along.
//
// **The vocabulary is wider than the documentation.** RESEARCH.md D.8 lists `system/init`,
// `assistant`, `user`, `stream_event` and `result`. A real run emits four more — `system/status`,
// `system/notification`, `system/hook_started` and `system/hook_response` — and a
// `rate_limit_event` nobody had written down (F.9.2). The last one matters beyond parsing: it
// carries both quota windows, so an Ask run reports headroom the same way a statusLine render
// does, and P4-T3's routing can be fed by it.
//
// **`utilization` is a FRACTION here and a PERCENTAGE in the statusLine payload.** `0.08` from
// `rate_limit_event.rate_limit_info.unifiedWindows` is the same quantity `used_percentage: 8`
// carries in `statusline-report.ts`. Two units for one number, in two payloads, from one binary —
// so the conversion happens here, once, at the parse, and `AskQuota` is in percent like everything
// else the deck holds. `resetsAt` is in SECONDS here too, as it is there, and becomes milliseconds
// for the same reason.
import { SUBSCRIPTION_IDS, type SubscriptionId } from './session.ts';

/** Text is capped where it is parsed — the rule `job-state.ts` set. A run can emit a lot of it. */
export const MAX_ASK_TEXT_CHARS = 4000;
/** How much of one run's answer the deck keeps. Past this the panel stops growing (P4-T4). */
export const MAX_ASK_ANSWER_CHARS = 200_000;

/** Both windows off a `rate_limit_event`, in percent, with reset instants in epoch ms. */
export interface AskQuota {
  readonly fiveHourPercentage: number | undefined;
  readonly fiveHourResetsAt: number | undefined;
  readonly sevenDayPercentage: number | undefined;
  readonly sevenDayResetsAt: number | undefined;
}

/**
 * What one line of the stream becomes, or nothing.
 *
 * Six shapes where the CLI has ten record types, because the extra four say nothing a reader of a
 * result panel can act on: `hook_started` / `hook_response` are Flightdeck's own hooks firing,
 * and `system/status` is a spinner. Dropping them here rather than in the panel means they never
 * cross the wire at all.
 */
export type AskRecord =
  | {
      readonly kind: 'started';
      readonly sessionId: string;
      readonly model: string | undefined;
      /** What the run is actually allowed to do. The reason this field exists is D47. */
      readonly permissionMode: string | undefined;
    }
  /** A complete assistant text block. Arrives after the deltas that spelled it out. */
  | { readonly kind: 'text'; readonly text: string }
  /** A partial token from `--include-partial-messages`. What makes the panel fill as it runs. */
  | { readonly kind: 'delta'; readonly text: string }
  /** `system/notification` — the CLI telling the owner something went wrong beside the answer. */
  | { readonly kind: 'notice'; readonly text: string }
  | { readonly kind: 'quota'; readonly quota: AskQuota }
  | {
      readonly kind: 'done';
      readonly ok: boolean;
      readonly costUsd: number | undefined;
      readonly durationMs: number | undefined;
      readonly stopReason: string | undefined;
    };

/** Which subscription an Ask ran on, and which run it belongs to — the frame's envelope. */
export interface AskFrame {
  readonly runId: string;
  readonly subscription: SubscriptionId;
  readonly record: AskRecord;
}

/**
 * One line of `stream-json`, or `undefined` for a line this build does not draw.
 *
 * Total and pure: malformed JSON is an unrecognised line, not an exception — the same bargain
 * `parseStreamFrame` makes, and for the same reason. A run that emitted one bad line must still
 * produce an answer.
 *
 * @throws never.
 */
export function parseAskLine(line: string): AskRecord | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  const fields = asRecord(value);
  if (fields === undefined) return undefined;
  switch (fields['type']) {
    case 'system':
      return systemRecord(fields);
    case 'assistant':
      return assistantRecord(fields);
    case 'stream_event':
      return deltaRecord(fields);
    case 'rate_limit_event':
      return quotaRecord(fields);
    case 'result':
      return doneRecord(fields);
    default:
      return undefined;
  }
}

/** `init` and `notification` are the two the panel draws; `status` and the hooks are dropped. */
function systemRecord(fields: Readonly<Record<string, unknown>>): AskRecord | undefined {
  if (fields['subtype'] === 'init') {
    const sessionId = text(fields['session_id'], 64);
    if (sessionId === '') return undefined;
    return {
      kind: 'started',
      sessionId,
      model: optional(fields['model'], 64),
      permissionMode: optional(fields['permissionMode'], 64),
    };
  }
  if (fields['subtype'] === 'notification') {
    const body = text(fields['text'], MAX_ASK_TEXT_CHARS);
    return body === '' ? undefined : { kind: 'notice', text: body };
  }
  return undefined;
}

/** Every text block on the message, joined. Tool-use blocks carry no text and contribute none. */
function assistantRecord(fields: Readonly<Record<string, unknown>>): AskRecord | undefined {
  const message = asRecord(fields['message']);
  const content = message?.['content'];
  if (!Array.isArray(content)) return undefined;
  const body = content
    .map((block: unknown) =>
      asRecord(block)?.['type'] === 'text' ? asRecord(block)?.['text'] : '',
    )
    .map((part: unknown) => text(part, MAX_ASK_TEXT_CHARS))
    .filter((part) => part !== '')
    .join('');
  return body === '' ? undefined : { kind: 'text', text: body.slice(0, MAX_ASK_TEXT_CHARS) };
}

/** Only `content_block_delta`'s `text_delta`. The other five `stream_event`s say nothing new. */
function deltaRecord(fields: Readonly<Record<string, unknown>>): AskRecord | undefined {
  const event = asRecord(fields['event']);
  if (event?.['type'] !== 'content_block_delta') return undefined;
  const delta = asRecord(event['delta']);
  if (delta?.['type'] !== 'text_delta') return undefined;
  const body = text(delta['text'], MAX_ASK_TEXT_CHARS);
  return body === '' ? undefined : { kind: 'delta', text: body };
}

/** Both windows, converted from fraction to percent and from seconds to milliseconds. */
function quotaRecord(fields: Readonly<Record<string, unknown>>): AskRecord | undefined {
  const windows = asRecord(asRecord(fields['rate_limit_info'])?.['unifiedWindows']);
  if (windows === undefined) return undefined;
  const fiveHour = asRecord(windows['five_hour']);
  const sevenDay = asRecord(windows['seven_day']);
  const quota: AskQuota = {
    fiveHourPercentage: percentOf(fiveHour?.['utilization']),
    fiveHourResetsAt: millisOf(fiveHour?.['resetsAt']),
    sevenDayPercentage: percentOf(sevenDay?.['utilization']),
    sevenDayResetsAt: millisOf(sevenDay?.['resetsAt']),
  };
  const empty = quota.fiveHourPercentage === undefined && quota.sevenDayPercentage === undefined;
  return empty ? undefined : { kind: 'quota', quota };
}

/**
 * The final record.
 *
 * `is_error` is trusted over `subtype` where they disagree, and `subtype` fills in where the field
 * is absent: a run that stopped on its budget answers `subtype: "error_max_budget"` and is not a
 * crash, so the panel needs the difference between "it finished" and "it finished well".
 */
function doneRecord(fields: Readonly<Record<string, unknown>>): AskRecord {
  const subtype = text(fields['subtype'], 64);
  const failed = fields['is_error'] === true || (subtype !== '' && subtype !== 'success');
  return {
    kind: 'done',
    ok: !failed,
    costUsd: numberOf(fields['total_cost_usd']),
    durationMs: numberOf(fields['duration_ms']) ?? numberOf(fields['duration_api_ms']),
    stopReason: optional(fields['stop_reason'], 64) ?? optional(fields['subtype'], 64),
  };
}

/** `0.08` becomes `8`. Out of range is dropped rather than clamped, as `parseQuotaSummary` does. */
function percentOf(value: unknown): number | undefined {
  const fraction = numberOf(value);
  if (fraction === undefined || fraction < 0 || fraction > 1) return undefined;
  return Math.round(fraction * 1000) / 10;
}

/** Seconds on the wire, milliseconds everywhere in this codebase — as statusline-report.ts does. */
function millisOf(value: unknown): number | undefined {
  const seconds = numberOf(value);
  return seconds === undefined || seconds <= 0 ? undefined : seconds * 1000;
}

/** One frame off the wire, for the deck's side of the stream. @throws never. */
export function parseAskFrame(value: unknown): AskFrame | undefined {
  const fields = asRecord(value);
  if (fields === undefined) return undefined;
  const runId = text(fields['runId'], 64);
  const subscription = SUBSCRIPTION_IDS.find((id) => id === fields['subscription']);
  const record = parseAskRecord(fields['record']);
  if (runId === '' || subscription === undefined || record === undefined) return undefined;
  return { runId, subscription, record };
}

/**
 * One already-narrowed record off the wire.
 *
 * Deliberately NOT `parseAskLine`: that reads the CLI's vocabulary (`type`, `subtype`, `event`),
 * and by the time a record reaches a browser it has been rebuilt into the union above, whose
 * discriminant is `kind`. Two shapes, two parsers — reusing one for the other is how a deck ends
 * up trusting a frame nothing validated, and the first draft of this file did exactly that.
 *
 * @throws never.
 */
export function parseAskRecord(value: unknown): AskRecord | undefined {
  const fields = asRecord(value);
  if (fields === undefined) return undefined;
  switch (fields['kind']) {
    case 'started': {
      const sessionId = text(fields['sessionId'], 64);
      if (sessionId === '') return undefined;
      return {
        kind: 'started',
        sessionId,
        model: optional(fields['model'], 64),
        permissionMode: optional(fields['permissionMode'], 64),
      };
    }
    case 'text':
    case 'delta':
    case 'notice':
      return textRecord(fields['kind'], fields['text']);
    case 'quota':
      return frameQuota(fields['quota']);
    case 'done':
      return {
        kind: 'done',
        ok: fields['ok'] === true,
        costUsd: numberOf(fields['costUsd']),
        durationMs: numberOf(fields['durationMs']),
        stopReason: optional(fields['stopReason'], 64),
      };
    default:
      return undefined;
  }
}

/** The three shapes that are one capped string. Split out to keep the switch inside its limits. */
function textRecord(kind: unknown, value: unknown): AskRecord | undefined {
  const body = text(value, MAX_ASK_TEXT_CHARS);
  if (body === '') return undefined;
  if (kind === 'text') return { kind: 'text', text: body };
  if (kind === 'delta') return { kind: 'delta', text: body };
  return { kind: 'notice', text: body };
}

/** A gauge past 100 % is dropped rather than clamped — `parseQuotaSummary`'s rule, kept here. */
function frameQuota(value: unknown): AskRecord | undefined {
  const fields = asRecord(value);
  if (fields === undefined) return undefined;
  const quota: AskQuota = {
    fiveHourPercentage: boundedPercent(fields['fiveHourPercentage']),
    fiveHourResetsAt: numberOf(fields['fiveHourResetsAt']),
    sevenDayPercentage: boundedPercent(fields['sevenDayPercentage']),
    sevenDayResetsAt: numberOf(fields['sevenDayResetsAt']),
  };
  const empty = quota.fiveHourPercentage === undefined && quota.sevenDayPercentage === undefined;
  return empty ? undefined : { kind: 'quota', quota };
}

function boundedPercent(value: unknown): number | undefined {
  const percent = numberOf(value);
  return percent === undefined || percent < 0 || percent > 100 ? undefined : percent;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}

function text(value: unknown, cap: number): string {
  return typeof value === 'string' ? value.slice(0, cap) : '';
}

function optional(value: unknown, cap: number): string | undefined {
  const held = text(value, cap);
  return held === '' ? undefined : held;
}

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
