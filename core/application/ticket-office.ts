// Short-lived single-use tickets for the PTY socket — SEC-WS-1, DECISIONS.md D32, P5a-T2b.
//
// The per-boot token authenticates everything core answers and lasts until core restarts. A
// WebSocket handshake cannot carry a header, so SEC-WS-1 puts the credential in the first frame —
// and D31 paid for that by handing the page the token itself, which made an XSS in the deck a full
// core compromise rather than a defaced page.
//
// A ticket is the credential that first frame should have carried. It is minted by core for one
// target, on a request that authenticated with the real token server-side (`POST /pty-ticket`,
// reached through the Next rewrite), and it is worth exactly one PTY on exactly one target for a
// few seconds. What the page holds is no longer a key to core; it is a receipt for one pane.
//
// Held as a hash, not as the ticket. Nothing here can leak a usable credential into a heap dump or
// a log, and the office cannot print a ticket it has issued — only recognise one.
import { createHash, randomBytes } from 'node:crypto';
import { sameTarget, type PtyTarget } from '../../contracts/pty-protocol.ts';
import type { Clock } from '../ports/clock.ts';

/** 256 bits, matching the token (SEC-HTTP-3). A ticket is short-lived, not weak. */
const TICKET_BYTES = 32;

/**
 * Long enough for a fetch, a WebSocket handshake and a slow first paint; far short of a session.
 *
 * The 2 s auth deadline inside the socket (SEC-WS-1) is a different clock and deliberately
 * shorter: this one bounds how long a stolen ticket is worth anything, that one bounds how long an
 * unauthenticated socket may sit open.
 */
const DEFAULT_TTL_MS = 10_000;

/**
 * A cap on outstanding tickets, so a page that mints and never connects cannot grow this map.
 *
 * Over the cap the oldest is dropped rather than the mint refused: only an authenticated caller can
 * mint at all, so refusing would be a self-inflicted denial of the deck's own panes, and the oldest
 * entry is always the one closest to expiry.
 */
const MAX_OUTSTANDING = 64;

interface Issued {
  readonly target: PtyTarget;
  readonly expiresAt: number;
}

export class TicketOffice {
  private readonly clock: Clock;
  private readonly ttlMs: number;
  /** Insertion-ordered, and every entry has the same lifetime, so the first key expires first. */
  private readonly outstanding = new Map<string, Issued>();

  constructor(clock: Clock, ttlMs: number = DEFAULT_TTL_MS) {
    this.clock = clock;
    this.ttlMs = ttlMs;
  }

  /** How many tickets are still redeemable. For tests and for `flightdeck-core status`. */
  public get outstandingCount(): number {
    return this.outstanding.size;
  }

  /**
   * Issues a ticket for one target.
   *
   * @returns the ticket, which is the only time it exists in this process — the office keeps the
   * hash. It must never be logged: it is a bearer credential for the seconds it lives.
   */
  public mint(target: PtyTarget): string {
    this.sweep();
    const ticket = randomBytes(TICKET_BYTES).toString('hex');
    this.outstanding.set(fingerprint(ticket), {
      target,
      expiresAt: this.clock.now().getTime() + this.ttlMs,
    });
    while (this.outstanding.size > MAX_OUTSTANDING) {
      const oldest = this.outstanding.keys().next();
      if (oldest.done === true) break;
      this.outstanding.delete(oldest.value);
    }
    return ticket;
  }

  /**
   * Spends a ticket against the target the socket is about to bind to.
   *
   * The entry is deleted on presentation rather than on success, so a ticket offered for the wrong
   * target is burnt rather than left for a second guess — that is what makes "single use" a
   * property of the ticket rather than of the happy path.
   *
   * Not a constant-time comparison, and that is deliberate. `LoopbackGuard.isAuthorised` hashes
   * before comparing because the token is long-lived and an attacker can probe it all day; a
   * ticket is 256 random bits that survive one presentation and ten seconds, so there is no
   * repeatable measurement to take. The lookup is keyed on a fixed-length digest either way.
   */
  public redeem(presented: string, target: PtyTarget): boolean {
    const key = fingerprint(presented);
    const issued = this.outstanding.get(key);
    this.outstanding.delete(key);
    if (issued === undefined) return false;
    if (this.clock.now().getTime() > issued.expiresAt) return false;
    return sameTarget(issued.target, target);
  }

  /** Drops every outstanding ticket. Core's shutdown calls it, so none outlives the token. */
  public revokeAll(): void {
    this.outstanding.clear();
  }

  private sweep(): void {
    const now = this.clock.now().getTime();
    for (const [key, issued] of this.outstanding) {
      if (now > issued.expiresAt) this.outstanding.delete(key);
    }
  }
}

function fingerprint(ticket: string): string {
  return createHash('sha256').update(ticket, 'utf8').digest('hex');
}
