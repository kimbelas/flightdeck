// One vitals observation, kept — P1-T8, SPEC §5.4 and §5.5.
//
// **This is the one thing in the store that is not an event.** `VitalsRegistry` holds the newest
// render per session in memory and that is right for "what is true now" (the same reasoning that
// keeps the live session set out of the store, BUILD-PLAN §3). But two of the deck's readings are
// not about now at all: the token-burn sparkline (§5.4) and the burn rate projected against the
// 5-hour quota (§5.5) are both questions about a *series*, and a registry that overwrites cannot
// answer them.
//
// **It is a projection of a projection, deliberately.** `StatuslineReport` is already only what
// Flightdeck reads out of a render; this is only what a chart plots out of that. Cost, context and
// the model — nothing else, and no free text at all, so the row that is kept forever carries
// nothing a person wrote (SEC-UI-2, SEC-DATA-2).
//
// **Written on change, not on render.** The statusLine posts on every repaint; `VitalsRegistry`
// already answers "did this move in a way anyone would draw differently", and the snapshot rides
// that same gate. Without it the table would gain hundreds of identical rows a minute per session
// — the exact cost the registry was built to avoid for the log.
import type { DraftEvent } from './fd-event.ts';
import type { SubscriptionId } from './session.ts';
import type { StatuslineReport } from './statusline-report.ts';

/** A snapshot as its producer describes it, before the store gives it a place in the sequence. */
export interface DraftVitalsSnapshot {
  /** Epoch ms, taken from a `Clock`. */
  readonly at: number;
  readonly sessionId: string;
  readonly subscription: SubscriptionId;
  /** Percent of the context window used, or `undefined` before the first turn — never `0` (F.3.5). */
  readonly usedPercentage: number | undefined;
  readonly contextWindowSize: number | undefined;
  /** From Claude Code, never from token arithmetic (D5). */
  readonly costUsd: number | undefined;
  readonly modelId: string | undefined;
}

/** A stored snapshot. `id` is monotonic within one store. */
export interface VitalsSnapshot extends DraftVitalsSnapshot {
  readonly id: number;
}

/**
 * The part of a render worth keeping.
 *
 * A function rather than a constructor so the shape stays a plain record across the port, and so
 * the decision about what a chart needs lives next to the type that says it.
 */
export function snapshotOf(
  report: StatuslineReport,
  subscription: SubscriptionId,
  at: number,
): DraftVitalsSnapshot {
  return {
    at,
    sessionId: report.sessionId,
    subscription,
    usedPercentage: report.usedPercentage,
    contextWindowSize: report.contextWindowSize,
    costUsd: report.costUsd,
    modelId: report.modelId,
  };
}

/**
 * A snapshot out of a `vitals` event, or `undefined` if the event is not one.
 *
 * `DraftEvent.payload` is `unknown` by contract even when this project produced it, and it stays
 * that way here: the same event is replayed out of the store, where it is a row an older build may
 * have written. Narrowing it is the same rule that makes `SessionStreamRoute` re-parse a row on the
 * way out rather than trust the one it just made (P1-T9).
 */
export function snapshotFromEvent(event: DraftEvent): DraftVitalsSnapshot | undefined {
  if (event.source !== 'statusline') return undefined;
  const payload = event.payload;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(payload));
  const sessionId = fields['sessionId'];
  if (typeof sessionId !== 'string' || sessionId === '') return undefined;
  return {
    at: event.at,
    sessionId,
    subscription: event.subscription,
    usedPercentage: numberOrNothing(fields['usedPercentage']),
    contextWindowSize: numberOrNothing(fields['contextWindowSize']),
    costUsd: numberOrNothing(fields['costUsd']),
    modelId: typeof fields['modelId'] === 'string' ? fields['modelId'] : undefined,
  };
}

/** `null` and absent both become `undefined`, which stays distinguishable from zero (F.3.5). */
function numberOrNothing(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
