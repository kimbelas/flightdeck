// SEC-HTTP-3 — one token per boot, generated here and nowhere else.
//
// Per boot rather than persisted, because the threat it answers is a page or a process that
// learned the token once: restarting core must invalidate it, and `Rotate token` (SEC-OPS-2) is
// then the same operation as a restart rather than a second mechanism.
import { randomBytes } from 'node:crypto';
import type { TokenFile } from '../ports/token-file.ts';

/** 256 bits, per SEC-HTTP-3. Hex rather than base64url: it survives every shell and log unescaped. */
const TOKEN_BYTES = 32;

export class TokenIssuer {
  private readonly file: TokenFile;

  constructor(file: TokenFile) {
    this.file = file;
  }

  /**
   * Generates a fresh token and publishes it.
   *
   * @returns the token, for the guard that will compare against it. It is deliberately never
   * logged or printed — `flightdeck-core status` prints the path, not the contents (SEC-DATA-4).
   * @throws if the file cannot be written; core must not run with an unreadable token, because
   * every caller would then fail closed and the deck would be silently dead.
   */
  public issue(): string {
    const token = randomBytes(TOKEN_BYTES).toString('hex');
    this.file.write(token);
    return token;
  }

  public revoke(): void {
    this.file.remove();
  }
}
