// SEC-UI-1 (the CSP) and SEC-HTTP-3 (the token on the way to core), issued per request.
//
// This file is `proxy.ts`, not `middleware.ts`, and the rename is load-bearing rather than
// cosmetic. Next 16 deprecates the `middleware` convention in favour of `proxy`, and the two do
// not run in the same place: `middleware` is the **edge** runtime, where `node:fs` does not exist
// ("Native module not found: node:fs"), while **proxy always runs on Node.js**. Reading the token
// file is the whole reason the rewrite can carry a bearer token at all, so the convention decides
// the transport (RESEARCH.md F.6.2, DECISIONS.md D27).
//
// The CSP half is P0-T6's finding and unchanged: a static `script-src 'self'` blocks Next's own
// inline hydration scripts, the page renders and never hydrates, and the only evidence is a
// minified React #412. A per-request nonce plus 'strict-dynamic' is the fix, and the two are a
// package (RESEARCH.md F.5.1).
import { NextResponse, type NextRequest } from 'next/server';
import { contentSecurityPolicy } from './contracts/content-security-policy.ts';
import { readCoreToken } from './contracts/core-token.ts';

/** Everything under here is forwarded to core by the rewrite in next.config.ts. */
const CORE_PREFIX = '/api/core/';

export function proxy(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);

  if (request.nextUrl.pathname.startsWith(CORE_PREFIX)) {
    return forwardToCore(headers);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  // Next reads the nonce back off the request header to stamp its own script tags.
  headers.set('x-nonce', nonce);
  const response = NextResponse.next({ request: { headers } });
  // The dev bundler needs eval() and an HMR socket; the production policy grants neither
  // (RESEARCH.md G.3). `next build` sets NODE_ENV=production, so this cannot be on in a build.
  const development = process.env.NODE_ENV !== 'production';
  response.headers.set('Content-Security-Policy', contentSecurityPolicy(nonce, development));
  return response;
}

/**
 * Attaches the bearer token to a request on its way to core, and nothing else.
 *
 * No nonce and no CSP: a CSP on an SSE or JSON response protects nothing, and P0-T8 measured that
 * a response header set here is forwarded to core as a *request* header, so setting one is not
 * free (RESEARCH.md F.6.6).
 *
 * The `delete` is the fail-closed half and is not redundant with the `set`. A script on the deck
 * page can put its own `Authorization` header on a `fetch`; without the delete, a core that is
 * down — no token file — would let that forged header through untouched (SECURITY.md §3 rule 3).
 */
function forwardToCore(headers: Headers): NextResponse {
  const token = readCoreToken();
  if (token === undefined) headers.delete('authorization');
  else headers.set('authorization', `Bearer ${token}`);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Everything under `_next` is excluded, not just static and image. `_next/hmr` is a WebSocket
  // upgrade, and running proxy on it returns a normal HTTP response to a handshake — the browser
  // reports ERR_INVALID_HTTP_RESPONSE and dev reloads never arrive (RESEARCH.md G.3). None of
  // these routes carry an inline script, so none of them needs a per-request nonce.
  matcher: [{ source: '/((?!_next/|favicon.ico).*)' }],
};
