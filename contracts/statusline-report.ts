// What `POST /statusline` keeps out of a statusLine payload — P1-T6, RESEARCH.md F.3.5.
//
// **A projection, not a mirror**, and that is the difference from `hook-event.ts`. A hook payload
// is kept verbatim because the store replays it; a statusLine payload arrives on **every render**
// and is mostly things Flightdeck has no use for — `prompt_cache` alone carries fourteen fields
// about cache economics. Reading only the named fields is the same rule `daemon-roster.ts` follows
// and for the same reason: what is never read cannot leak, and a shape that grows a field in the
// next release cannot surprise anything here.
//
// **The trap this file exists for.** Before the first turn, `used_percentage`,
// `remaining_percentage` and `current_usage` are *present and `null`* — not absent, not `0`
// (F.3.5). A parser that models "no value" as a missing key rejects a real payload; one that
// coerces `null` to `0` paints a 0 %-used context bar on every session that has not spoken yet,
// which is precisely the reading the deck exists to make trustworthy. `null` and absent both
// become `undefined` here, and `SessionVitals` keeps them distinguishable from zero downstream.
//
// **`resets_at` is Unix seconds and everything else in this codebase is milliseconds.** It is
// converted here, at the boundary, rather than remembered at each use — a quota gauge that was
// 1000× wrong would read as "resets in 19 000 years" and be noticed, but a comparison against
// `Date.now()` would silently always be in the past.

/** One rate-limit window. Both halves are optional: a payload may carry the block and no numbers. */
export interface QuotaWindow {
  /** 0–100, or `undefined` when the payload said `null` or nothing at all. */
  readonly usedPercentage: number | undefined;
  /** Epoch **milliseconds**, converted from the payload's seconds. */
  readonly resetsAt: number | undefined;
}

export const NO_QUOTA: QuotaWindow = { usedPercentage: undefined, resetsAt: undefined };

/**
 * One render's worth of vitals, reduced to what Flightdeck shows.
 *
 * `sessionId` is the only field that is always there. Everything else is `| undefined`, because
 * P0-T5 measured which fields exist before the first turn and the honest answer is "fewer than
 * you would like" — and because `spend_limit`, `agent`, `pr`, `worktree` and `effort` did not
 * appear on either capture at all, so nothing may require them.
 */
export interface StatuslineReport {
  readonly sessionId: string;
  readonly transcriptPath: string;
  /** The `-n` name, or one Claude Code derived from the prompt. Absent before the first turn. */
  readonly sessionName: string | undefined;
  readonly modelId: string | undefined;
  readonly modelName: string | undefined;
  readonly claudeVersion: string | undefined;
  /** From Claude Code, never from token arithmetic (DECISIONS.md D5). */
  readonly costUsd: number | undefined;
  /** Percent of the context window used, or `undefined` before the first turn — never `0`. */
  readonly usedPercentage: number | undefined;
  readonly contextWindowSize: number | undefined;
  readonly fiveHour: QuotaWindow;
  readonly sevenDay: QuotaWindow;
}

/** Lowercase 8-4-4-4-12, as everywhere else an id crosses a boundary (SEC-ING-1). */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const SECONDS_TO_MS = 1000;

/**
 * One payload, or `undefined` if it is not one.
 *
 * Rejects only on the two fields nothing can be done without — the session id and the transcript
 * path, which is what attributes the render to a subscription. Everything else that is wrong is
 * dropped rather than refused: a render arrives every second or so, and refusing a whole payload
 * because Claude Code added a field or sent a percentage out of range would throw away the quota
 * numbers as well.
 *
 * @throws never.
 */
export function parseStatuslineReport(value: unknown): StatuslineReport | undefined {
  const fields = asRecord(value);
  if (fields === undefined) return undefined;

  const sessionId = stringAt(fields, 'session_id');
  const transcriptPath = stringAt(fields, 'transcript_path');
  if (sessionId === undefined || !SESSION_ID.test(sessionId)) return undefined;
  if (transcriptPath === undefined) return undefined;

  const model = asRecord(fields['model']);
  const cost = asRecord(fields['cost']);
  const context = asRecord(fields['context_window']);
  const limits = asRecord(fields['rate_limits']);

  return {
    sessionId,
    transcriptPath,
    sessionName: stringAt(fields, 'session_name'),
    modelId: model === undefined ? undefined : stringAt(model, 'id'),
    modelName: model === undefined ? undefined : stringAt(model, 'display_name'),
    claudeVersion: stringAt(fields, 'version'),
    costUsd: cost === undefined ? undefined : positiveAt(cost, 'total_cost_usd'),
    usedPercentage: context === undefined ? undefined : percentAt(context, 'used_percentage'),
    contextWindowSize:
      context === undefined ? undefined : positiveAt(context, 'context_window_size'),
    fiveHour: quotaAt(limits, 'five_hour'),
    sevenDay: quotaAt(limits, 'seven_day'),
  };
}

function quotaAt(limits: Readonly<Record<string, unknown>> | undefined, key: string): QuotaWindow {
  const window = limits === undefined ? undefined : asRecord(limits[key]);
  if (window === undefined) return NO_QUOTA;
  const resetsAt = positiveAt(window, 'resets_at');
  return {
    usedPercentage: percentAt(window, 'used_percentage'),
    // Seconds on the wire, milliseconds everywhere here. See the header.
    resetsAt: resetsAt === undefined ? undefined : resetsAt * SECONDS_TO_MS,
  };
}

/** As in daemon-roster.ts: an annotated return is what keeps `any` from escaping `Object.entries`. */
function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}

function stringAt(source: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** A finite number that is not negative, or nothing. `null` lands here and comes back undefined. */
function positiveAt(source: Readonly<Record<string, unknown>>, key: string): number | undefined {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

/**
 * A percentage in 0–100, or nothing.
 *
 * Out of range is dropped rather than raised, unlike `SessionVitals.of`, which throws on one. The
 * difference is who is asking: the domain object is constructed from values this project already
 * believes, and this is the boundary where a payload that has changed shape arrives — on the hot
 * path, on every render, with no one to tell.
 */
function percentAt(source: Readonly<Record<string, unknown>>, key: string): number | undefined {
  const value = positiveAt(source, key);
  return value === undefined || value > 100 ? undefined : value;
}
