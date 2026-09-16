// Branch, dirty, ahead/behind for one imported project — P3-T2, SPEC §5.1.
//
// **One spawn, and usually not even that.** `statusline.py` has run this exact shape on every
// status line render for months and the shape is the design: `git status --porcelain=v2 --branch
// -uno` answers branch, divergence, dirty and conflicts together, and the result is held until the
// git directory's mtimes move or four seconds pass (`SignatureCache`). A panel that re-ran `git`
// on every redraw would be spawning a process to learn that nothing had happened.
//
// **The in-progress state costs no spawn at all.** Mid-merge, mid-rebase, mid-bisect is the
// presence of a file in the git directory, and `statusline.py` reads it exactly that way. That is
// not only cheaper — it is what makes it worktree-safe, because a linked worktree has its own
// `rebase-merge` under `<main>\.git\worktrees\<name>` and a command run in the wrong directory
// would answer about the wrong tree.
//
// **`git -C <root>` rather than a working directory.** `ProcessRunner` has no `cwd` and does not
// grow one for this: `-C` is an argv element like any other, so SEC-PROC-1's "an array, always"
// still covers the whole invocation and the port stays as it is. `ExecFileProcessRunner` already
// passes `windowsHide: true`, which is the same problem `statusline.py` solves with
// `CREATE_NO_WINDOW` — without it every refresh flashes a console window on the owner's desktop.
//
// **`git` is looked up on `PATH`, not located like `claude.exe`.** `ClaudeInstall` exists because
// Claude Code installs itself somewhere unpredictable and core has to attach to the SAME one the
// listing came from. Git is a machine-wide tool with one answer, `execFile` resolves it through
// `PATHEXT` on Windows (measured), and a machine without git on `PATH` answers `undefined` — which
// is the same answer as a folder that is not a repository, and draws the same nothing.
import type { GitCounts, GitProgress, GitStatus } from '../../contracts/git-status.ts';
import { parseGitPorcelain } from '../../contracts/git-status.ts';
import { projectKey } from '../../contracts/project.ts';
import { childPath } from '../../contracts/windows-path.ts';
import type { Clock } from '../ports/clock.ts';
import type { Logger } from '../ports/logger.ts';
import type { ProcessRunner } from '../ports/process-runner.ts';
import type { ProjectFiles } from '../ports/project-files.ts';
import type { GitDirectoryLocator, ProjectPaths } from './git-directory-locator.ts';
import { SignatureCache } from './signature-cache.ts';

/** `statusline.py`'s number for this cache, and for the same reader: a person watching a panel. */
const GIT_TTL_MS = 4000;

/** `statusline.py` allows 2 s. A `git status` that has not answered by then is not going to help. */
const GIT_TIMEOUT_MS = 2000;

/**
 * The one invocation, spelled once.
 *
 * `-uno` excludes untracked files deliberately: it is what keeps "dirty" meaning "there is work
 * here" rather than "there are files here", and it is also what stops git walking a `node_modules`
 * nobody ignored (contracts/git-status.ts).
 */
const STATUS_ARGS: readonly string[] = ['status', '--porcelain=v2', '--branch', '-uno'];

/**
 * The two files whose mtimes prove nothing has happened.
 *
 * `HEAD` moves on a commit, a checkout and a rebase step; `index` moves on a stage, an unstage and
 * a merge. Between them they cover everything except an unsaved edit to a tracked file, which is
 * what the TTL is for (`SignatureCache`).
 */
const SIGNATURE_FILES: readonly string[] = ['HEAD', 'index'];

/**
 * Marker file to state, in the order `statusline.py` checks them.
 *
 * Order matters where two can be present: a cherry-pick that stopped on a conflict leaves both
 * `CHERRY_PICK_HEAD` and a dirty index, and the specific answer is the useful one. `rebase-merge`
 * and `rebase-apply` are the two rebase back-ends and say the same thing.
 */
const PROGRESS_MARKERS: readonly { readonly file: string; readonly progress: GitProgress }[] = [
  { file: 'MERGE_HEAD', progress: 'merging' },
  { file: 'CHERRY_PICK_HEAD', progress: 'cherry-picking' },
  { file: 'REVERT_HEAD', progress: 'reverting' },
  { file: 'rebase-merge', progress: 'rebasing' },
  { file: 'rebase-apply', progress: 'rebasing' },
  { file: 'BISECT_LOG', progress: 'bisecting' },
];

export interface ProjectGitParts {
  readonly paths: ProjectPaths;
  readonly locator: GitDirectoryLocator;
  readonly files: ProjectFiles;
  readonly runner: ProcessRunner;
  readonly clock: Clock;
  readonly logger: Logger;
}

export class ProjectGitReader {
  private readonly parts: ProjectGitParts;
  private readonly readings: SignatureCache<GitStatus | undefined>;

  /**
   * The cache is constructed here rather than injected, and that is not a lapse of R3: it is this
   * class's memory rather than a collaborator with a policy of its own, and one handed in would be
   * a namespace two readers could share by accident.
   */
  constructor(parts: ProjectGitParts) {
    this.parts = parts;
    this.readings = new SignatureCache(parts.clock);
  }

  /**
   * What git says about this folder, or `undefined` when there is no repository core can see.
   *
   * @param projectPath the stored, canonical project root.
   * @returns `undefined` for a folder that is not a repository, for one whose `git` would not run,
   * and for one whose `git` exited non-zero. The deck draws the same nothing for all three, and a
   * panel is not the place to explain which (`ProjectStatus.git`).
   */
  public async read(projectPath: string): Promise<GitStatus | undefined> {
    const location = await this.parts.locator.locate(projectPath);
    if (location === undefined) return undefined;
    const gitDir = location.gitDir;
    // `''` when there is nothing cheap to stat — a linked worktree whose main repository was not
    // imported. The TTL alone keeps that honest, which is the degradation rather than a refusal.
    const signature = gitDir === undefined ? '' : await this.signature(gitDir);
    return this.readings.value(projectKey(projectPath), signature, GIT_TTL_MS, () =>
      this.take(projectPath, gitDir),
    );
  }

  /** Drops cached readings for folders that are no longer imported. See `SignatureCache.keep`. */
  public keep(projectPaths: readonly string[]): void {
    this.readings.keep(projectPaths.map(projectKey));
  }

  /** `mtime(HEAD)/mtime(index)` — `statusline.py`'s signature, in seconds. */
  private async signature(gitDir: string): Promise<string> {
    const times = await Promise.all(SIGNATURE_FILES.map((file) => this.modifiedAt(gitDir, file)));
    return times.join('/');
  }

  private async modifiedAt(gitDir: string, file: string): Promise<number> {
    const resolved = await this.parts.paths.resolve(childPath(gitDir, file));
    if (!resolved.ok) return 0;
    return (await this.parts.files.facts(resolved.value))?.modifiedAt ?? 0;
  }

  /** One reading: the spawn, and the in-progress state that costs none. */
  private async take(
    projectPath: string,
    gitDir: string | undefined,
  ): Promise<GitStatus | undefined> {
    const [counts, progress] = await Promise.all([this.spawn(projectPath), this.progress(gitDir)]);
    return counts === undefined ? undefined : { ...counts, progress };
  }

  private async spawn(projectPath: string): Promise<GitCounts | undefined> {
    const result = await this.parts.runner.run({
      // `-C` first, so every later argument is read against the project rather than against
      // whatever directory core happens to have been started in.
      args: ['-C', projectPath, ...STATUS_ARGS],
      command: 'git',
      // Nothing, deliberately. `git status` needs no variable core could set, and `execFile`
      // resolves the executable through the PARENT's `PATH` whatever the child's environment says
      // — measured, not assumed. So an empty block is a child that inherits no token, no
      // `CLAUDE_CONFIG_DIR` and no credential helper, and still finds git.
      env: {},
      timeoutMs: GIT_TIMEOUT_MS,
    });
    if (result.code !== 0 || result.timedOut) {
      this.parts.logger.warn('git_status_failed', {
        code: result.code,
        timedOut: result.timedOut,
      });
      return undefined;
    }
    return parseGitPorcelain(result.stdout);
  }

  /**
   * Mid-merge, mid-rebase, mid-bisect — read off the filesystem, never spawned for.
   *
   * `undefined` when the git directory is not readable, which is honest: the state is knowable
   * only by looking in there, and inventing a second way to ask would be routing around SEC-FS-1.
   */
  private async progress(gitDir: string | undefined): Promise<GitProgress | undefined> {
    if (gitDir === undefined) return undefined;
    for (const marker of PROGRESS_MARKERS) {
      const resolved = await this.parts.paths.resolve(childPath(gitDir, marker.file));
      if (resolved.ok && (await this.parts.files.facts(resolved.value)) !== undefined) {
        return marker.progress;
      }
    }
    return undefined;
  }
}
