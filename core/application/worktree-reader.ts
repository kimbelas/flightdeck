// Every checkout of one imported repository — P3-T4, SPEC §5.1(a), the map's last git row.
//
// `GitDirectoryLocator`'s header promised this: "`.git` is a FILE containing `gitdir: <path>` — a
// linked worktree … P3-T4 is built on exactly this." The locator walks one direction, from a
// project to the git directory it belongs to. This walks the other: from that git directory to
// every tree registered against it.
//
// **No spawn, for `ProjectGitReader`'s reason.** `git worktree list --porcelain` reads
// `<common>\worktrees\<name>\gitdir` and prints what it found there; so does this. The in-progress
// state set the precedent and gave the argument — reading the administrative files is cheaper than
// a process, and it is what makes the answer worktree-safe, because a spawn only ever answers
// about the directory it ran in. Four projects on a panel would otherwise be four `git` processes
// to learn something that almost never changes.
//
// **The common directory is found by shape, not by asking.** `tree.mjs` compares
// `--absolute-git-dir` against `--git-common-dir` and calls them different a linked worktree. The
// same fact is on disk: git puts a linked worktree's directory at `<common>\worktrees\<name>` and
// nowhere else, so a git directory whose parent is named `worktrees` IS a linked worktree's, and
// its grandparent is the common one. Two string operations against two spawns.
//
// **Every path goes back through the registry.** The `gitdir` files name folders this class has
// never screened and that the imported repository's own contents chose — exactly the position
// `GitDirectoryLocator.followPointer` is in, and the same answer: compose, then re-resolve
// (SEC-FS-1). A tree outside every imported root is dropped rather than listed, because the map is
// a catalogue of places a session can be started and core cannot start one where it may not read.
//
// **A tree is screened through BOTH doors, and that is not belt-and-braces.** `resolve` answers
// whether a file may be opened and refuses a project root outright; `resolveRoot` answers whether
// a directory is still an imported project. A tree can be either — the main checkout is usually an
// imported project (`resolveRoot`), and a worktree under `.claude\worktrees` is a directory inside
// one (`resolve`) — so asking only one of them drops half the real cases. This was shipped asking
// only `resolve`, and every main checkout on the machine vanished behind
// `the project directory itself is not a file`: G.26's distinction, met for the third time
// (RESEARCH.md G.28).
//
// **A dropped tree is logged, not reported.** `git worktree list` calls a registration whose tree
// is gone "prunable" and still prints it. This does not: a stale administrative directory is the
// repository's housekeeping rather than the owner's, and a launcher row that cannot be launched is
// worse than an absent one. The warning is there for the case where it is a screening refusal
// instead, which is the one worth knowing about.
import { childPath, lastSegment, parentDirectory } from '../../contracts/windows-path.ts';
import {
  branchOfHead,
  MAIN_TREE_ID,
  WORKTREES_DIR,
  type Worktree,
} from '../../contracts/worktree.ts';
import type { Logger } from '../ports/logger.ts';
import type { ProjectFiles } from '../ports/project-files.ts';
import type { Result } from '../shared/result.ts';
import type { GitDirectoryLocator, ProjectPaths } from './git-directory-locator.ts';

/**
 * How many registrations to read.
 *
 * The reference repository has five on disk and four of them are abandoned, which is the realistic
 * top end. The cap is here because `list` takes one and a directory is a thing another process
 * writes into, not because a repository with more would be wrong.
 */
const MAX_WORKTREES = 64;

/** `HEAD` and `gitdir` are one line each. Enough for a long path, nothing like a real file. */
const MAX_ADMIN_BYTES = 4096;

/** The two administrative files git writes per registration. */
const GITDIR_FILE = 'gitdir';
const HEAD_FILE = 'HEAD';

/**
 * The registry's OTHER door, narrowed to the one method.
 *
 * `ProjectPaths.resolve` cannot answer for a directory that is itself an imported project, which
 * is what a main checkout usually is. See the header on why both are needed.
 */
export interface ProjectRoots {
  resolveRoot(path: string): Promise<Result<string, string>>;
}

export interface WorktreeParts {
  readonly paths: ProjectPaths;
  readonly roots: ProjectRoots;
  readonly locator: GitDirectoryLocator;
  readonly files: ProjectFiles;
  readonly logger: Logger;
}

export class WorktreeReader {
  private readonly parts: WorktreeParts;

  constructor(parts: WorktreeParts) {
    this.parts = parts;
  }

  /**
   * Every tree of the repository this folder belongs to, main first.
   *
   * @param projectPath the stored, canonical project root. It may itself be a linked worktree —
   * importing one is a reasonable thing to do — and the answer is the same list either way,
   * because both trees are registered against one common directory.
   * @returns `[]` for a folder that is not in a repository, and for one whose repository lies
   * outside every imported root. The panel draws the same nothing for both (`ProjectStatus.git`
   * gives the reasoning for not distinguishing them on screen).
   */
  public async read(projectPath: string): Promise<readonly Worktree[]> {
    const common = await this.commonDir(projectPath);
    if (common === undefined) return [];
    const root = parentDirectory(common);
    if (root === undefined) return [];
    const [main, linked] = await Promise.all([this.mainTree(root, common), this.linked(common)]);
    return main === undefined ? linked : [main, ...linked];
  }

  /**
   * The cheap observation that proves the list has not moved, for `WorkflowMapReader`'s cache.
   *
   * `mtime(<common>\worktrees)` — adding or removing a registration writes into that directory, so
   * it is the one stat that covers both. A checkout inside an existing tree moves its `HEAD` and
   * not this, which is what the map's TTL is for.
   *
   * `''` for a repository with no worktrees at all, which `SignatureCache` documents as "there is
   * nothing cheap to observe". The consequence is stated rather than hidden: a repository's FIRST
   * worktree shows up within the TTL rather than at once. The alternative was to fall back to the
   * common directory's own mtime, which every commit moves — and that would tie the map's
   * recompute rate, roughly thirty reads, to how often the owner commits.
   */
  public async signature(projectPath: string): Promise<string> {
    const common = await this.commonDir(projectPath);
    if (common === undefined) return '';
    const facts = await this.facts(childPath(common, WORKTREES_DIR));
    return facts === undefined ? '' : String(facts.modifiedAt);
  }

  /**
   * The shared git directory, from anywhere in the repository — `tree.mjs`'s `--git-common-dir`.
   *
   * See the header on why this is a shape rather than a question. `undefined` when there is no
   * repository, and when there is one whose git directory core may not read.
   */
  private async commonDir(projectPath: string): Promise<string | undefined> {
    const gitDir = (await this.parts.locator.locate(projectPath))?.gitDir;
    if (gitDir === undefined) return undefined;
    const parent = parentDirectory(gitDir);
    if (parent === undefined) return gitDir;
    const isRegistration = (lastSegment(parent) ?? '').toLowerCase() === WORKTREES_DIR;
    return isRegistration ? parentDirectory(parent) : gitDir;
  }

  /**
   * The main checkout — the folder the common directory sits in.
   *
   * `undefined` when core may not read it, which is the linked-worktree-imported-alone case: the
   * tree the owner imported is listed below, and the main checkout is not, because it is not a
   * place this build may start a session.
   */
  private async mainTree(root: string, common: string): Promise<Worktree | undefined> {
    const path = await this.treePath(root);
    if (path === undefined) {
      this.parts.logger.warn('worktree_main_refused', { root: lastSegment(root) ?? '' });
      return undefined;
    }
    return {
      id: MAIN_TREE_ID,
      path,
      branch: branchOfHead(await this.text(childPath(common, HEAD_FILE))),
      isMain: true,
    };
  }

  /**
   * A tree's canonical path, or `undefined` when core may not read it.
   *
   * Both doors, root first: a main checkout is usually an imported project, and `resolve` refuses
   * one outright. See the header — this is G.26's distinction, and asking only one door is the bug
   * this method exists to stop anybody writing again.
   */
  private async treePath(path: string): Promise<string | undefined> {
    const asRoot = await this.parts.roots.resolveRoot(path);
    if (asRoot.ok) return asRoot.value;
    const inside = await this.parts.paths.resolve(path);
    return inside.ok ? inside.value : undefined;
  }

  /** Every registration under `<common>\worktrees`, in the directory's own order. */
  private async linked(common: string): Promise<readonly Worktree[]> {
    const resolved = await this.parts.paths.resolve(childPath(common, WORKTREES_DIR));
    // A repository with no linked worktrees has no such directory. Ordinary, not a failure.
    if (!resolved.ok) return [];
    const names = await this.parts.files.list(resolved.value, MAX_WORKTREES);
    const trees = await Promise.all(names.map((name) => this.linkedTree(resolved.value, name)));
    return trees.filter((tree): tree is Worktree => tree !== undefined);
  }

  /**
   * One registration: where its tree is, and what that tree has checked out.
   *
   * @param name the registration's directory name. It is git's admin name and usually the tree's
   * own, but `id` is taken from the resolved path instead — that is `tree.mjs`'s `treeId`, and a
   * tree that was moved after it was created has the two disagree.
   */
  private async linkedTree(worktreesDir: string, name: string): Promise<Worktree | undefined> {
    const admin = childPath(worktreesDir, name);
    // `<tree>\.git` — the pointer back, written absolute by `git worktree add`.
    const pointer = firstLine(await this.text(childPath(admin, GITDIR_FILE)));
    const target = pointer === undefined ? undefined : parentDirectory(pointer);
    const treePath = target === undefined ? undefined : await this.treePath(target);
    if (treePath === undefined) {
      // Prunable, or outside every imported root. See the header on why neither is listed.
      this.parts.logger.warn('worktree_dropped', { name });
      return undefined;
    }
    return {
      id: lastSegment(treePath) ?? name,
      path: treePath,
      branch: branchOfHead(await this.text(childPath(admin, HEAD_FILE))),
      isMain: false,
    };
  }

  /** A small file through the one door. `undefined` for absent, unreadable and refused alike. */
  private async text(path: string): Promise<string | undefined> {
    const resolved = await this.parts.paths.resolve(path);
    if (!resolved.ok) return undefined;
    return this.parts.files.read(resolved.value, MAX_ADMIN_BYTES);
  }

  private async facts(path: string): Promise<{ readonly modifiedAt: number } | undefined> {
    const resolved = await this.parts.paths.resolve(path);
    if (!resolved.ok) return undefined;
    return this.parts.files.facts(resolved.value);
  }
}

/** The first line with something on it, or `undefined` — `gitdir` holds one and nothing else. */
function firstLine(text: string | undefined): string | undefined {
  const first = (text ?? '').split('\n')[0]?.trim() ?? '';
  return first === '' ? undefined : first;
}
