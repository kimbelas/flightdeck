// What a folder must be before it may become a project root — P3-T1, SEC-FS-1, D26.
//
// The table is the point, as it is in `read-policy.test.ts`: every row is a sentence in SECURITY.md
// or in D26, and the ones that matter most are the refusals. A rule that admits too much fails no
// test unless the test says what must be refused.
import { describe, expect, it } from 'vitest';
import { ProjectImport } from '../../../core/domain/project-import.ts';
import { MAX_PROJECT_PATH_CHARS } from '../../../contracts/project.ts';

const CFG = 'C:\\Users\\belas\\.claude-365';
const ISG = 'C:\\Users\\belas\\.claude-isg';

function rules(): ProjectImport {
  return new ProjectImport([CFG, ISG]);
}

describe('ProjectImport — what the owner typed', () => {
  it('admits an ordinary absolute path', () => {
    expect(
      rules().refuseRequested('C:\\Users\\belas\\Documents\\development\\app-next'),
    ).toBeUndefined();
  });

  it('admits a UNC path, which is absolute too', () => {
    expect(rules().refuseRequested('\\\\nas\\share\\repo')).toBeUndefined();
  });

  it('admits a path typed with forward slashes', () => {
    expect(rules().refuseRequested('C:/Users/belas/Documents')).toBeUndefined();
  });

  const refused: readonly [string, string, string][] = [
    ['empty', '', 'nothing was typed'],
    ['empty', '   ', 'only whitespace was typed'],
    ['not_absolute', 'Documents\\app-next', 'a relative path has no meaning here'],
    ['not_absolute', '\\Users\\belas', 'a rooted path without a drive is not a root'],
    ['traversal', 'C:\\Users\\belas\\..\\..\\Windows', 'SEC-FS-1 rejects .. after normalisation'],
    ['traversal', 'C:/Users/../x', 'the same, with the other separator'],
  ];

  for (const [refusal, raw, why] of refused) {
    it(`refuses ${JSON.stringify(raw)} as ${refusal} — ${why}`, () => {
      expect(rules().refuseRequested(raw)).toBe(refusal);
    });
  }

  it('refuses a path longer than the cap before it can become a syscall', () => {
    expect(rules().refuseRequested(`C:\\${'a'.repeat(MAX_PROJECT_PATH_CHARS)}`)).toBe('too_long');
  });

  it('refuses `..` rather than collapsing it, although realpath would', () => {
    // The refusal is the point: a path with `..` in it was composed rather than picked, and
    // accepting it would make the audit row disagree with the request.
    expect(rules().refuseRequested('C:\\Users\\belas\\Documents\\..\\Documents')).toBe('traversal');
  });

  it('does not touch the filesystem — a folder that does not exist passes this screen', () => {
    // Existence is `realpath`'s answer, not a string's. Deciding it here would be domain code
    // holding an opinion about a disk.
    expect(rules().refuseRequested('Z:\\nothing\\here')).toBeUndefined();
  });
});

describe('ProjectImport — what realpath came back with', () => {
  it('admits a directory outside both config dirs', () => {
    expect(rules().refuseCanonical('C:\\Users\\belas\\Documents\\app-next', true)).toBeUndefined();
  });

  it('refuses a file, rather than quietly importing its parent', () => {
    expect(rules().refuseCanonical('C:\\Users\\belas\\notes.md', false)).toBe('not_a_directory');
  });

  const clashes: readonly [string, string][] = [
    [CFG, 'a config directory itself'],
    [`${CFG}\\projects`, 'a folder under a config directory'],
    [ISG, 'the other config directory'],
    ['C:\\Users\\belas', 'a folder that CONTAINS both config directories'],
    ['C:\\', 'the drive they live on'],
  ];

  for (const [root, what] of clashes) {
    it(`refuses ${what}`, () => {
      expect(rules().refuseCanonical(root, true)).toBe('config_directory');
    });
  }

  it('does not care about casing or separators, because Windows does not', () => {
    expect(rules().refuseCanonical('c:/users/belas/.CLAUDE-365', true)).toBe('config_directory');
  });

  it('admits a sibling that merely starts like a config directory', () => {
    // The mirror of the `SubscriptionPaths` lesson: `.claude-365-backup` is somebody else's folder
    // and refusing to import it would be this rule over-reaching.
    expect(rules().refuseCanonical(`${CFG}-backup`, true)).toBeUndefined();
  });

  it('ignores an empty config directory rather than treating it as a root above everything', () => {
    // A rules object built before `ClaudeInstall` found a home must not refuse every folder on the
    // machine — an empty string is under nothing and contains nothing.
    expect(
      new ProjectImport(['']).refuseCanonical('C:\\Users\\belas\\app-next', true),
    ).toBeUndefined();
  });
});
