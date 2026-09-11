// SEC-FS-4 — the token on disk, readable by this user and nobody else.
//
// `mode: 0o600` is not enough on Windows: Node maps the POSIX mode onto the read-only attribute
// and the file keeps whatever the parent directory hands down, which for a folder under
// %LOCALAPPDATA% normally includes SYSTEM and Administrators. `icacls /inheritance:r` is what
// actually severs that, so the mode is set as well but is not the control.
//
// The path itself comes from contracts/core-token.ts, which proxy.ts also reads — the deck and
// core have to agree about it, and the only way to guarantee that is to have one definition.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { coreTokenFile } from '../../../contracts/core-token.ts';
import type { TokenFile } from '../../ports/token-file.ts';

/** Well-known and identical on every Windows install, so they are named by SID, not by label. */
const LOCAL_SYSTEM_SID = 'S-1-5-18';
const ADMINISTRATORS_SID = 'S-1-5-32-544';

/** Both live in System32; naming them by path stops a PATH entry from deciding what runs. */
const SYSTEM32 = `${process.env['SystemRoot'] ?? 'C:\\Windows'}\\System32`;
const ICACLS = `${SYSTEM32}\\icacls.exe`;
const WHOAMI = `${SYSTEM32}\\whoami.exe`;

export class WindowsTokenFile implements TokenFile {
  private readonly path: string;
  private readonly restrictAcl: boolean;

  constructor(path: string = coreTokenFile(), restrictAcl: boolean = process.platform === 'win32') {
    this.path = path;
    this.restrictAcl = restrictAcl;
  }

  public write(token: string): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, token, { encoding: 'utf8', mode: 0o600 });
    if (this.restrictAcl) this.applyAcl();
  }

  public remove(): void {
    rmSync(this.path, { force: true });
  }

  public location(): string {
    return this.path;
  }

  /**
   * Leaves exactly one ACE on the file: this user, full control.
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
   * @throws if the user's SID cannot be resolved, or if icacls refuses the file.
   */
  private applyAcl(): void {
    execFileSync(
      ICACLS,
      [
        this.path,
        '/inheritance:r',
        '/remove:g',
        `*${LOCAL_SYSTEM_SID}`,
        '/remove:g',
        `*${ADMINISTRATORS_SID}`,
        '/grant:r',
        `*${currentUserSid()}:F`,
      ],
      { stdio: 'ignore' },
    );
  }
}

/**
 * The current user's SID, which is what the grant names — `%USERNAME%` is not safe here.
 *
 * On a machine whose computer name equals the account name (the default for a personal Windows
 * install: this one is `KIMPOY\Kimpoy`) icacls resolves the bare name to the *computer*, writes
 * `KIMPOY\:(F)` — a grant to an empty account — and reports success. Combined with
 * `/inheritance:r` that leaves a file nobody can read, including the user who owns it, and core
 * comes up with a token the deck and statusline.py can no longer load. Measured, not theorised.
 */
function currentUserSid(): string {
  const csv = execFileSync(WHOAMI, ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' });
  const sid = csv.trim().split(',')[1]?.replaceAll('"', '');
  if (!sid?.startsWith('S-1-')) {
    throw new Error('cannot restrict the token ACL: the current user SID did not resolve');
  }
  return sid;
}
