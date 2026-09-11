// "Something under the directories I watch has changed" — and nothing more than that.
//
// **A nudge, never the truth** (SPEC R7, DECISIONS.md D3 feed 5). Node's `fs.watch` is
// `ReadDirectoryChangesW` on Windows, which drops events under bursty writes and behaves
// inconsistently across junctions (RESEARCH.md E.5). Anything that believed it would miss
// sessions; the reconciler's sweep is what actually decides, and this only makes it early.
//
// The callback therefore carries no payload. Which file changed is information this cannot be
// trusted to have, and offering it would invite a caller to act on it.
//
// Which directories are watched is the adapter's business, not the caller's — they are derived
// from the config dirs and are the kind of path SEC-FS-1 keeps out of anyone else's hands.
import type { Cancellation } from './cancellation.ts';

export interface DirectoryWatcher {
  /**
   * Calls `onChange` when something may have changed. May fire in bursts, may fire spuriously,
   * and may miss a change entirely — every caller must be correct under all three.
   *
   * @throws never. A directory that does not exist yet is an ordinary state: a subscription with
   * no background sessions has no `jobs/` until the first one runs.
   */
  watch(onChange: () => void): Cancellation;
}
