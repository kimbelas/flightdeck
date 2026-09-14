// SEC-FS-4 — the token on disk, readable by this user and nobody else.
//
// The ACL itself moved to `WindowsFileAcl` in P1-T12, when the store and `doctor` became the second
// and third things that needed it. What stays here is the sequence: write, then restrict, so there
// is no window in which the secret exists with the directory's inherited ACL.
//
// `mode: 0o600` is set as well but is not the control on Windows — see `WindowsFileAcl`.
//
// The path itself comes from contracts/core-token.ts, which proxy.ts also reads — the deck and
// core have to agree about it, and the only way to guarantee that is to have one definition.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { coreTokenFile } from '../../../contracts/core-token.ts';
import type { FileAcl } from '../../ports/file-acl.ts';
import type { TokenFile } from '../../ports/token-file.ts';
import { WindowsFileAcl } from './windows-file-acl.ts';

export class WindowsTokenFile implements TokenFile {
  private readonly path: string;
  private readonly acl: FileAcl;

  constructor(path: string = coreTokenFile(), acl: FileAcl = new WindowsFileAcl()) {
    this.path = path;
    this.acl = acl;
  }

  public write(token: string): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, token, { encoding: 'utf8', mode: 0o600 });
    this.acl.restrictFile(this.path);
  }

  /** Absent, empty and unreadable are all one answer: there is no secret here (SEC-HTTP-7). */
  public read(): string | undefined {
    try {
      const secret = readFileSync(this.path, 'utf8').trim();
      return secret === '' ? undefined : secret;
    } catch {
      return undefined;
    }
  }

  public remove(): void {
    rmSync(this.path, { force: true });
  }

  public location(): string {
    return this.path;
  }
}
