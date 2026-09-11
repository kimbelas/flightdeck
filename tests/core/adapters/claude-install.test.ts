// The config dirs and what is watched inside them. Both are derived here and nowhere else, which
// is what keeps a caller-supplied path out of the answer (SEC-FS-1, SECURITY.md §11 rule 2).
//
// Expectations are built with `join`, never written out with backslashes: this file runs on the
// ubuntu job as well as the windows one (§10.2), and a literal `C:\home\.claude-365` asserts the
// separator rather than the behaviour. What matters here is which segments are joined, not what
// the platform puts between them.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeInstall } from '../../../core/adapters/claude-cli/claude-install.ts';

const HOME = 'C:\\home';

// A named executable, so nothing here depends on this machine having Claude installed.
function install(): ClaudeInstall {
  return new ClaudeInstall(HOME, 'C:\\claude.exe');
}

describe('ClaudeInstall — config dirs', () => {
  it('maps each subscription to its own directory', () => {
    expect(install().configDirFor('365')).toBe(join(HOME, '.claude-365'));
    expect(install().configDirFor('isg')).toBe(join(HOME, '.claude-isg'));
  });

  it('sets CLAUDE_CONFIG_DIR so a child talks to one subscription and not the other', () => {
    expect(install().envFor('isg')['CLAUDE_CONFIG_DIR']).toBe(join(HOME, '.claude-isg'));
  });

  it('reports no executable when there is none, rather than falling back to discovery', () => {
    expect(new ClaudeInstall(HOME, '').executable).toBeUndefined();
  });
});

describe('ClaudeInstall — watch targets', () => {
  it('watches sessions/ and jobs/ under both config dirs', () => {
    // Compared sorted: the watcher treats the list as a set, so the order carries no meaning and
    // a test that pinned it would break the day SUBSCRIPTION_IDS is reordered for another reason.
    expect([...install().watchTargets()].sort()).toEqual(
      [
        join(HOME, '.claude-365', 'jobs'),
        join(HOME, '.claude-365', 'sessions'),
        join(HOME, '.claude-isg', 'jobs'),
        join(HOME, '.claude-isg', 'sessions'),
      ].sort(),
    );
  });

  it('names nothing outside the config dirs', () => {
    for (const target of install().watchTargets()) {
      expect(target.startsWith(join(HOME, '.claude-'))).toBe(true);
    }
  });
});
