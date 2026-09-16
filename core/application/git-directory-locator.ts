// Where a project's git directory is — P3-T2, SEC-FS-1, and the walk P3-T4 needs too.
//
// This is `statusline.py`'s `git_dir()` with one thing added and one thing taken away. What is
// added is the screen: every candidate goes through `ProjectRegistry.resolve`, so the walk cannot
// read a `.git` outside the folders the owner imported. What is taken away is nothing — the two
// cases that function handles are both here, because both are real on this machine:
//
// - **`.git` is a directory.** The ordinary repository. Its `HEAD` and `index` are the cache
//   signature, and its `MERGE_HEAD`, `rebase-merge` and friends are the in-progress state, read
//   with no spawn at all.
// - **`.git` is a FILE containing `gitdir: <path>`.** A linked worktree. That is what
//   `git worktree add` writes, measured on this machine — a single line whose target is
//   `<main>\.git\worktrees\<name>`, spelled with FORWARD slashes. P3-T4 is built on exactly this.
//
// **The walk climbs, because the imported folder need not be the repository root.** Importing
// `repo\packages\app` is a reasonable thing to do and its `.git` is two levels up.
//
// **A refusal is not a stop.** Every candidate is resolved and screened independently, so climbing
// past a folder core may not read costs a `realpath` and finds nothing — it cannot read anything.
// Stopping at the first refusal would be a shortcut that quietly breaks the case where a parent
// directory is itself an imported project, which is the normal shape of a monorepo plus a
// worktree.
//
// **The answer distinguishes "no repository" from "a repository core may not read".** A linked
// worktree imported without its main repository is the second: there is a branch and a dirty count
// to be had from `git` itself, but no git directory to stat, so no signature and no in-progress
// state. `ProjectGitReader` degrades to the TTL alone rather than pretending there is nothing here.
import { childPath, parentDirectory } from '../../contracts/windows-path.ts';
import type { Logger } from '../ports/logger.ts';
import type { ProjectFiles } from '../ports/project-files.ts';
import type { Result } from '../shared/result.ts';

/**
 * The one door into a project folder, narrowed to the method that is it.
 *
 * An interface rather than `ProjectRegistry` itself, for the reason every port in core is one:
 * proving that this walk never reads outside an imported root should not require a store, a clock,
 * an audit log and a path canonicaliser.
 */
export interface ProjectPaths {
  /** Canonicalises with `realpath`, then screens the result — SEC-FS-1, all four checks. */
  resolve(path: string): Promise<Result<string, string>>;
}

export interface GitLocation {
  /**
   * The git directory, when core may read it — `undefined` for a repository whose git directory
   * lies outside every imported root. See the header.
   */
  readonly gitDir: string | undefined;
}

/**
 * How far up to climb before giving up.
 *
 * `parentDirectory` terminates at both kinds of root on its own, so this is a guard against a path
 * shape nobody has thought of rather than the stopping rule. Deep enough for any real repository.
 */
const MAX_CLIMB = 64;

/** A `.git` file is one line. Enough for a long worktree path and nothing like a real file. */
const MAX_POINTER_BYTES = 4096;

const POINTER = 'gitdir:';

export class GitDirectoryLocator {
  private readonly paths: ProjectPaths;
  private readonly files: ProjectFiles;
  private readonly logger: Logger;

  constructor(paths: ProjectPaths, files: ProjectFiles, logger: Logger) {
    this.paths = paths;
    this.files = files;
    this.logger = logger;
  }

  /**
   * The git directory for one imported folder, or `undefined` when there is no repository.
   *
   * @param projectPath the stored, canonical project root. Climbed from, never composed onto
   * without going back through `resolve`.
   */
  public async locate(projectPath: string): Promise<GitLocation | undefined> {
    let directory: string | undefined = projectPath;
    for (let climbed = 0; climbed < MAX_CLIMB && directory !== undefined; climbed += 1) {
      const found = await this.at(directory);
      if (found !== undefined) return found;
      directory = parentDirectory(directory);
    }
    return undefined;
  }

  /** `<directory>\.git`, resolved and screened, or `undefined` if there is nothing usable there. */
  private async at(directory: string): Promise<GitLocation | undefined> {
    const resolved = await this.paths.resolve(childPath(directory, '.git'));
    // Missing and refused are one answer on purpose — see the header on why the walk continues.
    if (!resolved.ok) return undefined;
    const facts = await this.files.facts(resolved.value);
    if (facts === undefined) return undefined;
    if (facts.isDirectory) return { gitDir: resolved.value };
    return this.followPointer(directory, resolved.value);
  }

  /**
   * A `.git` that is a file — a linked worktree.
   *
   * @param directory the folder the pointer was found in. A relative target is relative to THAT,
   * not to the process's working directory, which is why it is passed rather than derived.
   */
  private async followPointer(directory: string, pointer: string): Promise<GitLocation> {
    const text = await this.files.read(pointer, MAX_POINTER_BYTES);
    const target = targetOf(text);
    if (target === undefined) {
      this.logger.warn('git_pointer_unreadable', { bytes: text?.length ?? 0 });
      return { gitDir: undefined };
    }
    // Composed and then re-resolved, exactly like the candidate above: the target names a folder
    // this class has never screened, and it is the one path here that an imported repository's own
    // contents can choose.
    const absolute = isAbsolute(target) ? target : childPath(directory, target);
    const resolved = await this.paths.resolve(absolute);
    // A worktree whose main repository was not imported. There is a repository; core may not read
    // its git directory. Both halves of that are said by `gitDir: undefined` on a location that
    // exists — see the header.
    return { gitDir: resolved.ok ? resolved.value : undefined };
  }
}

/** `C:\…`, `\\server\share\…`, or the extended forms — `ProjectImport`'s rule, same shapes. */
function isAbsolute(path: string): boolean {
  return /^(?:[a-z]:[\\/]|\\\\)/i.test(path);
}

/**
 * The path out of `gitdir: <path>`, or `undefined` for anything else.
 *
 * The first line only. `git worktree add` writes one line and nothing else, and a file with more
 * in it is not one this build knows how to read — guessing at the rest would be inventing a format.
 */
function targetOf(text: string | undefined): string | undefined {
  const first = (text ?? '').split('\n')[0]?.trim() ?? '';
  if (!first.startsWith(POINTER)) return undefined;
  const target = first.slice(POINTER.length).trim();
  return target === '' ? undefined : target;
}
