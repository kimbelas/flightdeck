// icacls, in one place — SEC-FS-4 (P1-T12).
//
// Extracted from `WindowsTokenFile`, which had the only copy of this and had earned every line of
// it the hard way (see `restrict`). P1-T8 then shipped the SQLite store with no ACL at all and
// left it flagged for this task, and `doctor` needs to READ an ACL rather than write one — three
// callers, so the rule moves behind a port instead of being written a second time.
//
// **`mode: 0o600` is not the control on Windows.** Node maps the POSIX mode onto the read-only
// attribute; the file keeps whatever the parent directory hands down, which under %LOCALAPPDATA%
// normally includes SYSTEM and Administrators. `icacls /inheritance:r` is what severs that.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { AclFacts, AclGrant, FileAcl } from '../../ports/file-acl.ts';

/** Well-known and identical on every Windows install, so they are named by SID, not by label. */
const LOCAL_SYSTEM_SID = 'S-1-5-18';
const ADMINISTRATORS_SID = 'S-1-5-32-544';

/** Both live in System32; naming them by path stops a PATH entry from deciding what runs. */
const SYSTEM32 = join(process.env['SystemRoot'] ?? 'C:/Windows', 'System32');
const ICACLS = join(SYSTEM32, 'icacls.exe');
const WHOAMI = join(SYSTEM32, 'whoami.exe');

/**
 * `(OI)(CI)` — object- and container-inherit, so a file created later in the directory gets this
 * ACE rather than the one %LOCALAPPDATA% would have given it. See `FileAcl.restrictDirectory`.
 */
const INHERITABLE = '(OI)(CI)';

export class WindowsFileAcl implements FileAcl {
  private readonly enabled: boolean;

  /**
   * @param enabled pass `false` to make every call a no-op. Defaults to "am I on Windows", which
   * is the honest condition: there is no `icacls` on the Ubuntu runner, and a unit test that
   * constructs core on Linux must not die inside a Windows adapter (CODING-STANDARDS §10.2).
   */
  constructor(enabled: boolean = process.platform === 'win32') {
    this.enabled = enabled;
  }

  public restrictFile(path: string): void {
    this.restrict(path, '');
  }

  public restrictDirectory(path: string): void {
    this.restrict(path, INHERITABLE);
  }

  /** @throws never — an unreadable path is `exists: false`, which is what `doctor` reports. */
  public describe(path: string): AclFacts {
    if (!this.enabled) return { path, exists: false, grants: [] };
    try {
      const output = execFileSync(ICACLS, [path], { encoding: 'utf8' });
      return { path, exists: true, grants: parseGrants(path, output) };
    } catch {
      return { path, exists: false, grants: [] };
    }
  }

  /**
   * Leaves exactly one ACE on the path: this user, full control.
   *
   * `/inheritance:r` alone is not enough, and believing it was is how this nearly shipped. It
   * removes *inherited* ACEs; where SYSTEM and Administrators are **explicit** on the parent — as
   * they are in the temp tree on a GitHub windows-latest runner, though not under %LOCALAPPDATA%
   * on a personal machine — they survive it untouched, and the result reads as secure locally
   * while granting Administrators full control in CI. So the two are removed by SID as well, which
   * is deterministic in both places.
   *
   * The honest limit: an Administrator can still take ownership of any file and rewrite its DACL.
   * Removing the ACE means elevation is a deliberate act rather than something an already-elevated
   * process gets for free; it is not a defence against an attacker who is already admin, and
   * SEC-FS-4 does not claim to be.
   *
   * A failure here is fatal on purpose — a warning would be ignored.
   *
   * @throws if the user's SID cannot be resolved, or if icacls refuses the path.
   */
  private restrict(path: string, inheritance: string): void {
    if (!this.enabled) return;
    execFileSync(
      ICACLS,
      [
        path,
        '/inheritance:r',
        '/remove:g',
        `*${LOCAL_SYSTEM_SID}`,
        '/remove:g',
        `*${ADMINISTRATORS_SID}`,
        '/grant:r',
        `*${currentUserSid()}:${inheritance}F`,
      ],
      { stdio: 'ignore' },
    );
  }
}

/**
 * The current user's SID, which is what the grant names — `%USERNAME%` is not safe here.
 *
 * On a machine whose computer name equals the account name (the default for a personal Windows
 * install) icacls resolves the bare name to the *computer*, writes a grant to an empty account,
 * and reports success. Combined with `/inheritance:r` that leaves a file nobody can read,
 * including the user who owns it, and core comes up with a token the deck and statusline.py can no
 * longer load. Measured, not theorised (tests/win/token-file.test.ts).
 */
function currentUserSid(): string {
  const csv = execFileSync(WHOAMI, ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' });
  const sid = csv.trim().split(',')[1]?.replaceAll('"', '');
  if (!sid?.startsWith('S-1-')) {
    throw new Error('cannot restrict the ACL: the current user SID did not resolve');
  }
  return sid;
}

/**
 * The ACEs out of `icacls <path>` output.
 *
 * Exported for its own test because the format is the awkward part: the path shares the first line
 * with the first ACE, an account name contains a backslash, a drive letter contains the same colon
 * that separates the rights, and the last two lines are prose.
 */
export function parseGrants(path: string, output: string): readonly AclGrant[] {
  return output
    .split('\n')
    .map((line) => line.replace(path, '').trim())
    .map(grantOf)
    .filter((grant): grant is AclGrant => grant !== undefined);
}

/** `DOMAIN\account:(OI)(CI)(F)` → the pair. Anything else — prose, blank lines — is `undefined`. */
function grantOf(line: string): AclGrant | undefined {
  // Greedy up to the LAST colon followed by a parenthesised right, because a drive letter carries
  // one too and the path is not always the only thing before the account on the line.
  const match = /^(.*):((?:\([^()]*\))+)$/.exec(line);
  const account = match?.[1];
  const rights = match?.[2];
  if (account === undefined || rights === undefined || account === '') return undefined;
  return { account, rights: rights.toLowerCase() };
}
