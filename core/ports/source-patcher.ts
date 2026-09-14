// Something that splices a marked region into a source file and takes it back out (P1-T11).
//
// A port because the only implementation lives in `scripts/` — `StatuslinePatcher` was written for
// the P0-T5 spike and stayed, since the block it inserts is maintained as real Python next to it
// (scripts/statusline-block.py). `ConnectPlanner` may not import from `scripts/`: the dependency
// rule points inward (CODING-STANDARDS §2), and an application service that knew where a spike
// harness lives would be the first crack in it.
//
// It is also what lets `connect-planner.test.ts` drive a patcher that refuses, which is the branch
// that matters most here and the hardest one to arrange with the real file.

/** Reported, never thrown — a refusal is the right answer when an anchor has moved (F.3.7). */
export type PatchOutcome =
  { readonly ok: true; readonly source: string } | { readonly ok: false; readonly reason: string };

export interface SourcePatcher {
  /** True if this patcher's region is already present. Cheap; it does not validate the rest. */
  isApplied(source: string): boolean;

  /** The patched source, or why it will not be attempted. */
  apply(source: string): PatchOutcome;

  /** The source with exactly the inserted region removed. `remove(apply(x))` is `x`. */
  remove(source: string): PatchOutcome;
}
