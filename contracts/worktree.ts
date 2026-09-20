// Every checkout of one imported repository — P3-T4, SPEC §5.1(a), BUILD-PLAN §3.
//
// The row P3-T3 shipped the map without, and said so: SPEC's table has `.claude/worktrees/*`
// (+ `git worktree list`) as worktrees-as-launch-targets, and it is the one reading in the map
// that is not about `.claude` at all. It is here rather than on `ProjectStatus` because a worktree
// is a place to start a session, which is what the map is a catalogue of.
//
// **Read off the filesystem, never spawned for.** `git worktree list --porcelain` answers this,
// and so does `<common>\worktrees\<name>\gitdir` — the file git itself reads to answer it.
// `ProjectGitReader` already takes the in-progress state that way and gives the reason: it is
// cheaper, and it is what makes it worktree-safe, because a spawn only ever answers about the
// directory it ran in. One `git worktree list` per imported project per panel open would be one
// process per repository to learn what four stats already know.
//
// **`lib/tree.mjs`'s distinction, kept whole.** That library exists because the tooling around it
// held four different answers to "which tree am I in?", and the conflation had teeth — a deny list
// that was a no-op inside every worktree, a state file written to the main branch by a worktree
// session, a gate receipt earned in one tree and banked in another. The distinction it draws is
// between the tree whose CODE is in question and the directory `.claude` is loaded from, and the
// half this task needs is the first: `isMain` is not cosmetic, it is the flag that stops the
// launcher (P4) offering the main checkout under a worktree's name.
//
// **A linked worktree is one whose git directory is not the common one.** `tree.mjs` asks git
// (`--absolute-git-dir` against `--git-common-dir`); the same fact is visible in the path, because
// git puts a linked worktree's directory at `<common>\worktrees\<name>` and nowhere else. That is
// a shape on disk rather than an inference: `GitDirectoryLocator` already follows the `.git` file
// that points at it, which is what its header means by "P3-T4 is built on exactly this".
//
// **The ports here are a prohibition, not an assignment.** `tree.mjs` also carries a port plan —
// 4200 for main, 4210-4213 for worktrees, and 4201 blacklisted because a past session read that
// port's 200 as its own app being up and then killed the process holding it. Flightdeck takes only
// the blacklist half. It does not serve these trees and has no business choosing ports for them,
// so there is nothing here to assign; what it must never do is probe, bind or kill 4200 and 4201
// (SEC-PROC-5, SPEC §9 R11). The constant is here, beside the worktrees it is about, so that P4's
// launcher has one place to consult rather than a sentence in a document to remember.
import { MAX_PROJECT_PATH_CHARS } from './project.ts';

/**
 * Ports core must never probe, bind or kill.
 *
 * 4200 is the neighbouring app's serve and 4201 is a different project of the owner's altogether.
 * Neither is Flightdeck's, and the rule is absolute rather than conditional: not "check whether it
 * answers", because checking is the thing that went wrong — a 200 from 4201 was read as a local
 * app being up, and the session then killed the PID holding it.
 */
export const NEVER_TOUCH_PORTS: readonly number[] = [4200, 4201];

/** Whether `port` is one core may not touch. See `NEVER_TOUCH_PORTS`. */
export function isNeverTouchPort(port: number): boolean {
  return NEVER_TOUCH_PORTS.includes(port);
}

/** `tree.mjs`'s `treeId` for the main checkout, and the reason `id` is not just a basename. */
export const MAIN_TREE_ID = 'main';

/** The directory a repository keeps its linked worktrees' administrative files in. */
export const WORKTREES_DIR = 'worktrees';

/**
 * A ref name is bounded, and this is not that bound.
 *
 * Long enough for any branch a person types and short enough that a `HEAD` somebody filled with a
 * megabyte of text is refused rather than drawn. The wire carries what core read; this is the
 * cap on what the deck will believe.
 */
export const MAX_BRANCH_CHARS = 255;

export interface Worktree {
  /**
   * `'main'`, or the tree directory's own name — `tree.mjs`'s `treeId`, unchanged.
   *
   * The directory name rather than the branch, because two worktrees can sit on the same branch
   * name in different repositories and because the name is what the owner typed when they created
   * it. It is also what every hook and script in the reference repository already keys its state
   * by, so a deck that showed something else would be showing a second vocabulary.
   */
  readonly id: string;
  /** The tree root — canonical, screened, and a folder core may read. */
  readonly path: string;
  /**
   * The checked-out branch, or `undefined` when the tree is on a detached HEAD.
   *
   * `undefined` rather than a sha: a detached HEAD has no name, and printing seven hex characters
   * where every other row has a branch would invite somebody to read it as one.
   */
  readonly branch: string | undefined;
  /**
   * Whether this is the main checkout rather than a linked worktree.
   *
   * Exactly one tree in a list has it. See the header on why it is not cosmetic.
   */
  readonly isMain: boolean;
}

/** One tree, from a `GET /projects/map` body. @throws never. */
export function parseWorktree(value: unknown): Worktree | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value));
  const id = bounded(fields['id'], MAX_BRANCH_CHARS);
  const path = bounded(fields['path'], MAX_PROJECT_PATH_CHARS);
  if (id === undefined || path === undefined) return undefined;
  return {
    id,
    path,
    // Anything that is not a usable branch name is a detached head, which is already a state this
    // type has. Inventing a second one for "the wire said something odd" would give the deck a
    // case to draw that means nothing to the person reading it.
    branch: bounded(fields['branch'], MAX_BRANCH_CHARS),
    isMain: fields['isMain'] === true,
  };
}

/** A non-empty string no longer than `maxChars`, or `undefined` for anything else. */
function bounded(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string' || value === '' || value.length > maxChars) return undefined;
  return value;
}

/**
 * Every tree, main first.
 *
 * Re-sorted here rather than trusted, for the reason `parseInstructionStack` rebuilds its order:
 * the ordering is a property of this build — the main checkout heads the list because it is the
 * one every other tree is linked from — and a wire that sent them in another order does not get to
 * change what the panel says. Within the linked trees the arrival order is kept, which is the
 * listing order of the administrative directory and so is stable and alphabetical.
 *
 * @throws never.
 */
export function parseWorktrees(value: unknown): readonly Worktree[] {
  if (!Array.isArray(value)) return [];
  const trees: Worktree[] = [];
  for (const entry of value) {
    const tree = parseWorktree(entry);
    if (tree !== undefined) trees.push(tree);
  }
  return [...trees.filter((tree) => tree.isMain), ...trees.filter((tree) => !tree.isMain)];
}

/**
 * The branch named by a `HEAD` file, or `undefined` for a detached one.
 *
 * `HEAD` is one line: `ref: refs/heads/<branch>` for an attached head, or a bare object id for a
 * detached one. The prefix is required rather than stripped optimistically — a 40-character sha
 * would otherwise become a "branch" named after itself, which is precisely the detached case this
 * returns `undefined` for.
 */
export function branchOfHead(text: string | undefined): string | undefined {
  const first = (text ?? '').split('\n')[0]?.trim() ?? '';
  const prefix = 'ref: refs/heads/';
  if (!first.startsWith(prefix)) return undefined;
  const branch = first.slice(prefix.length).trim();
  return branch === '' || branch.length > MAX_BRANCH_CHARS ? undefined : branch;
}
