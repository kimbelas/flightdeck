// Two live sessions in one working tree, on two different accounts — P6-T5, SPEC §5.6.
//
// SPEC's line is four words: *"Duplicate warning: same cwd under both subscriptions."* What makes
// it worth a warning is that **nothing else on the machine can see it.** `claude agents` reads one
// config directory, so each account's listing shows its own session in `C:\repo` and neither
// mentions the other. Flightdeck is the only thing looking at both, which is why this check exists
// here rather than being left to the CLI.
//
// **The hazard is a shared working tree, not a shared name.** Two sessions editing the same files
// take turns clobbering each other, and `git status` stops meaning anything. That is a different
// kind of wrong from anything `deriveFlags` reports: every flag there is a fact about ONE session,
// and this one is only true of a PAIR. It is computed over the set for that reason, and it is not
// a `SessionFlag`.
//
// **Same subscription is deliberately NOT warned about, and that is SPEC's scoping rather than an
// omission.** An orchestrator and a ticket session in the same repository on one account is a
// normal day (`claude-isg-orch` and `claude-isg-ticket` are two of the four built-in presets, and
// both default to the project root). Warning about it would be warning about the product working.
// Across accounts it is almost always an accident — the same folder opened on the other
// subscription because the first was out of quota, and then forgotten.
//
// **Live only.** A finished session holds no files open and is editing nothing; a warning about
// one would be a warning about history. This is the `needsAttention` lesson again (G.24): a row's
// `runState` is the last state it was SEEN in, so anything that reads as a hazard has to check
// that the session is still running.
import { canonicalWindowsPath } from './windows-path.ts';
import type { SessionRow } from './session-row.ts';

/**
 * The folders that have a live session on BOTH subscriptions, as canonical path keys.
 *
 * A `Set` rather than a list of pairs, because every caller asks the same question — "is this row
 * one of them?" — and a pair list would make each of them do the join again.
 *
 * Canonicalised, because Windows paths are compared case-insensitively and a trailing separator is
 * not a different folder: `C:\Repo` and `c:\repo\` are one working tree, and a warning that missed
 * them would miss the most likely way for this to happen — the two sessions were started from two
 * different places.
 */
export function duplicateCwdKeys(rows: readonly SessionRow[]): ReadonlySet<string> {
  const seen = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.live || row.cwd === '') continue;
    const key = canonicalWindowsPath(row.cwd);
    const subscriptions = seen.get(key) ?? new Set<string>();
    subscriptions.add(row.subscription);
    seen.set(key, subscriptions);
  }
  const duplicates = new Set<string>();
  for (const [key, subscriptions] of seen) {
    if (subscriptions.size > 1) duplicates.add(key);
  }
  return duplicates;
}

/**
 * Whether this row is one of the sessions sharing a working tree.
 *
 * Takes the set rather than the rows, so a list of forty asks the question forty times against one
 * answer instead of computing it forty times.
 */
export function sharesCwd(row: SessionRow, duplicates: ReadonlySet<string>): boolean {
  if (!row.live || row.cwd === '') return false;
  return duplicates.has(canonicalWindowsPath(row.cwd));
}

/**
 * What to say about it.
 *
 * One sentence, here rather than in the component, for `PresetsViewModel`'s reason: what a warning
 * MEANS is a decision, and the reader is in the deck. It names the other account rather than
 * saying "both", because the useful half is which other window to go and look in.
 */
export function sharedCwdWarning(row: SessionRow): string {
  const other = row.subscription === '365' ? 'isg' : '365';
  return `Also running on ${other} in this folder — two sessions editing one working tree.`;
}
