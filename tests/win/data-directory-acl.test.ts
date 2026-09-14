// SEC-FS-4 on the real filesystem, the half P1-T8 left open — the DIRECTORY (P1-T12).
//
// `tests/win/token-file.test.ts` proves the file case. This one exists because the file case is
// not enough: SQLite creates `flightdeck.db-wal` and `flightdeck.db-shm` beside the database after
// anything could have restricted the database, and the WAL holds the most recently committed rows.
// So the assertion that matters here is the last one — a file created AFTERWARDS inherits the
// single ACE rather than whatever the parent directory would have handed it.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WindowsFileAcl } from '../../core/adapters/windows/windows-file-acl.ts';

// By absolute path, for the same reason the adapter does it: Git Bash puts a GNU `whoami` on PATH
// that does not understand `/user`, so a bare name here tests a different program than ships.
const SYSTEM32 = join(process.env['SystemRoot'] ?? 'C:/Windows', 'System32');
const ICACLS = join(SYSTEM32, 'icacls.exe');
const WHOAMI = join(SYSTEM32, 'whoami.exe');

const onWindows = process.platform === 'win32';

describe('WindowsFileAcl.restrictDirectory', () => {
  let parent = '';
  let directory = '';

  beforeAll(() => {
    if (!onWindows) return;
    parent = mkdtempSync(join(tmpdir(), 'flightdeck-acl-'));
    directory = join(parent, 'flightdeck');
    // The real sequence: core creates the folder, restricts it, and only then does SQLite write
    // into it (core/main.ts `restrictDataDirectory`).
    mkdirSync(directory);
    new WindowsFileAcl().restrictDirectory(directory);
    writeFileSync(join(directory, 'flightdeck.db-wal'), 'rows');
  });

  afterAll(() => {
    if (parent === '') return;
    try {
      execFileSync(ICACLS, [directory, '/reset', '/t'], { stdio: 'ignore' });
    } catch {
      // Already gone, or never created; the rm below is the real cleanup.
    }
    rmSync(parent, { recursive: true, force: true });
  });

  it.skipIf(!onWindows)('grants the current user, by SID, and nobody else', () => {
    const acl = execFileSync(ICACLS, [directory], { encoding: 'utf8' });
    const account = execFileSync(WHOAMI, [], { encoding: 'utf8' }).trim();

    expect(acl.toLowerCase()).toContain(account.toLowerCase());
    expect(acl).not.toContain('BUILTIN\\Administrators');
    expect(acl).not.toContain('NT AUTHORITY\\SYSTEM');
    // A grant to an empty account after the backslash is the failure the token file test pins;
    // the same `whoami /user` call is behind both, so it is worth pinning in both places.
    expect(acl).not.toMatch(/\\:\(/);
  });

  it.skipIf(!onWindows)('makes the grant inheritable, or the WAL is not covered', () => {
    const acl = execFileSync(ICACLS, [directory], { encoding: 'utf8' });

    // (OI)(CI): without these the directory is restricted and everything created inside it is not.
    expect(acl).toContain('(OI)');
    expect(acl).toContain('(CI)');
  });

  it.skipIf(!onWindows)('covers a file created after the restriction — the whole point', () => {
    const wal = execFileSync(ICACLS, [join(directory, 'flightdeck.db-wal')], { encoding: 'utf8' });

    expect(wal).not.toContain('BUILTIN\\Administrators');
    expect(wal).not.toContain('NT AUTHORITY\\SYSTEM');
    const grants = wal.split('\n').filter((line) => line.includes(':('));
    expect(grants).toHaveLength(1);
  });

  it.skipIf(!onWindows)('reads its own work back through describe()', () => {
    // `doctor` decides whether SEC-FS-4 holds from exactly this call, so the writer and the reader
    // are proven against each other rather than each against a fixture.
    const facts = new WindowsFileAcl().describe(directory);

    expect(facts.exists).toBe(true);
    expect(facts.grants).toHaveLength(1);
    expect(facts.grants[0]?.rights).toContain('(oi)');
  });
});
