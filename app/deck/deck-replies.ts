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
