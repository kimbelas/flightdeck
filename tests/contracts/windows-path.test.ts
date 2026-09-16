// The one spelling of "the same path" — P3-T1.
//
// Small enough to look not worth testing, and it is the opposite: `ReadPolicy` decides what core
// may open by comparing two strings that came out of here, so every rule below is a security rule.
import { describe, expect, it } from 'vitest';
import { canonicalWindowsPath, isUnder, WINDOWS_SEPARATOR } from '../../contracts/windows-path.ts';

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
