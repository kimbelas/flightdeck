// How long ago something was, in one short label — P3-T7.
//
// A file of its own because the thing it measures is DAYS. Three near-copies of this idea already
// live on the deck and each stops where its own reading stops: `quota-view-model.ts` answers about
// a gauge read minutes ago, `session-preview-view-model.ts` about a frame, `session-detail-view.tsx`
// about a timeline entry. None of them goes past hours in the same shape, and a config change is
// routinely three weeks old — so this is the ladder that has a `d` and a `w` on it rather than a
// fourth copy of one that does not. The three are left alone deliberately: each prints a different
// granularity on purpose, and unifying them would change what three shipped panels say.
//
// Rounded DOWN at every step, which is `agoLabel`'s rule where it already exists: "2d" for
// something 2 days and 23 hours old understates, and an age that overstated would be the one
// number on the row that could be argued with.

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/**
 * `40s`, `14m`, `2h`, `3d`, `5w` — the largest unit that is not zero.
 *
 * One unit rather than two, unlike the quota countdown: this is read at a glance to answer "is this
 * news or is it history", and `3d 07h` asks the reader to parse a number they will not act on.
 *
 * @param ms how long ago. Negative — a clock that disagrees with core's — reads as `0s` rather
 * than as a negative age, because a row saying `-4s ago` is a bug report nobody can act on.
 */
export function agoLabel(ms: number): string {
  const since = Math.max(0, ms);
  if (since < MINUTE_MS) return `${String(Math.floor(since / 1000))}s`;
  if (since < HOUR_MS) return `${String(Math.floor(since / MINUTE_MS))}m`;
  if (since < DAY_MS) return `${String(Math.floor(since / HOUR_MS))}h`;
  if (since < WEEK_MS) return `${String(Math.floor(since / DAY_MS))}d`;
  return `${String(Math.floor(since / WEEK_MS))}w`;
}
