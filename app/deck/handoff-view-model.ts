// What the handoff control on an expanded row offers — P6-T6, SPEC §6(8).
//
// A leaf `.ts` for G.53's reason: it reaches `contracts/` and nothing else under `app/`, so a unit
// test of it does not drag the DOM project's files into the one without a DOM.
//
// **The targets are the worktrees the deck already knows about** (P3-T4, on the project status).
// Nothing is fetched and nothing is invented: a handoff into a tree that does not exist would be
// refused by `resolveDirectory` anyway, and offering one would be offering a button that 400s.
//
// **The tree the session is ALREADY in is not offered.** Forking a conversation into the folder it
// is already working in is not a handoff — it is a second session competing for the same files,
// which is the thing P6-T5 warns about one task earlier.
import { canonicalWindowsPath } from '../../contracts/windows-path.ts';
import type { Worktree } from '../../contracts/worktree.ts';

/** One place a session can be handed to. */
export interface HandoffTarget {
  /** The worktree's directory name — what the owner called it (`Worktree.id`). */
  readonly id: string;
  readonly path: string;
  /** `spike · feat/parser`, or just the name on a detached HEAD. */
  readonly label: string;
}

export interface HandoffOffer {
  readonly targets: readonly HandoffTarget[];
  /** Why there is nothing to offer, or `undefined` when there is. Shown instead of the control. */
  readonly nothingBecause: string | undefined;
  /** What to prefill the name box with, so the fork is never nameless. */
  readonly suggestedName: string;
}

/** How long a suggested name may get before it stops being readable in a row. `-n`'s own cap. */
const MAX_NAME_CHARS = 80;

/**
 * What this row can be handed to.
 *
 * @param worktrees every tree in the session's project, as the project status reported them.
 * @param cwd where the session is running now — excluded from the targets, see the header.
 * @param name the session's name, which the suggestion is built from.
 */
export function handoffOffer(
  worktrees: readonly Worktree[],
  cwd: string,
  name: string,
): HandoffOffer {
  const here = canonicalWindowsPath(cwd);
  const targets = worktrees
    .filter((tree) => canonicalWindowsPath(tree.path) !== here)
    .map((tree) => ({ id: tree.id, path: tree.path, label: labelOf(tree) }));
  return {
    targets,
    nothingBecause: reasonFor(worktrees, targets),
    suggestedName: suggestedName(name),
  };
}

/**
 * Why the control is not offered.
 *
 * Two different silences, and telling them apart is the whole value of this function: a project
 * with one tree has nowhere to hand a session TO, and a project whose worktrees have not been read
 * yet has an answer that simply has not arrived. Drawing the same sentence for both would tell
 * somebody to go and make a worktree they already have.
 */
function reasonFor(
  worktrees: readonly Worktree[],
  targets: readonly HandoffTarget[],
): string | undefined {
  if (worktrees.length === 0) return 'No worktrees read for this project yet.';
  if (targets.length === 0) return 'This is the only worktree — there is nowhere to hand it to.';
  return undefined;
}

/** `spike · feat/parser`. The branch is shown because it is what somebody is choosing between. */
function labelOf(tree: Worktree): string {
  return tree.branch === undefined ? tree.id : `${tree.id} · ${tree.branch}`;
}

/**
 * A name for the fork, prefilled rather than required.
 *
 * Suffixed rather than reused, because `-n` will happily give two live sessions the same name and
 * the deck would then show two identical rows (G.54). The owner types over it; the point is that
 * pressing straight through cannot produce a nameless or duplicate session.
 */
function suggestedName(name: string): string {
  const base = name.trim() === '' ? 'handoff' : name.trim();
  return `${base}-fork`.slice(0, MAX_NAME_CHARS);
}
