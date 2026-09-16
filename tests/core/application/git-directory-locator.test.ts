// Finding a project's git directory — P3-T2, SEC-FS-1, and the walk P3-T4 inherits.
//
// The two cases worth more than the rest are the worktree ones. `git worktree add` writes a `.git`
// that is a FILE containing `gitdir: <path>`, with forward slashes, pointing at
// `<main>\.git\worktrees\<name>` — captured from a real `git worktree add` on this machine. And
// when that target lies outside every imported root, the answer is neither "found" nor "no
// repository": there IS a repository, core just may not read its git directory, and the reader
// above degrades to the TTL alone rather than showing nothing.
import { beforeEach, describe, expect, it } from 'vitest';
import { GitDirectoryLocator } from '../../../core/application/git-directory-locator.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeProjectFiles } from '../../fakes/fake-project-files.ts';
import { FakeProjectPaths } from '../../fakes/fake-project-paths.ts';

const REPO = 'C:\\Users\\belas\\Documents\\development\\flightdeck';
const MAIN_GIT = `${REPO}\\.git`;
const WORKTREE = `${REPO}\\.claude\\worktrees\\side`;
const LINKED_GIT = `${MAIN_GIT}\\worktrees\\side`;

interface Harness {
  readonly locator: GitDirectoryLocator;
  readonly paths: FakeProjectPaths;
  readonly files: FakeProjectFiles;
  readonly logger: FakeLogger;
}

let harness: Harness;

function build(paths: FakeProjectPaths): Harness {
  const files = new FakeProjectFiles();
  const logger = new FakeLogger();
  return { locator: new GitDirectoryLocator(paths, files, logger), paths, files, logger };
}

beforeEach(() => {
  harness = build(new FakeProjectPaths().root(REPO));
});

describe('GitDirectoryLocator', () => {
  it('finds a .git directory at the project root', async () => {
    harness.files.directory(MAIN_GIT, ['HEAD', 'index']);
    expect(await harness.locator.locate(REPO)).toEqual({ gitDir: MAIN_GIT });
  });

  it('answers nothing for a folder that is not a repository', async () => {
    // A docs repository with no `.git`, or a plain folder. Both are ordinary things to import.
    expect(await harness.locator.locate(REPO)).toBeUndefined();
  });

  it('climbs, because the imported folder need not be the repository root', async () => {
    // Importing `repo\packages\app` is a reasonable thing to do and its `.git` is two levels up.
    const nested = `${REPO}\\packages\\app`;
    harness.files.directory(MAIN_GIT, ['HEAD']);
    expect(await harness.locator.locate(nested)).toEqual({ gitDir: MAIN_GIT });
  });

  it('follows a `.git` file to a linked worktree, forward slashes and all', async () => {
    // Exactly what `git worktree add` wrote here, separators included.
    harness.paths.root(REPO);
    harness.files.file(`${WORKTREE}\\.git`, `gitdir: ${LINKED_GIT.replaceAll('\\', '/')}\n`);
    harness.files.directory(LINKED_GIT, ['HEAD']);
    expect(await harness.locator.locate(WORKTREE)).toEqual({ gitDir: LINKED_GIT });
  });

  it('resolves a relative gitdir against the folder the pointer is in', async () => {
    harness.files.file(`${WORKTREE}\\.git`, 'gitdir: ../../../.git/worktrees/side');
    harness.files.directory(`${WORKTREE}\\..\\..\\..\\.git\\worktrees\\side`, ['HEAD']);
    const located = await harness.locator.locate(WORKTREE);
    expect(located?.gitDir).toContain('worktrees');
  });

  it('says a worktree IS a repository even when its git directory may not be read', async () => {
    // The owner imported the worktree and not the main repository. There is a branch to be had
    // from `git` itself; there is nothing to stat. Those are different answers and this is the
    // second one — `gitDir: undefined` on a location that exists.
    const alone = build(new FakeProjectPaths().root(WORKTREE));
    alone.files.file(`${WORKTREE}\\.git`, `gitdir: ${LINKED_GIT}`);
    expect(await alone.locator.locate(WORKTREE)).toEqual({ gitDir: undefined });
  });

  it('never reads a .git outside an imported root', async () => {
    // The repository is one level above what was imported, so its git directory is outside the
    // allowlist. SEC-FS-1 says no, and "no repository" is the only honest thing left to say.
    const inner = `${REPO}\\packages\\app`;
    const narrow = build(new FakeProjectPaths().root(inner));
    narrow.files.directory(MAIN_GIT, ['HEAD']);
    expect(await narrow.locator.locate(inner)).toBeUndefined();
  });

  it('keeps climbing past a refusal rather than stopping at the first one', async () => {
    // Stopping early is the shortcut that quietly breaks a monorepo whose parent is itself an
    // imported project. Every candidate is screened independently, so climbing costs a realpath
    // and can read nothing.
    const inner = `${REPO}\\packages\\app`;
    const narrow = build(new FakeProjectPaths().root(inner));
    await narrow.locator.locate(inner);
    expect(narrow.paths.asked).toContain(`${REPO}\\.git`);
  });

  it('follows a junction on .git to what it really points at, and screens THAT', async () => {
    // Resolving before screening is the only order that catches this (SEC-FS-1's fourth check).
    const elsewhere = 'C:\\Users\\belas\\.claude-365\\daemon';
    const tricked = build(new FakeProjectPaths().root(REPO).junction(MAIN_GIT, elsewhere));
    tricked.files.directory(elsewhere, ['control.key']);
    expect(await tricked.locator.locate(REPO)).toBeUndefined();
  });

  it('treats a .git file that is not a pointer as unreadable, and says so in the log', async () => {
    harness.files.file(MAIN_GIT, 'something else entirely');
    expect(await harness.locator.locate(REPO)).toEqual({ gitDir: undefined });
    expect(harness.logger.logged('git_pointer_unreadable')).toBe(true);
  });

  it('terminates at the drive root on a folder with no repository above it', async () => {
    const wide = build(new FakeProjectPaths().root('C:\\'));
    expect(await wide.locator.locate('C:\\a\\b\\c\\d')).toBeUndefined();
    // Every level was tried, and the walk ended rather than spinning on `C:\`.
    expect(wide.paths.asked).toContain('C:\\.git');
  });
});
