// The one spelling of "the same path" — P3-T1.
//
// Small enough to look not worth testing, and it is the opposite: `ReadPolicy` decides what core
// may open by comparing two strings that came out of here, so every rule below is a security rule.
import { describe, expect, it } from 'vitest';
import {
  canonicalWindowsPath,
  isUnder,
  lastSegment,
  parentDirectory,
  WINDOWS_SEPARATOR,
} from '../../contracts/windows-path.ts';

describe('canonicalWindowsPath', () => {
  const same: readonly [string, string][] = [
    ['C:/Users/belas', 'C:\\Users\\belas'],
    ['C:\\Users\\BELAS', 'c:\\users\\belas'],
    ['C:\\Users\\belas\\', 'C:\\Users\\belas'],
    ['C:\\Users\\belas\\\\', 'C:\\Users\\belas'],
  ];

  for (const [left, right] of same) {
    it(`reads ${left} and ${right} as one path`, () => {
      expect(canonicalWindowsPath(left)).toBe(canonicalWindowsPath(right));
    });
  }

  it('leaves `..` where it is, because the rule that refuses it has to see it', () => {
    // Not `normalize`. Collapsing here would make SEC-FS-1's third check unreachable.
    expect(canonicalWindowsPath('C:/a/../b')).toBe('c:\\a\\..\\b');
  });

  it('uses the separator every rule compares against', () => {
    expect(canonicalWindowsPath('a/b').includes(WINDOWS_SEPARATOR)).toBe(true);
  });
});

describe('isUnder', () => {
  const root = 'c:\\users\\belas\\.claude-365';

  it('is true for the root itself and for anything beneath it', () => {
    expect(isUnder(root, root)).toBe(true);
    expect(isUnder(`${root}\\projects\\a\\b.jsonl`, root)).toBe(true);
  });

  it('is false for a sibling that merely starts like the root', () => {
    // The `SubscriptionPaths` lesson: a bare `startsWith` reads `.claude-365-backup` as `365`.
    expect(isUnder(`${root}-backup\\projects\\a`, root)).toBe(false);
  });

  it('is false for an empty root, so a policy built before anything was found is closed', () => {
    expect(isUnder('c:\\anything', '')).toBe(false);
  });
});

describe('parentDirectory', () => {
  it('climbs one folder, keeping the casing it was given', () => {
    // Not `canonicalWindowsPath`: the result is composed with and opened, never compared.
    expect(parentDirectory('C:\\Users\\Belas\\Documents')).toBe('C:\\Users\\Belas');
  });

  it('treats both separators and a trailing one as decoration', () => {
    expect(parentDirectory('C:/Users/belas/')).toBe('C:\\Users');
  });

  it('stops at a drive root rather than climbing into a drive-relative reference', () => {
    // `C:\` is a folder and `C:` is not, which is why the separator survives the climb.
    expect(parentDirectory('C:\\Users')).toBe('C:\\');
    expect(parentDirectory('C:\\')).toBeUndefined();
  });

  it('stops at a UNC share, which is the top of its tree', () => {
    expect(parentDirectory('\\\\server\\share\\repo')).toBe('\\\\server\\share');
    expect(parentDirectory('\\\\server\\share')).toBeUndefined();
  });

  it('terminates on anything, which is what the walk that uses it depends on', () => {
    // GitDirectoryLocator climbs until this answers `undefined`; a shape that never did would be
    // a loop bounded only by its own guard.
    let path: string | undefined = '\\\\?\\C:\\Users\\belas\\repo';
    for (let steps = 0; steps < 100 && path !== undefined; steps += 1) path = parentDirectory(path);
    expect(path).toBeUndefined();
  });
});

describe('lastSegment', () => {
  it('answers the folder or file name', () => {
    expect(lastSegment('C:\\Users\\belas\\repo\\.git')).toBe('.git');
  });

  it('folds forward slashes, because a `.git` pointer file is written with them', () => {
    // The one caller that matters reads a path out of a file git wrote, and git writes forward
    // slashes on Windows — P3-T4, and `GitDirectoryLocator`'s header before it.
    expect(lastSegment('C:/Users/belas/repo/.git/worktrees')).toBe('worktrees');
  });

  it('ignores a trailing separator, which is decoration', () => {
    expect(lastSegment('C:\\Users\\belas\\repo\\')).toBe('repo');
  });

  it('answers nothing at a drive root', () => {
    expect(lastSegment('C:\\')).toBeUndefined();
  });

  it('preserves casing, because the answer is shown to a person', () => {
    // The worktree id is the name the owner typed when they created the tree (P3-T4).
    expect(lastSegment('C:\\Users\\belas\\worktrees\\XWEB-1853')).toBe('XWEB-1853');
  });
});
