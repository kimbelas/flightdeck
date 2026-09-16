// The claims in SECURITY.md that only a browser can settle.
//
// A unit test can prove that `attachCoreToken` sets a header and that the socket refuses a token.
// It cannot prove the negative that matters — that the per-boot token appears in NOTHING the page
// was handed — because that is a statement about every byte of every response, and only something
// holding the responses can make it (P5a-T2b, D32).
//
// Two of these checks exist so the others are not vacuous. If the fixture core answered without a
// bearer, "the token is not in the browser" would be true of a system where the token meant
// nothing; so the first proves core refuses an unauthenticated request. And if `proxy.ts` merely
// ADDED a header, a script on the page could still send its own; so the second proves the
// `delete`-then-`set` in `attachCoreToken` is what core actually sees (SECURITY.md §3 rule 3).
import { CORE_ORIGIN, CORE_WEBSOCKET } from '../../../contracts/origins.ts';
import { CORE_SESSIONS_PATH } from '../../../contracts/deck-routes.ts';
import { DECK_STREAM_PATH } from '../../../contracts/stream-event.ts';

export async function securityChecks(page, report, core, seen) {
  report.group('The token, the policy, and what the page was allowed to hold');
  await screeningChecks(page, report, core);
  await tokenChecks(page, report, core, seen.served);
  policyChecks(report, seen);
}

async function screeningChecks(page, report, core) {
  const bare = await fetch(`${CORE_ORIGIN}/sessions`).catch(() => undefined);
  report.check(
    'core refuses a request with no bearer, so the checks below are not vacuous',
    bare?.status === 401,
    `status ${String(bare?.status)}`,
  );

  // Driven from the page rather than from Node on purpose: the point is that `proxy.ts` sits
  // between a script on the deck and core, and takes off whatever Authorization was there.
  const before = core.requests.length;
  await page.evaluate(
    (path) => fetch(path, { headers: { authorization: 'Bearer forged-by-the-page' } }),
    CORE_SESSIONS_PATH,
  );
  const forged = core.requests.slice(before).find((request) => request.path === '/sessions');
  report.check(
    'a forged Authorization header from the page is replaced, not forwarded',
    forged?.bearer === `Bearer ${core.token}`,
    forged === undefined ? 'core saw no request at all' : 'core saw the real token',
  );
}

async function tokenChecks(page, report, core, served) {
  const leaked = served.filter((response) => response.body.includes(core.token));
  report.check(
    'the per-boot token appears in NOTHING the page was served',
    leaked.length === 0,
    leaked.length === 0
      ? `${String(served.length)} responses searched`
      : leaked.map((response) => response.url).join(' | '),
  );

  const inDom = await page.evaluate(
    (token) => document.documentElement.outerHTML.includes(token),
    core.token,
  );
  report.check('and it is not in the rendered DOM', inDom === false);

  const gone = await page.evaluate(() => fetch('/api/pty-token').then((reply) => reply.status));
  report.check(
    'the route that used to hand it over is gone (D32)',
    gone === 404,
    `status ${String(gone)}`,
  );

  const mints = served.filter((response) => response.url.endsWith('/api/core/pty-ticket'));
  report.check(
    'the pane got a single-use ticket instead',
    mints.length > 0 && mints.every((response) => response.status === 201),
    `${String(mints.length)} mints`,
  );
}

function policyChecks(report, seen) {
  const deck = seen.served.find((response) => response.url.endsWith('/deck'));
  const policy = deck?.headers['content-security-policy'] ?? '';
  const directives = new Map(
    policy.split('; ').map((directive) => [directive.split(' ')[0], directive]),
  );

  report.check('the document carries a CSP', policy !== '');
  report.check(
    'with a per-request nonce and strict-dynamic, which is what lets Next hydrate at all (F.5.1)',
    /'nonce-[^']+' 'strict-dynamic'/u.test(directives.get('script-src') ?? ''),
  );
  report.check(
    "and without 'unsafe-eval', which only the dev bundler ever needed (G.3)",
    !policy.includes('unsafe-eval'),
  );
  report.check(
    'the PTY socket is the only origin connect-src admits beyond self',
    directives.get('connect-src') === `connect-src 'self' ${CORE_WEBSOCKET}`,
    directives.get('connect-src'),
  );
  report.check(
    'the constant document headers are on it (SEC-UI-1)',
    deck?.headers['x-frame-options'] === 'DENY' &&
      deck.headers['x-content-type-options'] === 'nosniff' &&
      deck.headers['referrer-policy'] === 'no-referrer',
  );

  const stream = seen.served.find((response) => response.url.endsWith(DECK_STREAM_PATH));
  report.check(
    'the event stream kept its no-transform, so nothing gzips it into one chunk (F.6.3)',
    (stream?.headers['cache-control'] ?? '').includes('no-transform'),
    stream?.headers['cache-control'],
  );

  report.check(
    'no CSP violation and no page error in the whole run',
    seen.problems.length === 0,
    seen.problems.join(' | '),
  );
}
