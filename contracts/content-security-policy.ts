// SEC-UI-1 — the policy, built in one place so it can be asserted on.
//
// It lives in contracts/ rather than in middleware.ts because the middleware cannot be imported
// by a test without pulling in `next/server`, and a policy nobody can test is a policy that
// quietly loses a directive. P0-T6 found two ways this breaks in Next, both silent:
// a missing nonce blocks Next's own hydration scripts, and a statically prerendered page cannot
// carry one at all (RESEARCH.md F.5.1).
//
// P5a-T3 found the third, and it is the same shape: **the production policy makes `npm run dev`
// unusable.** Next's dev bundler calls `eval()` and opens an HMR WebSocket on the UI port, and the
// policy refuses both. The page renders, never hydrates, and the only clue is a console line about
// eval (RESEARCH.md G.3). Hence `development` — a parameter rather than an inline `NODE_ENV`
// check, so a test can assert that the production policy never grows these relaxations.

// Re-exported rather than restated: the policy, the rewrite and core's OriginGuard must agree
// about the ports, and contracts/origins.ts is where that agreement is written down.
import { CORE_WEBSOCKET, UI_PORT } from './origins.ts';

export { CORE_WEBSOCKET };

/** Next's dev HMR socket. Same host as the page, but `ws:` is a different scheme to `'self'`. */
const DEV_HMR_WEBSOCKET = `ws://127.0.0.1:${String(UI_PORT)} ws://localhost:${String(UI_PORT)}`;

/**
 * The Content-Security-Policy header value for one request.
 *
 * @param nonce base64 value, fresh per request; Next stamps it onto the scripts it emits.
 * @param development relaxes exactly two directives so the dev server can run — `'unsafe-eval'`
 * and the HMR socket. Never true in a production build; `tests/contracts` fails if it leaks.
 * @throws never — an empty nonce produces a policy that blocks everything, which fails closed.
 */
export function contentSecurityPolicy(nonce: string, development = false): string {
  return [
    "default-src 'self'",
    // `strict-dynamic` is required, not decorative: Next's nonced bootstrap loads further chunks
    // at runtime, and with the nonce alone those loads are refused. It also disables the host
    // allowlist, which is why 'self' no longer covers the chunk requests.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    // xterm.js writes inline styles for cursor and selection geometry and offers no nonce path
    // for them. style-src cannot execute script, so this is not the hole it looks like.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${CORE_WEBSOCKET}${development ? ` ${DEV_HMR_WEBSOCKET}` : ''}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}
