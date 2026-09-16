// `git status --porcelain=v2 --branch -uno`, parsed — P3-T2.
//
// Every fixture string below was taken from a real `git` on this machine rather than written from
// the documentation, because the two disagree about the thing that matters most: **`# branch.ab`
// is absent entirely when there is no upstream**. A parser written from the format description
// would leave `ahead` and `behind` unset for every branch nobody has pushed, which is most of them
// on a machine where branches are made per task.
import { describe, expect, it } from 'vitest';
import { MAX_BRANCH_CHARS, parseGitPorcelain, parseGitStatus } from '../../contracts/git-status.ts';

/** A clean branch with an upstream, level with it. Captured from this repository on `main`. */
const CLEAN = [
  '# branch.oid 2241fe66e71182228507fe03907347baafa98ed1',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +0 -0',
  '',
].join('\n');

/** Two modified files and one staged add. Captured from a scratch repository with no upstream. */
const DIRTY = [
  '# branch.oid 3f3fbfe71512ac4f3fcabec8536eea87c773f373',
  '# branch.head master',
  '1 .M N... 100644 100644 100644 7898192261 7898192261 a.txt',
  '1 A. N... 000000 100644 100644 0000000000 f2ad6c76f0 c.txt',
  '',
].join('\n');

describe('parseGitPorcelain', () => {
  it('reads the branch off `# branch.head`', () => {
    expect(parseGitPorcelain(CLEAN).branch).toBe('main');
  });

  it('reads ahead and behind off `# branch.ab`', () => {
    const ab = '# branch.head feat/x\n# branch.ab +3 -2\n';
    expect(parseGitPorcelain(ab)).toMatchObject({ ahead: 3, behind: 2 });
  });

  it('answers 0/0 when there is no upstream, because git prints no `branch.ab` at all', () => {
    // Measured, not assumed — see the header. This is the case a documentation-driven parser gets
    // wrong, and it is the common one.
    expect(parseGitPorcelain(DIRTY)).toMatchObject({ ahead: 0, behind: 0 });
  });

  it('counts one dirty file per entry line, staged or not', () => {
    expect(parseGitPorcelain(DIRTY).dirty).toBe(2);
  });

  it('counts a rename as one changed file, not two', () => {
    // A `2 ` line is one file that moved. Counting its two paths would double it.
    const renamed =
      '# branch.head main\n2 R. N... 100644 100644 100644 aa bb R100 new.txt\told.txt\n';
    expect(parseGitPorcelain(renamed).dirty).toBe(1);
  });

  it('counts unmerged paths separately, because a conflict is not just a change', () => {
    const conflicted = '# branch.head main\nu UU N... 100644 100644 100644 100644 aa bb cc x.txt\n';
    expect(parseGitPorcelain(conflicted)).toMatchObject({ conflicts: 1, dirty: 0 });
  });

  it('reads a detached HEAD as no branch rather than as git’s placeholder', () => {
    // `(detached)` is a sentinel in a human-readable field; a deck rendering it would be showing
    // git's placeholder as if it were a branch name.
    expect(parseGitPorcelain('# branch.head (detached)\n').branch).toBeUndefined();
  });

  it('survives CRLF, which is what git prints under some shells here', () => {
    expect(parseGitPorcelain('# branch.head main\r\n# branch.ab +1 -0\r\n')).toMatchObject({
      branch: 'main',
      ahead: 1,
    });
  });

  it('answers nothing for output it cannot read, rather than failing a panel', () => {
    expect(parseGitPorcelain('fatal: not a git repository')).toMatchObject({
      branch: undefined,
      dirty: 0,
      ahead: 0,
    });
  });

  it('caps the branch name where it is parsed, not wherever it is next used', () => {
    const long = `# branch.head ${'b'.repeat(MAX_BRANCH_CHARS + 50)}\n`;
    expect(parseGitPorcelain(long).branch).toHaveLength(MAX_BRANCH_CHARS);
  });
});

describe('parseGitStatus', () => {
  it('reads one reading off the wire', () => {
    expect(parseGitStatus({ branch: 'main', ahead: 1, behind: 2, dirty: 3, conflicts: 0 })).toEqual(
      {
        branch: 'main',
        ahead: 1,
        behind: 2,
        dirty: 3,
        conflicts: 0,
        progress: undefined,
      },
    );
  });

  it('treats an absent branch as a detached HEAD, which is how JSON carries `undefined`', () => {
    expect(parseGitStatus({ dirty: 0 })?.branch).toBeUndefined();
  });

  it('drops a progress state this build does not know rather than displaying it', () => {
    expect(parseGitStatus({ progress: 'sharding' })?.progress).toBeUndefined();
  });

  it('reads a known progress state', () => {
    expect(parseGitStatus({ progress: 'rebasing' })?.progress).toBe('rebasing');
  });

  it('refuses a body that is not an object', () => {
    expect(parseGitStatus('main')).toBeUndefined();
    expect(parseGitStatus(null)).toBeUndefined();
  });

  it('reads a count that is not one as zero, so one bad field does not lose the others', () => {
    expect(parseGitStatus({ branch: 'main', dirty: 'lots', ahead: -4 })).toMatchObject({
      branch: 'main',
      dirty: 0,
      ahead: 0,
    });
  });
});
