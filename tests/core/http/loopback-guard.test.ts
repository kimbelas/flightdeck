// One test per control id, which SECURITY.md §3 rule 6 asks for.
//
// scripts/security-probe-cli.ts proves these against a real browser and a real socket; this file
// pins the same decisions as fast unit tests so a regression shows up in `npm run check` rather
// than only when someone remembers to run the probe. The pair matters: the probe proves the
// controls hold against Chromium, these tests prove the *reasons* stay attached to the right
// control id, which is what the probe's report is built out of.
import { describe, expect, it } from 'vitest';
import { LoopbackGuard, type RequestFacts } from '../../../core/http/loopback-guard.ts';

const TOKEN = 'a'.repeat(64);
const DECK = 'http://127.0.0.1:4949';

const guard = new LoopbackGuard({
  port: 4950,
  uiOrigin: DECK,
  token: TOKEN,
  bodyLimitBytes: 64 * 1024,
});

function request(headers: Record<string, string>): RequestFacts {
  return {
    method: 'POST',
    url: '/probe',
    headers: { host: '127.0.0.1:4950', 'content-type': 'application/json', ...headers },
  };
}

/** Everything a legitimate hook POST carries: right host, JSON, token, no Origin at all. */
const HOOK_POST = request({ authorization: `Bearer ${TOKEN}` });

describe('LoopbackGuard', () => {
  it('accepts the hook path — right host, JSON, token, no Origin', () => {
    expect(guard.screenRequest(HOOK_POST)).toBeUndefined();
  });

  describe('SEC-HTTP-1 — Host', () => {
    it.each(['flightdeck.evil.test', '127.0.0.1:1234', '0.0.0.0:4950', ''])(
      'rejects host %s',
      (host) => {
        const outcome = guard.screenRequest(request({ host, authorization: `Bearer ${TOKEN}` }));
        expect(outcome).toMatchObject({ status: 421, control: 'SEC-HTTP-1' });
      },
    );

    it('accepts both spellings of loopback on the right port', () => {
      for (const host of ['127.0.0.1:4950', 'localhost:4950']) {
        expect(
          guard.screenRequest(request({ host, authorization: `Bearer ${TOKEN}` })),
        ).toBeUndefined();
      }
    });
  });

  describe('SEC-HTTP-2 — Origin', () => {
    it('rejects a present Origin that is not the deck', () => {
      const facts = request({ origin: 'http://evil.test', authorization: `Bearer ${TOKEN}` });
      expect(guard.screenRequest(facts)).toMatchObject({ status: 403, control: 'SEC-HTTP-2' });
    });

    it('rejects a same-host Origin on a different port — a port is part of an origin', () => {
      const facts = request({ origin: 'http://127.0.0.1:5999', authorization: `Bearer ${TOKEN}` });
      expect(guard.screenRequest(facts)).toMatchObject({ status: 403, control: 'SEC-HTTP-2' });
    });

    it('accepts the deck origin', () => {
      const facts = request({ origin: DECK, authorization: `Bearer ${TOKEN}` });
      expect(guard.screenRequest(facts)).toBeUndefined();
    });
  });

  describe('SEC-HTTP-3 — bearer token', () => {
    it('rejects an absent token', () => {
      expect(guard.screenRequest(request({}))).toMatchObject({
        status: 401,
        control: 'SEC-HTTP-3',
      });
    });

    it('rejects a wrong token of the same length', () => {
      const facts = request({ authorization: `Bearer ${'b'.repeat(64)}` });
      expect(guard.screenRequest(facts)).toMatchObject({ status: 401, control: 'SEC-HTTP-3' });
    });

    it('rejects a wrong length without throwing — timingSafeEqual would', () => {
      expect(() => guard.isAuthorised('short')).not.toThrow();
      expect(guard.isAuthorised('short')).toBe(false);
    });
  });

  describe('SEC-HTTP-4 — Content-Type and body limit', () => {
    it('rejects anything but application/json, which is what forces a preflight', () => {
      const facts = request({ 'content-type': 'text/plain', authorization: `Bearer ${TOKEN}` });
      expect(facts.headers['content-type']).toBe('text/plain');
      expect(guard.screenRequest(facts)).toMatchObject({ status: 415, control: 'SEC-HTTP-4' });
    });

    it('rejects a preflight, which arrives with no Content-Type at all', () => {
      const facts: RequestFacts = {
        method: 'OPTIONS',
        url: '/probe',
        headers: { host: '127.0.0.1:4950' },
      };
      expect(guard.screenRequest(facts)).toMatchObject({ status: 415, control: 'SEC-HTTP-4' });
    });

    it('accepts a charset parameter on the content type', () => {
      const facts = request({
        'content-type': 'application/json; charset=utf-8',
        authorization: `Bearer ${TOKEN}`,
      });
      expect(guard.screenRequest(facts)).toBeUndefined();
    });

    it('reports an oversize body as 413 against the same control', () => {
      expect(guard.oversize(guard.bodyLimitBytes)).toMatchObject({
        status: 413,
        control: 'SEC-HTTP-4',
      });
    });
  });

  describe('SEC-HTTP-5 — Sec-Fetch-Site', () => {
    it.each(['cross-site', 'same-site'])('rejects %s', (site) => {
      const facts = request({ 'sec-fetch-site': site, authorization: `Bearer ${TOKEN}` });
      expect(guard.screenRequest(facts)).toMatchObject({ status: 403, control: 'SEC-HTTP-5' });
    });

    it.each(['same-origin', 'none'])('accepts %s', (site) => {
      const facts = request({ 'sec-fetch-site': site, authorization: `Bearer ${TOKEN}` });
      expect(guard.screenRequest(facts)).toBeUndefined();
    });
  });

  describe('the stream GET — screenStream', () => {
    /** Exactly what the Next rewrite forwards: no Origin, no Content-Type, token attached. */
    function stream(headers: Record<string, string>): RequestFacts {
      return {
        method: 'GET',
        url: '/stream',
        headers: { host: '127.0.0.1:4950', ...headers },
      };
    }

    it('accepts the rewrite path — no Origin, no Content-Type, token attached by proxy.ts', () => {
      expect(guard.screenStream(stream({ authorization: `Bearer ${TOKEN}` }))).toBeUndefined();
    });

    it('accepts a browser stream forwarded with Sec-Fetch-Site: same-origin', () => {
      const facts = stream({
        authorization: `Bearer ${TOKEN}`,
        'sec-fetch-site': 'same-origin',
        accept: 'text/event-stream',
      });
      expect(guard.screenStream(facts)).toBeUndefined();
    });

    it('would be refused 415 by screenRequest — the reason this method exists', () => {
      const facts = stream({ authorization: `Bearer ${TOKEN}` });
      expect(guard.screenRequest(facts)).toMatchObject({ status: 415, control: 'SEC-HTTP-4' });
      expect(guard.screenStream(facts)).toBeUndefined();
    });

    it('still refuses a forged Host (SEC-HTTP-1)', () => {
      const facts = stream({ host: 'flightdeck.evil.test', authorization: `Bearer ${TOKEN}` });
      expect(guard.screenStream(facts)).toMatchObject({ status: 421, control: 'SEC-HTTP-1' });
    });

    it('still refuses a hostile Origin (SEC-HTTP-2)', () => {
      const facts = stream({ origin: 'http://127.0.0.1:5999', authorization: `Bearer ${TOKEN}` });
      expect(guard.screenStream(facts)).toMatchObject({ status: 403, control: 'SEC-HTTP-2' });
    });

    it.each(['cross-site', 'same-site'])('still refuses Sec-Fetch-Site %s (SEC-HTTP-5)', (site) => {
      const facts = stream({ 'sec-fetch-site': site, authorization: `Bearer ${TOKEN}` });
      expect(guard.screenStream(facts)).toMatchObject({ status: 403, control: 'SEC-HTTP-5' });
    });

    it('still requires the token (SEC-HTTP-3)', () => {
      expect(guard.screenStream(stream({}))).toMatchObject({
        status: 401,
        control: 'SEC-HTTP-3',
      });
    });

    it('refuses a tag-shaped GET: no Origin, no token, cross-site — the img src vector', () => {
      // <img src="http://127.0.0.1:4950/stream"> from a hostile page sends no Origin at all, so
      // Sec-Fetch-Site is the check that has to fire. Content-Type cannot help on a GET
      // (RESEARCH.md F.6.5).
      const facts = stream({ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' });
      expect(guard.screenStream(facts)).toMatchObject({ status: 403, control: 'SEC-HTTP-5' });
    });
  });

  // The first frame is NOT here any more: it carries a single-use ticket redeemed by TicketOffice
  // against the socket's bind target, not the token (DECISIONS.md D32). Its tests live in
  // tests/core/application/ticket-office.test.ts and the socket suite.
  describe('SEC-WS-1 — the upgrade', () => {
    function upgrade(headers: Record<string, string>): RequestFacts {
      return { method: 'GET', url: '/pty', headers: { host: '127.0.0.1:4950', ...headers } };
    }

    it('rejects an upgrade with no Origin even when the token is right', () => {
      // Unlike an HTTP POST, a missing Origin is no excuse here: nothing but the deck opens a
      // socket, so there is no hook path to make room for.
      expect(guard.screenUpgrade(upgrade({ authorization: `Bearer ${TOKEN}` }))).toMatchObject({
        status: 1008,
        control: 'SEC-WS-1',
      });
    });

    it('rejects an upgrade from a hostile origin', () => {
      expect(guard.screenUpgrade(upgrade({ origin: 'http://127.0.0.1:5999' }))).toMatchObject({
        status: 1008,
        control: 'SEC-WS-1',
      });
    });

    it('accepts an upgrade from the deck — the browser sends no token in a handshake', () => {
      expect(guard.screenUpgrade(upgrade({ origin: DECK }))).toBeUndefined();
    });
  });
});
