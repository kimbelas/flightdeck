// P2-T1 — the deck's routing posture, asserted where it can be asserted.
//
// The two matchers are Next path patterns whose bodies are plain regular expressions, so these
// tests ask them what they match rather than compare them as strings. A pattern spelled a
// different way but covering the same paths should pass; the same pattern that quietly starts
// covering `_next` should not, because that is the regression — silent both times it happened
// (RESEARCH.md F.6.3 and G.3).
import { describe, expect, it } from 'vitest';
import {
  API_PREFIX,
  CORE_PREFIX,
  CORE_REWRITE,
  DOCUMENT_ROUTES,
  PROXIED_ROUTES,
  SECURITY_HEADERS,
} from '../../contracts/deck-routes.ts';
import { CORE_ORIGIN } from '../../contracts/origins.ts';

function covers(pattern: string, pathname: string): boolean {
  return new RegExp(`^${pattern}$`).test(pathname);
}

function headerValue(key: string): string | undefined {
  return SECURITY_HEADERS.find((header) => header.key === key)?.value;
}

describe('SECURITY_HEADERS (SEC-UI-1)', () => {
  it('sends every header the control names', () => {
    expect(headerValue('X-Frame-Options')).toBe('DENY');
    expect(headerValue('X-Content-Type-Options')).toBe('nosniff');
    expect(headerValue('Referrer-Policy')).toBe('no-referrer');
    expect(headerValue('Permissions-Policy')).toBe('clipboard-read=(self)');
    expect(headerValue('Cache-Control')).toBe('no-store');
  });

  it('does not carry the CSP, which would then be a constant one and would never hydrate', () => {
    // A nonce cannot be a constant, and a `script-src` without one blocks Next's own hydration
    // scripts — the page renders as HTML and the only evidence is a minified React #412 (F.5.1).
    expect(headerValue('Content-Security-Policy')).toBeUndefined();
  });
});

describe('DOCUMENT_ROUTES — what next.config.ts stamps those headers onto', () => {
  it('covers the pages', () => {
    expect(covers(DOCUMENT_ROUTES, '/')).toBe(true);
    expect(covers(DOCUMENT_ROUTES, '/deck')).toBe(true);
  });

  it('leaves the HMR upgrade alone, because response headers break a handshake', () => {
    expect(covers(DOCUMENT_ROUTES, '/_next/hmr')).toBe(false);
    expect(covers(DOCUMENT_ROUTES, '/_next/static/chunks/main.js')).toBe(false);
  });

  it('leaves the stream alone, because `no-store` here would replace its `no-transform`', () => {
    // Twelve events as one chunk at 2.2 s, a 200 OK and nothing in any log (F.6.3).
    expect(covers(DOCUMENT_ROUTES, '/api/stream')).toBe(false);
  });

  it('leaves core’s own answers alone — core sets `no-store` and `nosniff` itself', () => {
    expect(covers(DOCUMENT_ROUTES, '/api/core/sessions')).toBe(false);
  });
});

describe('PROXIED_ROUTES — what proxy.ts runs on', () => {
  it('runs on documents, which are the only things that need a nonce', () => {
    expect(covers(PROXIED_ROUTES, '/deck')).toBe(true);
  });

  it('runs on the leg to core, which is where the bearer is attached', () => {
    expect(covers(PROXIED_ROUTES, '/api/core/sessions')).toBe(true);
  });

  it('never runs on the HMR socket or on a static chunk', () => {
    expect(covers(PROXIED_ROUTES, '/_next/hmr')).toBe(false);
    expect(covers(PROXIED_ROUTES, '/_next/static/chunks/main.js')).toBe(false);
    expect(covers(PROXIED_ROUTES, '/favicon.ico')).toBe(false);
  });
});

describe('CORE_REWRITE — the only route from the page to core (SEC-HTTP-5)', () => {
  it('forwards the core prefix and keeps the rest of the path', () => {
    expect(CORE_REWRITE.source).toBe(`${CORE_PREFIX}:path*`);
    expect(CORE_REWRITE.destination).toBe(`${CORE_ORIGIN}/:path*`);
  });

  it('goes to loopback and nowhere else (SEC-NET-2)', () => {
    expect(CORE_REWRITE.destination).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
  });

  it('sits under the API prefix, so proxy.ts tells the two kinds of route apart', () => {
    // `/api/core/*` is answered by core; everything else under `/api/` is the deck's own handler.
    // A core prefix that stopped starting with the API prefix would send the stream a bearer.
    expect(CORE_PREFIX.startsWith(API_PREFIX)).toBe(true);
    expect(CORE_PREFIX).not.toBe(API_PREFIX);
  });
});
