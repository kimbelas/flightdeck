// Every checkout of one repository, read off the administrative files — P3-T4.
//
// The shape these cases are built on is what `git worktree add` actually writes, measured on this
// machine and already relied on by `GitDirectoryLocator`:
//
//   <main>\.git\HEAD                            ref: refs/heads/main
//   <main>\.git\worktrees\XWEB-1853\gitdir      C:/…/XWEB-1853/.git   (FORWARD slashes)
//   <main>\.git\worktrees\XWEB-1853\HEAD        ref: refs/heads/XWEB-1853
//   <tree>\.git                                 gitdir: C:/…/.git/worktrees/XWEB-1853
//
// The forward slashes are not decoration in these fixtures — git writes them on Windows, and a
// reader that assumed backslashes would cut the tree path at the wrong segment.
//
// The case worth the most is the one at the bottom: importing a linked worktree ALONE. That is the
// shape `ProjectStatus.git` already degrades for, and the rule here is the one SEC-FS-1 asks for
// rather than the one that reads best — a tree core may not open is not listed, because a launch
// target that cannot be launched is worse than an absent row.
import { beforeEach, describe, expect, it } from 'vitest';
import { GitDirectoryLocator } from '../../../core/application/git-directory-locator.ts';
import { WorktreeReader } from '../../../core/application/worktree-reader.ts';
import { childPath } from '../../../contracts/windows-path.ts';
import { MAIN_TREE_ID } from '../../../contracts/worktree.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeProjectFiles } from '../../fakes/fake-project-files.ts';
import { FakeProjectPaths } from '../../fakes/fake-project-paths.ts';

const MAIN = 'C:\\Users\\belas\\Documents\\development\\app-next';
const TREES = 'C:\\Users\\belas\\Documents\\development\\worktrees';
const ONE = childPath(TREES, 'XWEB-1853');
const TWO = childPath(TREES, 'XWEB-1854');
const COMMON = childPath(MAIN, '.git');
const ADMIN = childPath(COMMON, 'worktrees');
const ADMIN_MTIME = 60;

interface Harness {
  readonly reader: WorktreeReader;
  readonly files: FakeProjectFiles;
  readonly logger: FakeLogger;
}

let harness: Harness;

/** The reader over exactly the roots a test says were imported. */
function build(roots: readonly string[]): Harness {
  const files = new FakeProjectFiles();
  const logger = new FakeLogger();
  const paths = new FakeProjectPaths();
  for (const root of roots) paths.root(root);
  const reader = new WorktreeReader({
    paths,
    roots: paths,
    locator: new GitDirectoryLocator(paths, files, logger),
    files,
    logger,
  });
  return { reader, files, logger };
}

/** A main checkout with a real `.git` directory, on `branch`, registering `names`. */
function repository(files: FakeProjectFiles, branch: string, names: readonly string[]): void {
  files.directory(MAIN, ['.git', 'package.json']);
  files.directory(COMMON, ['HEAD', 'worktrees'], 50);
  files.file(childPath(COMMON, 'HEAD'), `ref: refs/heads/${branch}\n`);
  files.directory(ADMIN, names, ADMIN_MTIME);
}

/**
 * One registration, both halves of it — the admin directory and the tree it points at.
 *
 * `head` is written verbatim so a test can hand over a bare object id, which is the detached case,
 * rather than only a ref line.
 */
function worktree(files: FakeProjectFiles, name: string, treePath: string, head: string): void {
  const admin = childPath(ADMIN, name);
  const slashed = (path: string): string => path.replaceAll('\\', '/');
  files.directory(admin, ['gitdir', 'HEAD']);
  files.file(childPath(admin, 'gitdir'), `${slashed(treePath)}/.git\n`);
  files.file(childPath(admin, 'HEAD'), head);
  files.directory(treePath, ['.git']);
  files.file(childPath(treePath, '.git'), `gitdir: ${slashed(admin)}\n`);
}

describe('a repository with only a main checkout', () => {
  beforeEach(() => {
    harness = build([MAIN]);
    repository(harness.files, 'main', []);
  });

  it('answers the one tree, named main and flagged as it', async () => {
    expect(await harness.reader.read(MAIN)).toEqual([
      { id: MAIN_TREE_ID, path: MAIN, branch: 'main', isMain: true },
    ]);
  });

  it('signs on the administrative directory, so adding a first worktree moves it', async () => {
    expect(await harness.reader.signature(MAIN)).toBe(String(ADMIN_MTIME));
  });

  it('finds the main checkout through the ROOT door, not the file one (G.28)', async () => {
    // `resolve` answers whether a FILE may be opened and refuses a project root outright. Shipped
    // asking only that, every main checkout on the machine vanished behind `the project directory
    // itself is not a file` — with 1 691 tests green, because the fake was looser than the
    // registry. It is not any more, so this asserts the door rather than only the outcome.
    await harness.reader.read(MAIN);

    expect(harness.logger.logged('worktree_main_refused')).toBe(false);
  });
});

describe('a repository with two linked worktrees', () => {
  beforeEach(() => {
    harness = build([MAIN, TREES]);
    repository(harness.files, 'main', ['XWEB-1853', 'XWEB-1854']);
    worktree(harness.files, 'XWEB-1853', ONE, 'ref: refs/heads/XWEB-1853\n');
    worktree(harness.files, 'XWEB-1854', TWO, 'ref: refs/heads/feat/rework-the-picker\n');
  });

  it('answers main first, then the linked trees in listing order', async () => {
    const trees = await harness.reader.read(MAIN);

    expect(trees.map((tree) => [tree.id, tree.branch, tree.isMain])).toEqual([
      [MAIN_TREE_ID, 'main', true],
      ['XWEB-1853', 'XWEB-1853', false],
      ['XWEB-1854', 'feat/rework-the-picker', false],
    ]);
  });

  it('resolves each tree from its own gitdir pointer, forward slashes and all', async () => {
    const trees = await harness.reader.read(MAIN);

    expect(trees.map((tree) => tree.path)).toEqual([MAIN, ONE, TWO]);
  });

  it('answers the same list when the WORKTREE is the imported folder', async () => {
    // The tree's own `.git` is a file pointing back at the registration, so the locator lands on
    // `<common>\worktrees\XWEB-1853` and the reader climbs two segments to the common directory.
    // This is the shape the task's `main vs linked` is about, from the other end.
    expect((await harness.reader.read(ONE)).map((tree) => tree.id)).toEqual([
      MAIN_TREE_ID,
      'XWEB-1853',
      'XWEB-1854',
    ]);
  });
});

describe('a detached head', () => {
  const SPIKE = childPath(TREES, 'spike');

  beforeEach(() => {
    harness = build([MAIN, TREES]);
    repository(harness.files, 'main', ['spike']);
    worktree(harness.files, 'spike', SPIKE, '9f1c0f4a4b2e5d6c8a0b1d2e3f4a5b6c7d8e9f01\n');
  });

  it('reports no branch rather than a sha wearing one', async () => {
    const tree = (await harness.reader.read(MAIN)).find((found) => !found.isMain);

    expect([tree?.id, tree?.branch]).toEqual(['spike', undefined]);
  });
});

describe('a tree that was moved after it was created', () => {
  beforeEach(() => {
    // git keeps the registration under the name it was made with; the directory on disk is where
    // it is now. `tree.mjs`'s `treeId` is the directory, and so is this — the id is what the owner
    // sees in their shell prompt and in every hook's state file, not an administrative record.
    harness = build([MAIN, TREES]);
    repository(harness.files, 'main', ['XWEB-1853']);
    worktree(harness.files, 'XWEB-1853', TWO, 'ref: refs/heads/XWEB-1853\n');
  });

  it('is named after the directory it is in, not after its registration', async () => {
    const tree = (await harness.reader.read(MAIN)).find((found) => !found.isMain);

    expect([tree?.id, tree?.path]).toEqual(['XWEB-1854', TWO]);
  });
});

describe('a registration whose tree core may not read', () => {
  beforeEach(() => {
    // The trees live outside every imported root — what a `git worktree add` into a folder the
    // owner never imported looks like from in here, and what a prunable registration looks like.
    harness = build([MAIN]);
    repository(harness.files, 'main', ['XWEB-1853']);
    worktree(harness.files, 'XWEB-1853', ONE, 'ref: refs/heads/XWEB-1853\n');
  });

  it('drops it rather than offering a launch target that cannot be opened', async () => {
    expect((await harness.reader.read(MAIN)).map((tree) => tree.id)).toEqual([MAIN_TREE_ID]);
  });

  it('says so in the log, because a refusal is the case worth knowing about', async () => {
    await harness.reader.read(MAIN);

    expect(harness.logger.logged('worktree_dropped')).toBe(true);
  });
});

describe('a linked worktree imported without its main repository', () => {
  beforeEach(() => {
    harness = build([ONE]);
    repository(harness.files, 'main', ['XWEB-1853']);
    worktree(harness.files, 'XWEB-1853', ONE, 'ref: refs/heads/XWEB-1853\n');
  });

  it('answers nothing, because the directory it would climb is outside every root', async () => {
    // `GitDirectoryLocator` reports `gitDir: undefined` for exactly this — there IS a repository,
    // and core may not read its administrative files. Nothing to list is the honest answer, and
    // it is the same one `ProjectStatus.git` gives for the same folder.
    expect(await harness.reader.read(ONE)).toEqual([]);
  });

  it('and signs on nothing, so the map TTL alone keeps it honest', async () => {
    expect(await harness.reader.signature(ONE)).toBe('');
  });
});

describe('a folder that is not in a repository at all', () => {
  beforeEach(() => {
    harness = build([MAIN]);
    harness.files.directory(MAIN, ['package.json']);
  });

  it('answers nothing, the same as a repository core cannot see', async () => {
    expect(await harness.reader.read(MAIN)).toEqual([]);
  });

  it('and has nothing cheap to observe', async () => {
    expect(await harness.reader.signature(MAIN)).toBe('');
  });
});
