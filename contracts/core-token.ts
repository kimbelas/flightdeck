// SEC-HTTP-3 — where the per-boot bearer token lives, and the only place the deck reads it.
//
// It sits in contracts/ for the same mechanical reason content-security-policy.ts does: that is
// the only folder both TypeScript projects compile, and proxy.ts (the app project) and the SSE
// producer (the Node project) both need the same answer about where the token is.
//
// **Server-only.** It touches node:fs, so nothing under a 'use client' boundary may import it.
// That much is still a hard rule.
//
// **The token has no reason to be in the browser, and it is not.** That claim was suspended for
// one slice — a WebSocket handshake cannot carry a header, so D31 shipped the token to the page for
// the first frame — and P5a-T2b restored it: the socket takes a single-use ticket minted by
// `POST /pty-ticket`, and `app/api/pty-token/route.ts` is deleted (DECISIONS.md D32).
//
// Every reader of this file is now server-side: `proxy.ts` attaching the bearer to the rewrite, and
// the SSE route doing the same for its upstream leg. Nothing under a 'use client' boundary imports
// it, and nothing may — which is a stronger rule than "it touches node:fs" implies.
//
// Why it matters that this holds: P0-T8 measured that the stream carries no Content-Type backstop,
// which makes a leaked token worth more to an attacker on GET than on POST (RESEARCH.md F.6.5).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Written by core at start with an ACL for the current user only (SEC-HTTP-3, SEC-FS-4). */
export function coreTokenFile(): string {
  const override = process.env['FD_TOKEN_FILE'];
  if (override !== undefined && override !== '') return override;
  return join(process.env['LOCALAPPDATA'] ?? process.cwd(), 'flightdeck', 'token');
}

/**
 * The current token, or `undefined` when core is not running.
 *
 * Read on every call rather than cached: the token is per boot and `Rotate token` (SEC-OPS-2)
 * changes it while the deck stays up, so a cached value would authenticate to a core that no
 * longer exists. The file is small and the OS caches it; this is not the hot path.
 *
 * Absence is not an error — core being down is an ordinary state (RESEARCH.md F.3.3) — so this
 * returns `undefined` rather than throwing, and every caller fails closed on it.
 */
export function readCoreToken(): string | undefined {
  try {
    // turbopackIgnore: the path is decided at runtime, and without this Turbopack traces the
    // whole project into the server bundle rather than admit it cannot know the file.
    const token = readFileSync(/* turbopackIgnore: true */ coreTokenFile(), 'utf8').trim();
    return token === '' ? undefined : token;
  } catch {
    return undefined;
  }
}
