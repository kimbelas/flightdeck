// One project's git reading — P3-T2, SPEC §5.1.
//
// The assertions worth the most are about how often `git` is SPAWNED, not about what it said. That
// is the whole of what this task lifts from `statusline.py`: a reading is held until the git
// directory's mtimes move or four seconds pass, so a panel that redraws does not start a process.
// A test that only checked the parsed numbers would stay green through a change that spawned `git`
// on every request.
import { beforeEach, describe, expect, it } from 'vitest';
import { GitDirectoryLocator } from '../../../core/application/git-directory-locator.ts';
import { ProjectGitReader } from '../../../core/application/project-git-reader.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeProcessRunner } from '../../fakes/fake-process-runner.ts';
import { FakeProjectFiles } from '../../fakes/fake-project-files.ts';
import { FakeProjectPaths } from '../../fakes/fake-project-paths.ts';

const REPO = 'C:\\Users\\belas\\Documents\\development\\flightdeck';
const GIT_DIR = `${REPO}\\.git`;
const TTL = 4000;

const PORCELAIN = [
  '# branch.oid 2241fe66e71182228507fe03907347baafa98ed1',
  '# branch.head feat/P3-T2-git-detection',
  '# branch.upstream origin/main',
  '# branch.ab +2 -1',
  '1 .M N... 100644 100644 100644 aa aa contracts/git-status.ts',
  '',
].join('\n');

interface Harness {
  readonly reader: ProjectGitReader;
  readonly runner: FakeProcessRunner;
  readonly files: FakeProjectFiles;
  readonly paths: FakeProjectPaths;
  readonly clock: FakeClock;
  readonly logger: FakeLogger;
  /** How many `git` processes have been started. The number most of these cases are about. */
  readonly spawns: () => number;
}

let harness: Harness;

function build(paths = new FakeProjectPaths().root(REPO)): Harness {
  const files = new FakeProjectFiles();
  const clock = new FakeClock(1000);
  const logger = new FakeLogger();
  const runner = new FakeProcessRunner();
  runner.willReturn({ stdout: PORCELAIN });
  const reader = new ProjectGitReader({
    paths,
    locator: new GitDirectoryLocator(paths, files, logger),
    files,
    runner,
    clock,
    logger,
  });
  return {
    reader,
    runner,
    files,
    paths,
    clock,
    logger,
    spawns: () => runner.requests.filter((request) => request.command === 'git').length,
  };
}

/** The ordinary repository: a `.git` directory with the two files the signature is taken from. */
function repository(harness: Harness, at = 100): void {
  harness.files.directory(GIT_DIR, ['HEAD', 'index']);
  harness.files.file(`${GIT_DIR}\\HEAD`, 'ref: refs/heads/main', at);
  harness.files.file(`${GIT_DIR}\\index`, 'binary', at);
}

beforeEach(() => {
  harness = build();
});

describe('ProjectGitReader', () => {
  it('reads branch, divergence and dirty out of one spawn', async () => {
    repository(harness);
    expect(await harness.reader.read(REPO)).toEqual({
      branch: 'feat/P3-T2-git-detection',
      ahead: 2,
      behind: 1,
      dirty: 1,
      conflicts: 0,
      progress: undefined,
    });
    expect(harness.spawns()).toBe(1);
  });

  it('runs `git -C <root>`, because the port takes an argv and no working directory', async () => {
    repository(harness);
    await harness.reader.read(REPO);
    // `-C` is an argv element like any other, so SEC-PROC-1's "an array, always" still covers the
    // whole invocation and `ProcessRunner` does not grow a `cwd` for this.
    expect(harness.runner.requests[0]?.args).toEqual([
      '-C',
      REPO,
      'status',
      '--porcelain=v2',
      '--branch',
      '-uno',
    ]);
  });

  it('answers nothing for a folder that is not a repository, and spawns nothing', async () => {
    // No `.git` anywhere means there is nothing to ask about. Spawning `git` to be told so would
    // be a process per non-repository per request.
    expect(await harness.reader.read(REPO)).toBeUndefined();
    expect(harness.spawns()).toBe(0);
  });

  it('reuses the reading while the git directory has not moved', async () => {
    repository(harness);
    await harness.reader.read(REPO);
    await harness.reader.read(REPO);
    expect(harness.spawns()).toBe(1);
  });

  it('re-reads as soon as HEAD moves, without waiting for the TTL', async () => {
    repository(harness);
    await harness.reader.read(REPO);
    // A commit. The signature is what makes this immediate rather than up to four seconds late.
    harness.files.touch(`${GIT_DIR}\\HEAD`, 200);
    await harness.reader.read(REPO);
    expect(harness.spawns()).toBe(2);
  });

  it('re-reads as soon as the index moves', async () => {
    repository(harness);
    await harness.reader.read(REPO);
    harness.files.touch(`${GIT_DIR}\\index`, 200);
    await harness.reader.read(REPO);
    expect(harness.spawns()).toBe(2);
  });

  it('re-reads when the TTL lapses, because editing a tracked file moves neither mtime', async () => {
    repository(harness);
    await harness.reader.read(REPO);
    harness.clock.advance(TTL + 1);
    await harness.reader.read(REPO);
    expect(harness.spawns()).toBe(2);
  });

  it('reads the in-progress state off the filesystem, with no extra spawn', async () => {
    repository(harness);
    harness.files.directory(`${GIT_DIR}\\rebase-merge`, ['head-name']);
    expect((await harness.reader.read(REPO))?.progress).toBe('rebasing');
    expect(harness.spawns()).toBe(1);
  });

  it('names the specific operation when a marker and a dirty index are both present', async () => {
    repository(harness);
    harness.files.file(`${GIT_DIR}\\CHERRY_PICK_HEAD`, 'abc123');
    expect((await harness.reader.read(REPO))?.progress).toBe('cherry-picking');
  });

  it('answers nothing when git exits non-zero, and says so in the log', async () => {
    repository(harness);
    harness.runner.willReturn({ code: 128, stderr: 'fatal: not a git repository' });
    expect(await harness.reader.read(REPO)).toBeUndefined();
    expect(harness.logger.logged('git_status_failed')).toBe(true);
  });

  it('holds a failure for the TTL rather than spawning again on every request', async () => {
    repository(harness);
    harness.runner.willReturn({ code: 128 });
    await harness.reader.read(REPO);
    await harness.reader.read(REPO);
    expect(harness.spawns()).toBe(1);
  });

  it('answers nothing when git times out', async () => {
    repository(harness);
    harness.runner.willReturn({ timedOut: true, stdout: PORCELAIN });
    expect(await harness.reader.read(REPO)).toBeUndefined();
  });

  it('still reads a worktree whose git directory may not be read, on the TTL alone', async () => {
    // The owner imported the worktree and not the main repository. `git` itself still answers, and
    // there is no signature to take — so the TTL is the only thing bounding how stale it gets.
    const worktree = `${REPO}\\.claude\\worktrees\\side`;
    const alone = build(new FakeProjectPaths().root(worktree));
    alone.files.file(`${worktree}\\.git`, `gitdir: ${GIT_DIR}\\worktrees\\side`);
    const reading = await alone.reader.read(worktree);
    expect(reading?.branch).toBe('feat/P3-T2-git-detection');
    // No git directory to look in, so no in-progress state — rather than inventing a second way
    // to ask, which would be routing around SEC-FS-1.
    expect(reading?.progress).toBeUndefined();
    expect(alone.spawns()).toBe(1);
  });

  it('keeps that reading for the TTL and no longer', async () => {
    const worktree = `${REPO}\\.claude\\worktrees\\side`;
    const alone = build(new FakeProjectPaths().root(worktree));
    alone.files.file(`${worktree}\\.git`, `gitdir: ${GIT_DIR}\\worktrees\\side`);
    await alone.reader.read(worktree);
    await alone.reader.read(worktree);
    expect(alone.spawns()).toBe(1);
    alone.clock.advance(TTL + 1);
    await alone.reader.read(worktree);
    expect(alone.spawns()).toBe(2);
  });

  it('drops a forgotten project\u2019s reading rather than answering from it later', async () => {
    repository(harness);
    await harness.reader.read(REPO);
    harness.reader.keep([]);
    await harness.reader.read(REPO);
    // Permission was withdrawn and re-granted; the cache does not carry an answer across that.
    expect(harness.spawns()).toBe(2);
  });

  it('passes no environment to the child, which still finds git on PATH', async () => {
    repository(harness);
    await harness.reader.read(REPO);
    // Measured: `execFile` resolves the executable through the PARENT's `PATH` whatever the
    // child's environment says. So the child inherits no token and no `CLAUDE_CONFIG_DIR`.
    expect(harness.runner.requests[0]?.env).toEqual({});
  });
});
