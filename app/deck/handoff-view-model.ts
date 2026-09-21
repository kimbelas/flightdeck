// What the handoff control on an expanded row offers — P6-T6, SPEC §6(8).
//
// A leaf `.ts` for G.53's reason: it reaches `contracts/` and nothing else under `app/`, so a unit
// test of it does not drag the DOM project's files into the one without a DOM.
//
// **The targets are the worktrees the deck already knows about** (P3-T4, on the workflow map).
// Nothing is fetched and nothing is invented: a handoff into a tree that does not exist would be
// refused by `resolveDirectory` anyway, and offering one would be offering a button that 400s.
//
// **The tree the session is ALREADY in is not offered.** Forking a conversation into the folder it
// is already working in is not a handoff — it is a second session competing for the same files,
// which is the thing P6-T5 warns about one task earlier.
import type { HandoffFailure } from '../../contracts/launch-reply.ts';
import { canonicalWindowsPath } from '../../contracts/windows-path.ts';
import type { Worktree } from '../../contracts/worktree.ts';

/** One place a session can be handed to. */
export interface HandoffTarget {
  /** The worktree's directory name — what the owner called it (`Worktree.id`). */
  readonly id: string;
  readonly path: string;
  /** `spike · feat/parser`, or just the name — see `labelOf`. */
  readonly label: string;
}

export interface HandoffOffer {
  readonly targets: readonly HandoffTarget[];
  /** Why there is nothing to offer, or `undefined` when there is. Shown instead of the control. */
  readonly nothingBecause: string | undefined;
  /** What to prefill the name box with, so the fork is never nameless. */
  readonly suggestedName: string;
}

/**
 * How long a name may get before it stops being readable in a row. `-n`'s own cap.
 *
 * Exported because the box somebody types into must not let them past a length core will refuse:
 * `HandoffRoute` caps the body at the same 80, and a field that accepted 81 would turn a typo into
 * a round trip and a `bad_name`.
 */
export const MAX_HANDOFF_NAME_CHARS = 80;

/**
 * What this row can be handed to.
 *
 * @param worktrees every tree in the session's project, as the workflow map reported them, or
 * `undefined` when the session is in no imported project at all. The three are different answers
 * and `reasonFor` says so — see its header.
 * @param cwd where the session is running now — excluded from the targets, see the header.
 * @param name the session's name, which the suggestion is built from.
 */
export function handoffOffer(
  worktrees: readonly Worktree[] | undefined,
  cwd: string,
  name: string,
): HandoffOffer {
  const here = canonicalWindowsPath(cwd);
  const targets = (worktrees ?? [])
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
 * THREE different silences, and telling them apart is the whole value of this function. A session
 * in no imported project has no worktrees to read, and the fix is an import — most sessions on
 * this machine are in folders nobody has imported (`ProjectScope`), so this is the ordinary
 * answer rather than an edge case. A project whose worktrees have not been read yet has an answer
 * that simply has not arrived. A project with one tree has nowhere to hand a session TO. One
 * sentence for all three would tell somebody to go and make a worktree they already have.
 */
function reasonFor(
  worktrees: readonly Worktree[] | undefined,
  targets: readonly HandoffTarget[],
): string | undefined {
  if (worktrees === undefined) {
    return 'This session is not in an imported project, so its worktrees are unknown.';
  }
  if (worktrees.length === 0) return 'No worktrees read for this project yet.';
  if (targets.length === 0) return 'This is the only worktree — there is nowhere to hand it to.';
  return undefined;
}

/**
 * `spike · feat/parser`, or just the name.
 *
 * The branch is shown because it is what somebody is choosing between — and it is NOT shown when
 * it repeats the tree's own name, which is the habit `WorkflowMapViewModel` already set on the
 * projects panel. A worktree is usually made for a ticket and checked out on a branch named after
 * the same ticket, so `XWEB-1853 · XWEB-1853` is the common case and says nothing twice.
 */
function labelOf(tree: Worktree): string {
  if (tree.branch === undefined || tree.branch === tree.id) return tree.id;
  return `${tree.id} · ${tree.branch}`;
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
  return `${base}-fork`.slice(0, MAX_HANDOFF_NAME_CHARS);
}

/**
 * One line per refusal, exhaustive over the union by construction — `groupBannerLine`'s `Record`.
 *
 * Turning core's codes into English is a decision and it lives here rather than in the component,
 * for the reason core answers with a closed union in the first place: nothing on screen was
 * composed from what the request contained, and the wording belongs where the reader is.
 *
 * **`bad_cwd` names the fix rather than the fault.** The targets in this control come from the
 * worktrees the deck was told about, so a refused folder means the reading is older than the disk
 * — somebody removed the tree — and "refresh" is the only thing to do about it.
 */
const REFUSALS: Readonly<Record<HandoffFailure, string>> = {
  no_claude: 'Claude Code could not be found for that account.',
  bad_session: 'That session is not one core can fork.',
  bad_cwd: 'That folder is gone or is not one core may write in. Refresh and look again.',
  bad_name: 'That name is not one a session can be given.',
  handoff_failed: 'Claude Code refused the fork. The original session is untouched.',
  no_session_id: 'The fork started but did not say what it was called. Refresh to find it.',
};

/**
 * What to say about a refused handoff.
 *
 * Every sentence ends with what is true of the ORIGINAL, because that is the question a refusal
 * raises: this is the one verb in the deck that adds a session, and somebody who has just been
 * told "no" needs to know they have not also lost the one they pressed on.
 */
export function handoffRefusalLine(failure: HandoffFailure): string {
  return REFUSALS[failure];
}
