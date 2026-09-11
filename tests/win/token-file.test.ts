// SEC-FS-4 on the real filesystem — the ACL, checked by reading it back out of icacls.
//
// This file exists because the first implementation passed every unit test and still produced a
// token nobody could read: `icacls /grant:r Kimpoy:F` on a machine named KIMPOY resolves the bare
// name to the computer, grants `KIMPOY\:(F)`, and exits 0. Only an assertion against the ACL as
// Windows actually stored it catches that, which is why this is an integration test and not a
// test of the argument array.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WindowsTokenFile } from '../../core/adapters/windows/windows-token-file.ts';

// By absolute path, for the same reason the adapter does it: Git Bash puts a GNU `whoami` on PATH
// that does not understand `/user`, so a bare name here tests a different program than ships.
const SYSTEM32 = join(process.env['SystemRoot'] ?? 'C:/Windows', 'System32');
const ICACLS = join(SYSTEM32, 'icacls.exe');
const WHOAMI = join(SYSTEM32, 'whoami.exe');

const onWindows = process.platform === 'win32';
const TOKEN = 'd'.repeat(64);

describe('WindowsTokenFile', () => {
  let directory = '';
  let path = '';

  beforeAll(() => {
    if (!onWindows) return;
    directory = mkdtempSync(join(tmpdir(), 'flightdeck-token-'));
    path = join(directory, 'token');
    new WindowsTokenFile(path).write(TOKEN);
  });

  afterAll(() => {
    if (directory === '') return;
    // The ACL is restrictive by design, so hand delete rights back before trying to clean up.
    try {
      execFileSync(ICACLS, [path, '/reset'], { stdio: 'ignore' });
    } catch {
      // Already gone, or never created; the rm below is the real cleanup.
    }
    rmSync(directory, { recursive: true, force: true });
  });

  it.skipIf(!onWindows)('writes the token the issuer handed it', () => {
    expect(readFileSync(path, 'utf8')).toBe(TOKEN);
  });

  it.skipIf(!onWindows)('stays readable by the user who owns it', () => {
    // The regression: a grant to an empty account plus /inheritance:r locks out the owner too,
    // and core then runs with a token proxy.ts and statusline.py cannot load.
    expect(() => readFileSync(path, 'utf8')).not.toThrow();
  });

  it.skipIf(!onWindows)('grants the current user, by SID, full control', () => {
    const sid = execFileSync(WHOAMI, ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' })
      .trim()
      .split(',')[1]
      ?.replaceAll('"', '');
    const acl = execFileSync(ICACLS, [path], { encoding: 'utf8' });
    const account = execFileSync(WHOAMI, [], { encoding: 'utf8' }).trim();

    expect(sid).toMatch(/^S-1-/);
    // icacls prints the resolved account name, not the SID it was given — an empty account after
    // the backslash is the failure this pins.
    expect(acl.toLowerCase()).toContain(`${account.toLowerCase()}:(f)`);
    expect(acl).not.toMatch(/\\:\(/);
  });

  it.skipIf(!onWindows)('grants nobody else — not SYSTEM, not Administrators', () => {
    const acl = execFileSync(ICACLS, [path], { encoding: 'utf8' });

    // CI is the environment that actually proves this one. Under %LOCALAPPDATA% on a personal
    // machine SYSTEM and Administrators are inherited, so `/inheritance:r` alone appears to do the
    // job; in the temp tree on a windows-latest runner they are explicit and survive it. The first
    // version of this adapter passed locally and granted Administrators full control in CI.
    expect(acl).not.toContain('BUILTIN\\Administrators');
    expect(acl).not.toContain('NT AUTHORITY\\SYSTEM');
    // One granted principal, and it is us. The trailing line is icacls' own summary.
    const grants = acl.split('\n').filter((line) => line.includes(':('));
    expect(grants).toHaveLength(1);
  });

  it.skipIf(!onWindows)('removes the file on revoke', () => {
    const revokable = join(directory, 'revokable');
    const file = new WindowsTokenFile(revokable);
    file.write(TOKEN);

    file.remove();

    expect(() => readFileSync(revokable, 'utf8')).toThrow();
  });
});
