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
//
// **Everything this file decides lives in contracts/, and only the wiring is here** — the routes
// in deck-routes.ts, the policy and its nonce in content-security-policy.ts, the bearer in
// core-token.ts. Not tidiness: a test that imported this file would pull `next/server`, and with
// it Next's global type augmentation, into the project core/ and scripts/ are checked by.
import { NextResponse, type NextRequest } from 'next/server';
import { contentSecurityPolicy, newNonce } from './contracts/content-security-policy.ts';
import { attachCoreToken, readCoreToken } from './contracts/core-token.ts';
import { API_PREFIX, CORE_PREFIX } from './contracts/deck-routes.ts';

export function proxy(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  const { pathname } = request.nextUrl;

  if (pathname.startsWith(CORE_PREFIX)) {
    // No nonce and no CSP on this leg: a CSP on a JSON response protects nothing, and P0-T8
    // measured that a response header set here is forwarded to core as a *request* header
    // (RESEARCH.md F.6.6). Harmless for a CSP, not harmless as a habit.
    attachCoreToken(headers, readCoreToken());
    return NextResponse.next({ request: { headers } });
  }
  // Same argument for the deck's own routes — today `/api/stream`, which is an event stream. The
  // habit is that only documents get a policy.
  if (pathname.startsWith(API_PREFIX)) {
    return NextResponse.next();
  }

  const nonce = newNonce();
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
 * Which paths this file runs on — and the one value in it that CANNOT come from contracts/.
 *
 * Next parses `config` out of the source at build time rather than evaluating it, so an imported
 * constant here is not a constant to it: `next build` fails with "Missing `source` in `matcher[0]`
 * object" and "`source` in `matcher[0]` object must be a string". A literal it is, therefore —
 * found by building, not by testing, which is the §G lesson again.
 *
 * It must equal `PROXIED_ROUTES`, and `tests/app/proxy-matcher.test.ts` reads this file as text to
 * check that it does. Reading the source is the right level: the source is what Next reads too.
 */
export const config = { matcher: [{ source: '/((?!_next/|favicon.ico).*)' }] };
