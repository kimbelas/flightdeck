// What core's answers to the two session verbs mean — P4-T2a.
//
// Out of `deck-store.ts` for its 250-line limit, and the seam holds: the store owns STATE, and
// these four functions own the reading of one reply. Neither touches the network — `DeckApi` does
// that — so this file is pure and the store keeps its subject.
//
// The shared rule, which is the reason both `whyNot` functions exist rather than one `describe`:
// **prefer core's own code to the status it came under.** `no_claude` is a 503, and reading a 503
// as "core is not running" is exactly wrong — core is running, it answered, and it cannot find
// claude.exe. That is the operator's to fix and is the one code worth repeating verbatim.
import {
  parseAdoptFailure,
  parseTakeoverFailure,
  parseLaunchAccepted,
  parseLaunchFailure,
  parseRemoveFailure,
  parseResumeFailure,
  parsePopoutFailure,
  parseStopFailure,
  type LaunchAccepted,
} from '../../contracts/launch-reply.ts';
import type { JsonReply } from './deck-api.ts';

export const UNREACHABLE = 'Could not reach flightdeck-core.';

/** Said out loud rather than swallowed: a reply nobody can parse is not an empty session list. */
export const UNREADABLE = 'flightdeck-core answered something the deck could not read.';

/**
 * The session a launch actually started, or `undefined` for a reply that did not start one.
 *
 * 201 exactly: core answers `created` for a session that now exists, and anything else — a 200
 * included — is not one (LaunchRoute).
 */
export function whatStarted(reply: JsonReply): LaunchAccepted | undefined {
  return reply.status === 201 ? parseLaunchAccepted(reply.body) : undefined;
}

/**
 * Why it did not, preferring core's own code to the status it came under.
 *
 * The status alone lies here. `no_claude` is a 503, and `describe` reads a 503 as "core is not
 * running" — which is exactly wrong: core is running, it answered, and it cannot find claude.exe.
 * That is the operator's to fix and the only one of the three codes worth repeating; the other two
 * describe the request, which the owner cannot act on.
 */
export function whyNotLaunched(reply: JsonReply | undefined): string {
  if (reply === undefined) return UNREACHABLE;
  const failure = parseLaunchFailure(reply.body);
  if (failure === 'no_shell') {
    return 'Core is running but cannot find powershell.exe — run `npm run doctor`.';
  }
  // The one refusal that is NOT "it did not start". Exit 0 means a session may well exist, and
  // telling the owner it failed is how they end up starting a second one (P4-T2).
  if (failure === 'no_session_id') {
    return 'Claude started but printed no session id — check `claude agents` before trying again.';
  }
  // P9-T1. The two that name something the owner can fix from the presets panel.
  if (failure === 'unknown_agent') {
    return 'That agent is no longer in the project .claude/agents roster — pick another, or none.';
  }
  if (failure === 'pins_agent') {
    return 'claude-isg-orch already runs the orchestrator agent — it cannot take a second one.';
  }
  if (failure !== undefined) return 'Core would not start that session.';
  // A 201 that got this far carried something other than a session id.
  return reply.status === 201 ? UNREADABLE : describeStatus(reply.status);
}

/**
 * Why a session would not wake, preferring core's code to the status, exactly as `whyNotLaunched`.
 *
 * `bad_session` gets a sentence of its own rather than being folded in with the rest, because it is
 * the one that means the DECK sent something wrong — a row carrying an id that is not a full
 * lowercase uuid — and it is worth being able to tell that apart from the CLI refusing.
 */
export function whyNotResumed(reply: JsonReply | undefined): string {
  if (reply === undefined) return UNREACHABLE;
  const failure = parseResumeFailure(reply.body);
  if (failure === 'no_claude') {
    return 'Core is running but cannot find claude.exe — run `npm run doctor`.';
  }
  if (failure === 'bad_session') return 'That row does not carry a full session id.';
  if (failure !== undefined) return 'Core could not wake that session.';
  return describeStatus(reply.status);
}

/**
 * Why a session would not be adopted — P6-T7, SPEC §4.3.
 *
 * `still_running` is the one worth its own sentence, and it is not a failure at all: the terminal
 * is still open, which is a thing to go and do something about rather than a thing that went
 * wrong. `not_adoptable` is almost always core having restarted — its memory of the ended terminal
 * went with it — so the sentence says what to do rather than naming the code.
 */
export function whyNotAdopted(reply: JsonReply | undefined): string {
  if (reply === undefined) return UNREACHABLE;
  const failure = parseAdoptFailure(bodyError(reply.body));
  if (failure === 'no_claude') {
    return 'Core is running but cannot find claude.exe — run `npm run doctor`.';
  }
  if (failure === 'bad_session') return 'That row does not carry a full session id.';
  if (failure === 'still_running') return 'That terminal is still open. Close it, then adopt it.';
  if (failure === 'not_adoptable') {
    return 'Core no longer knows where that session was running, so it cannot be adopted.';
  }
  if (failure !== undefined) return 'Core could not adopt that session.';
  return describeStatus(reply.status);
}

/**
 * Why a live session would not be moved here — P6-T8, D63.
 *
 * `busy` first, because it is the common one and not a failure: the session started a turn between
 * the row being drawn and the press. Every refusal happened before core ended anything, which is
 * why the sentences say the terminal is untouched — that is the question somebody has after a
 * refusal on this button. `adopt_failed` is the one that comes after: the terminal is gone and the
 * row will offer `adopt` as the retry.
 */
export function whyNotTakenOver(reply: JsonReply | undefined): string {
  if (reply === undefined) return UNREACHABLE;
  const failure = parseTakeoverFailure(bodyError(reply.body));
  if (failure === 'busy')
    return 'That session started working. Its terminal was left alone — try again when the turn ends.';
  if (failure === 'no_claude') {
    return 'Core is running but cannot find claude.exe — run `npm run doctor`.';
  }
  if (failure === 'not_running') return 'That session has already ended. Adopt it instead.';
  if (failure === 'end_failed')
    return 'Windows would not close that terminal’s Claude. Nothing was moved.';
  if (failure === 'adopt_failed') {
    return 'Its terminal closed, but the session did not come back here. Adopt it from its row to retry.';
  }
  if (failure !== undefined)
    return 'Core would not move that session. Its terminal was left alone.';
  return describeStatus(reply.status);
}

/** The `error` field of a reply body, without asserting what the body is. */
function bodyError(body: unknown): unknown {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  return Object.fromEntries(Object.entries(body))['error'];
}

/**
 * Why a session would not stop, on the same rule as the other two.
 *
 * `bad_session` means the DECK sent something wrong — a row missing one of the two ids, or one
 * that is not the right shape. `stop` takes the SHORT id and refuses the full uuid (F.2.8b), so
 * this is the code a row with a half-filled ref would produce.
 */
/**
 * Why the pop-out did not happen — P6-T2.
 *
 * Its own function beside the others for the reason their unions are separate: the verbs
 * sound alike and are not. `no_terminal` covers two absences on purpose — Windows Terminal
 * and Claude Code — because from here they are one sentence.
 */
export function whyNotPoppedOut(reply: JsonReply | undefined): string {
  if (reply === undefined) return UNREACHABLE;
  const failure = parsePopoutFailure(reply.body);
  if (failure === 'no_terminal') {
    return 'Nothing here to pop out into — Windows Terminal or claude.exe is missing.';
  }
  if (failure === 'bad_session') return 'That row does not carry the ids core needs.';
  if (failure !== undefined) return 'Core could not open Windows Terminal.';
  return describeStatus(reply.status);
}

export function whyNotStopped(reply: JsonReply | undefined): string {
  if (reply === undefined) return UNREACHABLE;
  const failure = parseStopFailure(reply.body);
  if (failure === 'no_claude') {
    return 'Core is running but cannot find claude.exe — run `npm run doctor`.';
  }
  if (failure === 'bad_session') return 'That row does not carry the ids core needs.';
  if (failure !== undefined) return 'Core could not stop that session.';
  return describeStatus(reply.status);
}

/**
 * Why a session would not be DELETED, on the same rule as the other three — P4-T2.
 *
 * A separate function rather than a shared one with `whyNotStopped`, for the reason the unions are
 * separate: the two verbs sound alike and are not, and a sentence that said "could not stop" after
 * a failed delete would leave the owner thinking the conversation survived when it may not have.
 */
export function whyNotRemoved(reply: JsonReply | undefined): string {
  if (reply === undefined) return UNREACHABLE;
  const failure = parseRemoveFailure(reply.body);
  if (failure === 'no_claude') {
    return 'Core is running but cannot find claude.exe — run `npm run doctor`.';
  }
  if (failure === 'bad_session') return 'That row does not carry the ids core needs.';
  if (failure !== undefined) return 'Core could not delete that session.';
  return describeStatus(reply.status);
}

export function describeStatus(status: number): string {
  if (status === 503) return 'flightdeck-core is not running.';
  if (status === 401 || status === 403)
    return 'Core refused the request — restart it to reissue the token.';
  return `Core answered ${String(status)}.`;
}
