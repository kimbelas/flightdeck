// The session vocabulary, shared by core and the UI — DECISIONS.md D7, reconciled against what
// P0-T4 actually measured (D29).
//
// D7 said "use Claude Code's own state vocabulary". P0-T4 then measured that some of that
// vocabulary does not exist in the output. Three corrections live here rather than in a comment on
// the adapter, because a union type is the one place a stale name cannot survive quietly:
//
//   - `waitingFor` is GONE. It is in the binary's strings and in the docs, and it never appeared on
//     any record in any state, including a genuinely blocked one (RESEARCH.md F.2.1). The attention
//     signal is `state === 'blocked'`.
//   - `stopped` is GONE from the run states. `claude stop` leaves a record reading `state: done`,
//     not `stopped`; the documented state was never observed (F.2.3).
//   - `done` therefore means "not running" and nothing more. Stopped, retired and finished are
//     indistinguishable in the listing, which is why the cause is modelled separately as an
//     `EndReason` that something other than the listing has to supply.
//
// No `enum` anywhere: not erasable syntax, and a runtime object besides (R14). Each union has a
// `readonly` tuple beside it for the cases that need to iterate.

/** Which subscription a session belongs to. Two config dirs, two identities. */
export type SubscriptionId = 'isg' | '365';
export const SUBSCRIPTION_IDS: readonly SubscriptionId[] = ['isg', '365'];

/** Interactive sessions never enter the daemon's roster; background ones do (RESEARCH.md F.7.1). */
export type SessionKind = 'interactive' | 'background';
export const SESSION_KINDS: readonly SessionKind[] = ['interactive', 'background'];

/**
 * The `state` field of a background record. Interactive records carry none.
 *
 * `done` is terminal but tells you nothing about why — see `EndReason`.
 */
export type RunState = 'working' | 'blocked' | 'done' | 'failed';
export const RUN_STATES: readonly RunState[] = ['working', 'blocked', 'done', 'failed'];

/**
 * The `status` field, when present.
 *
 * Optional even on a live session: F.2.1 saw a 3-second-old record with `pid` and `state: working`
 * and no `status` at all. Nothing may key off it alone.
 */
export type ActivityStatus = 'busy' | 'waiting' | 'idle';
export const ACTIVITY_STATUSES: readonly ActivityStatus[] = ['busy', 'waiting', 'idle'];

/**
 * Why a session stopped running — the half of `done` the listing cannot tell you.
 *
 * `unknown` is the honest default and stays the answer for most of P1: only `daemon.log` separates
 * the causes (F.2.3), and reading it is deferred to P7-T4. Flightdeck's own audit row supplies
 * `stopped` for actions Flightdeck itself took (SEC-PROC-3, P4-T2).
 *
 * `retired` is the daemon's idle retirement — a NORMAL resting state with a one-click resume
 * (D7), not a failure, which is why it is a reason and not a run state.
 */
export type EndReason = 'stopped' | 'finished' | 'retired' | 'failed' | 'unknown';
export const END_REASONS: readonly EndReason[] = [
  'stopped',
  'finished',
  'retired',
  'failed',
  'unknown',
];

/**
 * Flags Flightdeck derives; Claude Code has no opinion about any of them (D7).
 *
 * `needs-you` is the one the deck sorts on and the whole product's reason to exist.
 */
export type SessionFlag =
  'needs-you' | 'wedged' | 'context-pressure' | 'retired' | 'errored' | 'live';
export const SESSION_FLAGS: readonly SessionFlag[] = [
  'needs-you',
  'wedged',
  'context-pressure',
  'retired',
  'errored',
  'live',
];
