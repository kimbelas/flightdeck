// SEC-HTTP-7 — the one credential Flightdeck does not rotate, and the reason it does not.
//
// `TokenIssuer` next door issues a fresh secret on every boot, which is right for a client that
// can re-read it: the deck reads the token file per request, and the statusLine block reads it per
// render. This issuer is its opposite, for the one client that cannot. A Claude Code session
// interpolates its hook header from the environment it was spawned with (RESEARCH.md F.1.7), so a
// secret that rotated under it would 401 — and a 401 on a hook is an error banner in that session
// for every turn until it is restarted (F.1.5).
//
// The trade is deliberate and it is smaller than it looks: this key authenticates `POST /hooks`
// and nothing else. It cannot launch a session, read `/sessions`, or mint a PTY ticket.
import { randomBytes } from 'node:crypto';
import type { TokenFile } from '../ports/token-file.ts';

/** 256 bits, matching SEC-HTTP-3. Hex for the same reason: it survives every shell unescaped. */
const KEY_BYTES = 32;

export class IngestKeyIssuer {
  private readonly file: TokenFile;

  constructor(file: TokenFile) {
    this.file = file;
  }

  /**
   * The existing key, or a new one written with the per-user ACL (SEC-FS-4).
   *
   * @returns the key, for the guard to compare against. Never logged or printed (SEC-DATA-4).
   * @throws if a key had to be created and could not be written — core must not come up believing
   * it has a credential that sessions cannot read, because every hook would then 401 silently.
   */
  public ensure(): string {
    const existing = this.file.read();
    if (existing !== undefined) return existing;
    const key = randomBytes(KEY_BYTES).toString('hex');
    this.file.write(key);
    return key;
  }

  /**
   * Replaces the key. Not called on shutdown — that is the whole point of this class.
   *
   * It exists for `Rotate token` (SEC-OPS-2), where rotating the ingest key too is the correct
   * response to a leak. Every session then needs restarting, and the operator asking for it has
   * said they accept that; core restarting on its own has not.
   */
  public rotate(): string {
    const key = randomBytes(KEY_BYTES).toString('hex');
    this.file.write(key);
    return key;
  }
}
