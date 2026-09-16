// What `npm run smoke -- --dev` proves that the production run cannot — P2-T6b.
//
// RESEARCH.md G.3 is the most expensive silent failure this project has had: under `next dev` the
// deck rendered server-side and never hydrated, so no button worked and no fetch was issued, and
// the page looked completely normal. It cost a fortnight of "editing the deck means rebuilding",
// and `npm run dev` was documented as misleading rather than useful. Nothing would have noticed it
// coming back.
//
// The deck hydrates under `next dev` again (G.23). **The checks that prove it are not in this file
// — they are `deckChecks`, `keyboardChecks` and `paneChecks`, run unchanged against the dev
// server**, because "it hydrates" is not a special dev assertion: it is the ordinary suite
// passing. A green run here means the same 74 checks that pass against the production build also
// pass against `next dev`.
//
// What IS here is the part that would otherwise make that green meaningless.
//
// **A `--dev` run has to prove it was a dev run.** If the flag were ever dropped, mis-spelled, or
// `NODE_ENV` leaked through as `production`, this file would run against a production server and
// pass — reporting that `next dev` hydrates on the strength of a build. So the first two checks
// assert the two relaxations `contentSecurityPolicy(nonce, true)` grants and the production policy
// is separately tested never to have. They are the inverse of `securityChecks`, deliberately: a
// policy WITHOUT `'unsafe-eval'` is a failure in this mode.
import { CORE_WEBSOCKET, UI_PORT } from '../../../contracts/origins.ts';

export function devChecks(report, seen) {
  report.group('The dev server — P2-T6b, the half a production run cannot see');

  const deck = seen.served.find((response) => response.url.endsWith('/deck'));
  const policy = deck?.headers['content-security-policy'] ?? '';
  const directives = new Map(
    policy.split('; ').map((directive) => [directive.split(' ')[0], directive]),
  );

  report.check(
    "this really was the dev server: the policy carries 'unsafe-eval'",
    policy.includes("'unsafe-eval'"),
    policy === '' ? 'no CSP on the document at all' : 'dev policy',
  );
  report.check(
    'and the HMR origin, which the production policy is tested never to have',
    (directives.get('connect-src') ?? '').includes(`ws://127.0.0.1:${String(UI_PORT)}`),
    directives.get('connect-src'),
  );

  // G.3's exact remaining symptom: `ws://127.0.0.1:4949/_next/hmr` answered with an ordinary HTTP
  // response, ERR_INVALID_HTTP_RESPONSE on every retry. An upgrade that never became a socket
  // raises no `websocket` event at all, so this is the measurement rather than a proxy for it.
  const hmr = seen.sockets.filter((url) => url.includes('/_next/hmr'));
  report.check(
    'the HMR upgrade became a socket rather than an HTTP response (G.3)',
    hmr.length > 0,
    hmr[0] ?? seen.sockets.join(' | '),
  );
  report.check(
    'the PTY socket still opened alongside it',
    seen.sockets.some((url) => url.startsWith(CORE_WEBSOCKET)),
  );

  // Kept last, as in the production group: under dev the bundler is noisy, and a CSP refusal or a
  // page error here is exactly how G.3 presented — everything renders, one console line explains it,
  // nobody is reading the console.
  report.check(
    'no CSP violation and no page error in the whole run',
    seen.problems.length === 0,
    seen.problems.join(' | '),
  );
}
