// Something that splices a marked region into a source file and takes it back out (P1-T11).
//
// A port for the ordinary reason — `ConnectPlanner` is an application service and may not know
// that the thing splicing a region into a Python file reads that region off the disk at all.
//
// The implementation is `core/adapters/statusline/statusline-patcher.ts`, and it lived in
// `scripts/` until P4-T6, which is the history this header used to record: it was written for the
// P0-T5 spike and stayed there, with the block it inserts maintained as real Python beside it.
// What ended that was core needing to construct one for `/connect` — `main.ts` importing from
// `scripts/` is the dependency rule backwards, so the adapter moved inward instead.
//
// The port is also what lets `connect-planner.test.ts` drive a patcher that refuses, which is the
// branch that matters most here and the hardest one to arrange with the real file.

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
