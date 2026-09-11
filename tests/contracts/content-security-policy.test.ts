// SEC-UI-1. Every assertion here is a directive that, if it silently disappeared, would leave the
// deck loading and looking correct — which is exactly how P0-T6 lost an afternoon (RESEARCH.md
// F.5.1). A CSP fails quietly in both directions: too strict and the page never hydrates, too
// loose and nothing complains at all.
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, CORE_WEBSOCKET } from '../../contracts/content-security-policy.ts';

const NONCE = 'dGVzdC1ub25jZQ==';

function directive(policy: string, name: string): string {
  const found = policy.split('; ').find((part) => part.startsWith(`${name} `));
  return found ?? '';
}

describe('contentSecurityPolicy', () => {
  const policy = contentSecurityPolicy(NONCE);

  it('carries the request nonce, which is what lets Next hydrate at all', () => {
    expect(directive(policy, 'script-src')).toContain(`'nonce-${NONCE}'`);
  });

  it("keeps 'strict-dynamic', without which Next's chunk loads are refused", () => {
    expect(directive(policy, 'script-src')).toContain("'strict-dynamic'");
  });

  it('never allows inline or eval script, whatever else changes', () => {
    const scriptSrc = directive(policy, 'script-src');
    expect(scriptSrc).not.toContain('unsafe-inline');
    expect(scriptSrc).not.toContain('unsafe-eval');
  });

  it('allows the core WebSocket and nothing else outbound', () => {
    expect(directive(policy, 'connect-src')).toBe(`connect-src 'self' ${CORE_WEBSOCKET}`);
    expect(CORE_WEBSOCKET.startsWith('ws://127.0.0.1')).toBe(true);
  });

  it('pins the directives that have no reason to ever change', () => {
    expect(directive(policy, 'default-src')).toBe("default-src 'self'");
    expect(directive(policy, 'frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive(policy, 'base-uri')).toBe("base-uri 'none'");
    expect(directive(policy, 'object-src')).toBe("object-src 'none'");
  });

  it('allows inline style, because xterm.js writes cursor geometry that way', () => {
    // Called out rather than left implicit: this is the one relaxation in the policy, and a
    // reviewer should meet a reason rather than a surprise.
    expect(directive(policy, 'style-src')).toContain("'unsafe-inline'");
  });

  it('is a single header line — a newline would truncate it silently', () => {
    expect(policy).not.toContain('\n');
    expect(policy.split('; ').length).toBeGreaterThan(8);
  });
});

describe('the development relaxations (RESEARCH.md G.3)', () => {
  const nonce = 'dGVzdC1ub25jZQ==';

  it('production allows neither eval nor the HMR socket', () => {
    const policy = contentSecurityPolicy(nonce);

    expect(policy).not.toContain('unsafe-eval');
    expect(policy).not.toContain('4949');
  });

  it('defaults to the production policy when nothing is passed', () => {
    expect(contentSecurityPolicy(nonce)).toBe(contentSecurityPolicy(nonce, false));
  });

  it('development allows eval, because Next’s dev bundler calls it', () => {
    // Without this the deck renders and never hydrates, and the only clue is a console line.
    expect(contentSecurityPolicy(nonce, true)).toContain("'unsafe-eval'");
  });

  it('development allows the HMR socket on the UI port', () => {
    // `ws:` is a different scheme to the page's own origin, so 'self' does not cover it.
    expect(contentSecurityPolicy(nonce, true)).toContain('ws://127.0.0.1:4949');
  });

  it('relaxes nothing else — the two policies differ only in those directives', () => {
    const production = contentSecurityPolicy(nonce).split('; ');
    const development = contentSecurityPolicy(nonce, true).split('; ');
    const changed = development
      .filter((directive, index) => directive !== production[index])
      .map((directive) => directive.split(' ')[0]);

    expect(changed).toEqual(['script-src', 'connect-src']);
  });

  it('keeps the nonce and strict-dynamic in development', () => {
    const policy = contentSecurityPolicy(nonce, true);

    expect(policy).toContain(`'nonce-${nonce}'`);
    expect(policy).toContain("'strict-dynamic'");
  });
});
