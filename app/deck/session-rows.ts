// The row arithmetic the stream's deltas need — split out of `deck-store.ts` in P4-T4.
//
// The same division that produced `deck-state.ts` and the five slices, and for the same reason:
// that file has a 250-line limit and reached it again. What is here is the part with no behaviour
// in it — two pure functions over a row list, with no store, no API and no clock — which makes it
// the seam that costs a reader the least.
//
// **Re-sorted on every upsert, not appended.** `byAttentionThenAge` puts the sessions that need
// somebody at the top, and that is a property of the CURRENT state of each row rather than of when
// it arrived: a row that just became `blocked` has to move, and one that stopped being blocked has
// to move back. Appending and leaving the order alone would mean the list was sorted only at the
// moment of the snapshot.
import { byAttentionThenAge, sessionKey, type SessionRow } from '../../contracts/session-row.ts';

/** Replaces the row if it is already known, appends it if not, and re-sorts either way. */
export function upsert(rows: readonly SessionRow[], row: SessionRow): readonly SessionRow[] {
  return [...without(rows, sessionKey(row)), row].sort(byAttentionThenAge);
}

/** Every row but the one with this key. Also how `session.gone` drops a row. */
export function without(rows: readonly SessionRow[], key: string): readonly SessionRow[] {
  return rows.filter((row) => sessionKey(row) !== key);
}
