// The request screen every inbound connection passes — SEC-HTTP-1..5 and SEC-WS-1.
//
// Promoted from scripts/ to core/http/ in P1-T10, deliberately as a move rather than a rewrite:
// P0-T7 proved these exact refusals against a real hostile origin and left 28 tests pinning one
// decision per control id. A fresh implementation would have been a second opinion about settled
// questions. The only behavioural change on promotion is `isAuthorised`, which now hashes before
// comparing — see its JSDoc.
//
// P0-T7's original header follows, because the reasoning is still the reasoning.
//
// P0-T7 — the request screen core will enforce, in one place so the probe tests the real thing.
//
// hook-spike.ts and statusline-spike.ts each grew their own subset of these checks, because each
// only needed the subset its own spike measured. This is the first place that needs all of them
// at once, so it is where the screen becomes a class. P1-T10 turns it into real middleware; the
// shape is deliberately boring so that port is a move, not a rewrite.
//
// Every rejection names the control it came from. A probe that only learned "403" could not tell
// an Origin refusal from a Sec-Fetch-Site refusal, and the whole point of P0-T7 is to say which
// control did the work (SECURITY.md §4: P0 is not done until SEC-HTTP-1..5 and SEC-WS-1 are
// proven by this spike).
import { createHash, timingSafeEqual } from 'node:crypto';

export type ControlId =
  'SEC-HTTP-1' | 'SEC-HTTP-2' | 'SEC-HTTP-3' | 'SEC-HTTP-4' | 'SEC-HTTP-5' | 'SEC-WS-1';

export interface Rejection {
  readonly status: number;
  readonly control: ControlId;
  readonly reason: string;
}

export interface GuardOptions {
  readonly port: number;
  /** The one origin a browser may carry. Anything else is a page in another tab. */
  readonly uiOrigin: string;
  readonly token: string;
  readonly bodyLimitBytes: number;
}

/** Just the request facts the screen looks at, so it can be unit-tested without a socket. */
export interface RequestFacts {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly headers: NodeJS.Dict<string | string[]>;
}

const SAFE_FETCH_SITES: readonly string[] = ['same-origin', 'none'];

/**
 * Screens one loopback request. Returns the rejection, or `undefined` to accept.
 *
 * Fails closed: anything not positively recognised is refused, and the caller replies with a
 * generic body while the detail goes to the local log only (SECURITY.md §3 rule 3).
 */
export class LoopbackGuard {
  private static readonly ALLOWED_HOST_NAMES: readonly string[] = ['127.0.0.1', 'localhost'];

  private readonly options: GuardOptions;

  constructor(options: GuardOptions) {
    this.options = options;
  }

  public get bodyLimitBytes(): number {
    return this.options.bodyLimitBytes;
  }

  private static header(facts: RequestFacts, name: string): string | undefined {
    const value = facts.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }

  /** An HTTP request to a mutating route. Order is deliberate — see `screenUpgrade`. */
  public screenRequest(facts: RequestFacts): Rejection | undefined {
    return (
      this.screenHost(facts) ??
      this.screenContentType(facts) ??
      this.screenOrigin(facts) ??
      this.screenFetchSite(facts) ??
      this.screenToken(facts)
    );
  }

  /**
   * A stream subscription — an SSE `GET`, which carries no body and therefore no Content-Type.
   *
   * `screenRequest` would refuse it 415: SEC-HTTP-4's Content-Type rule is about POST bodies, and
   * demanding a header the request cannot have is a check that only ever fires on the legitimate
   * caller. The other four checks are unchanged, and the Origin rule keeps its "absent is allowed"
   * escape because the deck's stream arrives through the Next rewrite, which is server-to-server
   * and strips Origin exactly as a hook POST has none (RESEARCH.md F.6.4).
   *
   * Content-Type is a real loss and it is worth naming: on a POST it is the backstop that refuses
   * a cross-origin simple request even if the token leaked (RESEARCH.md F.4.3). A GET has no such
   * backstop, so on this route Sec-Fetch-Site and the token are load-bearing alone — which is the
   * reason the token never enters the browser (SEC-HTTP-5, RESEARCH.md F.6.5).
   */
  public screenStream(facts: RequestFacts): Rejection | undefined {
    return (
      this.screenHost(facts) ??
      this.screenOrigin(facts) ??
      this.screenFetchSite(facts) ??
      this.screenToken(facts)
    );
  }

  /**
   * A WebSocket upgrade. Same checks minus Content-Type, which an upgrade does not carry, and
   * with no "absent Origin is allowed" escape: nothing but the deck ever opens a socket, so an
   * upgrade without an Origin is refused even when it presents a valid ticket (SEC-WS-1).
   *
   * The first frame is **not** screened here. It carries a single-use ticket rather than the token
   * (DECISIONS.md D32), and a ticket is redeemed against the socket's bind target by TicketOffice —
   * something a screen that only sees headers cannot do. The method that used to compare the token
   * against the first frame is deleted rather than left unused: a guard that still accepted the
   * token there would quietly re-open what P5a-T2b closed.
   */
  public screenUpgrade(facts: RequestFacts): Rejection | undefined {
    const host = this.screenHost(facts);
    if (host !== undefined) return host;
    if (LoopbackGuard.header(facts, 'origin') !== this.options.uiOrigin) {
      return { status: 1008, control: 'SEC-WS-1', reason: 'origin is not the deck' };
    }
    return this.screenFetchSite(facts);
  }

  /**
   * Constant-time token comparison (SEC-HTTP-3).
   *
   * Both sides are hashed before comparing. The earlier form length-checked first and returned
   * early on a mismatch, which the spike's own comment admitted leaks the length — the escape it
   * was avoiding is `timingSafeEqual` throwing on unequal buffers. Hashing removes the dilemma:
   * every candidate becomes 32 bytes, so there is one code path and one duration whatever arrives.
   */
  public isAuthorised(presentedToken: string): boolean {
    return timingSafeEqual(sha256(presentedToken), sha256(this.options.token));
  }

  public oversize(bytes: number): Rejection {
    return { status: 413, control: 'SEC-HTTP-4', reason: `body over ${String(bytes)} bytes` };
  }

  /** Exact host:port, which is what defeats a rebinding name that resolves to 127.0.0.1. */
  private screenHost(facts: RequestFacts): Rejection | undefined {
    const host = LoopbackGuard.header(facts, 'host') ?? '';
    const allowed = LoopbackGuard.ALLOWED_HOST_NAMES.map(
      (name) => `${name}:${String(this.options.port)}`,
    );
    if (allowed.includes(host)) return undefined;
    return { status: 421, control: 'SEC-HTTP-1', reason: `host ${JSON.stringify(host)}` };
  }

  private screenContentType(facts: RequestFacts): Rejection | undefined {
    const contentType = LoopbackGuard.header(facts, 'content-type') ?? '';
    if (contentType.startsWith('application/json')) return undefined;
    // Forces a preflight for any cross-origin page, and core answers no preflight at all.
    return {
      status: 415,
      control: 'SEC-HTTP-4',
      reason: `content-type ${contentType || '(none)'}`,
    };
  }

  /**
   * A present Origin must be the deck. An absent one is allowed through to the token check —
   * that is the Claude Code hook and statusline path, which has no Origin and authenticates
   * with the token instead (SEC-HTTP-2).
   */
  private screenOrigin(facts: RequestFacts): Rejection | undefined {
    const origin = LoopbackGuard.header(facts, 'origin');
    if (origin === undefined || origin === this.options.uiOrigin) return undefined;
    return { status: 403, control: 'SEC-HTTP-2', reason: `origin ${origin}` };
  }

  private screenFetchSite(facts: RequestFacts): Rejection | undefined {
    const site = LoopbackGuard.header(facts, 'sec-fetch-site');
    if (site === undefined || SAFE_FETCH_SITES.includes(site)) return undefined;
    return { status: 403, control: 'SEC-HTTP-5', reason: `sec-fetch-site ${site}` };
  }

  private screenToken(facts: RequestFacts): Rejection | undefined {
    const header = LoopbackGuard.header(facts, 'authorization') ?? '';
    if (this.isAuthorised(header.replace(/^Bearer\s+/i, ''))) return undefined;
    return { status: 401, control: 'SEC-HTTP-3', reason: 'bearer token absent or wrong' };
  }
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}
