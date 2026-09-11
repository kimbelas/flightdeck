// The derived flags — DECISIONS.md D7, and the only place the deck's sort order comes from.
//
// D7 named five. Two of them were written before P0-T4 measured what the listing contains, and
// this is where the difference shows (D29):
//
//   - **needs-you** was defined as "`blocked`, `waitingFor`, an idle_prompt/permission_prompt
//     notification, or idle right after a Stop". `waitingFor` does not exist on any record
//     (RESEARCH.md F.2.1), so `state === 'blocked'` is the whole of the listing's contribution.
//     The notification and post-Stop signals come from the hooks feed, which is P1-T5, so they
//     arrive here as an explicit `attentionSignal` rather than being invented from the listing.
//   - **retired** cannot be derived from the listing at all: a stopped session and a retired one
//     both read `state: done` and only `daemon.log` separates them (F.2.3). It is therefore
//     derived from the END REASON, which something that actually knows has to supply.
//
// Everything here is a pure function of the entity's own state. No clock reads, no IO: `wedged`
// takes the elapsed time as an argument so the rule is testable without waiting for it.
import type { SessionFlag } from '../../contracts/session.ts';
import type { SessionState } from './session-state.ts';
import type { SessionVitals } from './session-vitals.ts';

/** SPEC §5 — a session that claims to be working and has said nothing for this long is stuck. */
export const WEDGED_AFTER_MS = 10 * 60 * 1000;

export interface FlagInput {
  readonly state: SessionState;
  readonly vitals: SessionVitals;
  /** Milliseconds since this session last produced an event, or undefined if it never has. */
  readonly sinceLastEventMs: number | undefined;
  /** Set by the hooks feed (P1-T5) for the signals the listing cannot carry. */
  readonly attentionSignal: boolean;
}

function needsYou(input: FlagInput): boolean {
  return input.state.runState === 'blocked' || input.attentionSignal;
}

/**
 * Working, live, and silent for too long.
 *
 * Liveness is part of it deliberately: a record with no `pid` is not running, so it cannot be
 * wedged however long ago it last spoke (F.2.1). Without that check every finished session in the
 * listing turns amber ten minutes after it ends.
 */
function wedged(input: FlagInput): boolean {
  if (input.state.runState !== 'working' || !input.state.isLive) return false;
  return input.sinceLastEventMs !== undefined && input.sinceLastEventMs >= WEDGED_AFTER_MS;
}

/**
 * Retirement is the daemon reclaiming an idle session, and D7 is explicit that it is a NORMAL
 * resting state with a one-click resume — so it must never also read as errored.
 */
function retired(input: FlagInput): boolean {
  return input.state.endReason === 'retired';
}

function errored(input: FlagInput): boolean {
  return input.state.runState === 'failed' || input.state.endReason === 'failed';
}

/**
 * Every flag that currently applies, in the order the deck ranks them.
 *
 * Order is part of the contract, not an accident of iteration: P2-T4 sorts rows by attention and
 * the first flag is the one a row is badged with.
 */
export function deriveFlags(input: FlagInput): readonly SessionFlag[] {
  const flags: SessionFlag[] = [];
  if (needsYou(input)) flags.push('needs-you');
  if (errored(input)) flags.push('errored');
  if (wedged(input)) flags.push('wedged');
  if (input.vitals.isUnderPressure) flags.push('context-pressure');
  if (retired(input)) flags.push('retired');
  if (input.state.isLive) flags.push('live');
  return flags;
}
