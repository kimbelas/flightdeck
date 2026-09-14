// SEC-FS-1's allowlist and SEC-FS-2's deny-list, one case per rule — P1-T12.
//
// The table is the point. Every row here is a sentence in SECURITY.md, and the ones that matter
// most are the refusals: a policy that allows too much fails no test unless the test says what
// must be refused.
import { describe, expect, it } from 'vitest';
import { ReadPolicy } from '../../../core/domain/read-policy.ts';

const CFG = 'C:\\Users\\x\\.claude-365';
const OTHER = 'C:\\Users\\x\\.claude-isg';

function policy(): ReadPolicy {
  return new ReadPolicy([CFG, OTHER]);
}

describe('ReadPolicy — what SEC-FS-1 allows', () => {
  const allowed: readonly string[] = [
    `${CFG}\\projects\\a-slug\\11111111-2222-4333-a444-555555555555.jsonl`,
    `${CFG}\\sessions\\a-session`,
    `${CFG}\\jobs\\state`,
    `${CFG}\\history.jsonl`,
    `${CFG}\\settings.json`,
    `${CFG}\\daemon.log`,
    `${CFG}\\daemon\\roster.json`,
    `${OTHER}\\projects\\b-slug\\a.jsonl`,
  ];

  for (const path of allowed) {
    it(`allows ${path.replace(CFG, '$CFG').replace(OTHER, '$ISG')}`, () => {
      expect(policy().allows(path)).toBe(true);
      expect(policy().refusal(path)).toBeUndefined();
    });
  }

  it('does not care about separators or case, because Windows does not', () => {
    expect(policy().allows('c:/USERS/x/.CLAUDE-365/projects/s/a.jsonl')).toBe(true);
  });
});

describe('ReadPolicy — what SEC-FS-2 refuses', () => {
  const refused: readonly [string, string][] = [
    [`${CFG}\\sessions\\a-session.key`, '.key'],
    [`${CFG}\\daemon\\control.key`, '.key'],
    [`${CFG}\\daemon\\a.key`, '.key'],
    [`${CFG}\\.credentials.json`, 'credentials'],
    [`${CFG}\\.credentials`, 'credentials'],
    [`${CFG}\\statsig\\something.json`, '.json'],
    [`${CFG}\\daemon\\roster-backup.json`, '.json'],
    [`${CFG}\\projects\\s\\notes.json`, '.json'],
  ];

  for (const [path, rule] of refused) {
    it(`refuses ${path.replace(CFG, '$CFG')} — ${rule}`, () => {
      expect(policy().allows(path)).toBe(false);
      expect(policy().refusal(path)).toContain('SEC-FS-2');
    });
  }

  it('refuses a .key even inside an allowlisted directory, because the deny-list runs first', () => {
    expect(policy().allows(`${CFG}\\projects\\s\\a.key`)).toBe(false);
  });
});

describe('ReadPolicy — everything else', () => {
  it('refuses a path outside both config directories', () => {
    const refusal = policy().refusal('C:\\Users\\x\\.ssh\\id_rsa');

    expect(refusal).toBe('outside both config directories');
  });

  it('refuses a sibling directory that merely starts like a config directory', () => {
    // The `SubscriptionPaths` lesson: a bare `startsWith` reads `.claude-365-backup` as 365, and
    // a folder some unrelated tool created starts being read as the owner's live config.
    expect(policy().allows(`${CFG}-backup\\projects\\s\\a.jsonl`)).toBe(false);
  });

  it('refuses traversal after normalisation', () => {
    const refusal = policy().refusal(`${CFG}\\projects\\..\\daemon\\control.key`);

    expect(refusal).toBeDefined();
  });

  it('refuses the config directory itself, with or without a trailing separator', () => {
    expect(policy().allows(CFG)).toBe(false);
    expect(policy().allows(`${CFG}\\`)).toBe(false);
  });

  it('refuses a file at the root of a config directory that is not named', () => {
    expect(policy().refusal(`${CFG}\\CLAUDE.md`)).toContain('SEC-FS-1');
  });

  it('refuses everything when it was given no config directories', () => {
    // A policy built before `ClaudeInstall` found a home must not be an open door.
    expect(new ReadPolicy(['']).allows(`${CFG}\\projects\\s\\a.jsonl`)).toBe(false);
  });
});
