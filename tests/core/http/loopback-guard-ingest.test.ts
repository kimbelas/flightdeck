// SEC-HTTP-7 — the ingest key is accepted on exactly one route and nowhere else.
//
// The point of a second credential is that it buys less than the first. Every test here is about
// what it does NOT open; only two are about what it does.
import { describe, expect, it } from 'vitest';
import { LoopbackGuard, type RequestFacts } from '../../../core/http/loopback-guard.ts';

const TOKEN = 'a'.repeat(64);
const KEY = 'b'.repeat(64);

/**
 * `withoutKey()` is a separate function rather than `guard(undefined)` on purpose: a default
 * parameter treats an explicit `undefined` as "not passed", so the obvious spelling built a guard
 * WITH the key and the test that was meant to prove the absent-key path silently proved nothing.
 */
function guard(): LoopbackGuard {
  return new LoopbackGuard({
    port: 4950,
    uiOrigin: 'http://127.0.0.1:4949',
    token: TOKEN,
    ingestKey: KEY,
    bodyLimitBytes: 65536,
  });
}

function withoutKey(): LoopbackGuard {
  return new LoopbackGuard({
    port: 4950,
    uiOrigin: 'http://127.0.0.1:4949',
    token: TOKEN,
    bodyLimitBytes: 65536,
  });
}

function post(authorization: string): RequestFacts {
  return {
    method: 'POST',
    url: '/hooks',
    headers: { host: '127.0.0.1:4950', 'content-type': 'application/json', authorization },
  };
}

describe('LoopbackGuard ingest credentials', () => {
  it('accepts the ingest key on a route that declares token-or-ingest-key', () => {
    expect(guard().screenRequest(post(`Bearer ${KEY}`), 'token-or-ingest-key')).toBeUndefined();
  });

  it('still accepts the token there — the key widens, it does not replace', () => {
    expect(guard().screenRequest(post(`Bearer ${TOKEN}`), 'token-or-ingest-key')).toBeUndefined();
  });

  it('refuses the ingest key on a token-only route, naming SEC-HTTP-3', () => {
    const rejection = guard().screenRequest(post(`Bearer ${KEY}`), 'token');

    expect(rejection?.status).toBe(401);
    expect(rejection?.control).toBe('SEC-HTTP-3');
  });

  it('defaults to token-only when no credential is passed, so a forgetful caller fails closed', () => {
    expect(guard().screenRequest(post(`Bearer ${KEY}`))?.status).toBe(401);
  });

  it('refuses the ingest key on a stream, where the token is load-bearing alone (F.6.5)', () => {
    const stream: RequestFacts = {
      method: 'GET',
      url: '/stream',
      headers: { host: '127.0.0.1:4950', authorization: `Bearer ${KEY}` },
    };

    expect(guard().screenStream(stream)?.status).toBe(401);
  });

  it('refuses a wrong secret on the ingest route, naming SEC-HTTP-7', () => {
    const rejection = guard().screenRequest(post('Bearer wrong'), 'token-or-ingest-key');

    expect(rejection?.status).toBe(401);
    expect(rejection?.control).toBe('SEC-HTTP-7');
  });

  it('refuses an absent Authorization header on the ingest route', () => {
    const facts: RequestFacts = {
      method: 'POST',
      url: '/hooks',
      headers: { host: '127.0.0.1:4950', 'content-type': 'application/json' },
    };

    expect(guard().screenRequest(facts, 'token-or-ingest-key')?.status).toBe(401);
  });

  it('a core with NO ingest key refuses every ingest credential rather than accepting any', () => {
    const none = withoutKey();

    expect(none.screenRequest(post('Bearer '), 'token-or-ingest-key')?.status).toBe(401);
    expect(none.screenRequest(post(`Bearer ${KEY}`), 'token-or-ingest-key')?.status).toBe(401);
    // The token still works — a missing ingest key disables the second credential, not the first.
    expect(none.screenRequest(post(`Bearer ${TOKEN}`), 'token-or-ingest-key')).toBeUndefined();
  });

  it('the empty string is not a credential, with or without a key configured', () => {
    expect(guard().screenRequest(post(''), 'token-or-ingest-key')?.status).toBe(401);
    expect(withoutKey().screenRequest(post(''), 'token-or-ingest-key')?.status).toBe(401);
  });

  it('the ingest key does not skip the earlier screens — a bad Host is still 421', () => {
    const rebinding: RequestFacts = {
      method: 'POST',
      url: '/hooks',
      headers: {
        host: 'evil.example.com:4950',
        'content-type': 'application/json',
        authorization: `Bearer ${KEY}`,
      },
    };

    const rejection = guard().screenRequest(rebinding, 'token-or-ingest-key');
    expect(rejection?.status).toBe(421);
    expect(rejection?.control).toBe('SEC-HTTP-1');
  });

  it('a hostile Origin is still refused even with a valid ingest key', () => {
    const hostile: RequestFacts = {
      method: 'POST',
      url: '/hooks',
      headers: {
        host: '127.0.0.1:4950',
        'content-type': 'application/json',
        origin: 'http://evil.example.com',
        authorization: `Bearer ${KEY}`,
      },
    };

    expect(guard().screenRequest(hostile, 'token-or-ingest-key')?.control).toBe('SEC-HTTP-2');
  });
});
