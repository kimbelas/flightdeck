// How a session that stopped running ended, as one word the deck and the toast both say — D62.
//
// A row carries the log's two facts separately, `endReason` and `retireReason`, because those are
// the daemon's vocabulary (F.2.3, F.2.15). What a person reads is the two together, and it has
// one definition here for `needsAttention`'s reason: the toast that fires about a row and the
// row it fires about must not use different words for the same ending.
//
// **`retired-waiting` is the one that matters.** A session the daemon retires as `idle-prompt`
// was BLOCKED on the owner when the timer took it — an abandoned request for attention, not a
// completion (F.2.15). Calling it "finished" is the wrong word D58 said out loud; this is where
// it stops being said.
import type { RetireReason } from './session.ts';
import type { SessionRow } from './session-row.ts';

export type SessionEnding =
  'finished' | 'stopped' | 'retired-finished' | 'retired-waiting' | 'retired-unused' | 'retired';

const RETIRED_AS: Readonly<Record<RetireReason, SessionEnding>> = {
  settled: 'retired-finished',
  'idle-prompt': 'retired-waiting',
  'empty-idle': 'retired-unused',
};

/** The row's state label once it has one of these — lower case, like the run states it replaces. */
export const ENDING_LABELS: Readonly<Record<SessionEnding, string>> = {
  finished: 'finished',
  stopped: 'stopped',
  'retired-finished': 'retired after finishing',
  'retired-waiting': 'retired while waiting for you',
  'retired-unused': 'retired before its first turn',
  retired: 'retired',
};

/**
 * The ending a row can name, or `undefined` while it runs or when nothing knows why it stopped.
 *
 * `failed` is not here: a failed session is the `errored` toast and the listing's own `failed`
 * run state, and the log's endings never produce it.
 */
export function endingOf(
  row: Pick<SessionRow, 'live' | 'endReason' | 'retireReason'>,
): SessionEnding | undefined {
  if (row.live) return undefined;
  if (row.endReason === 'finished' || row.endReason === 'stopped') return row.endReason;
  if (row.endReason !== 'retired') return undefined;
  return row.retireReason === undefined ? 'retired' : RETIRED_AS[row.retireReason];
}
