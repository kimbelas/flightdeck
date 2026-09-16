// Which deck routes get what — the constant security headers, the two matchers, and the one
// rewrite that reaches core (P2-T1, SEC-UI-1 and SEC-HTTP-5).
//
// It is here rather than inline in `next.config.ts` and `proxy.ts` for the reason
// content-security-policy.ts is: contracts/ is the only folder both TypeScript projects compile,
// and a value that lives in a Next file cannot be asserted on without dragging `next/server` —
// and with it Next's global type augmentation — into the project core/ and scripts/ are checked
// by. That leak is exactly what tsconfig.app.json exists to stop, so the values come out and the
// Next files keep only the wiring.
//
// **Every regression these pin is silent, and two have already happened.** `Cache-Control:
// no-store` from `headers()` REPLACES a route handler's own, and once overwrote the stream's
// `no-transform` — the single header that stops Next gzipping an event stream into one chunk at
// the end (RESEARCH.md F.6.3). Stamping headers onto `_next` breaks the HMR upgrade with
// ERR_INVALID_HTTP_RESPONSE and the dev page never hydrates (G.3). Both kept the build green and
// the response 200.
import { CORE_ORIGIN } from './origins.ts';

export interface SecurityHeader {
  readonly key: string;
  readonly value: string;
}

/** The headers that are the same on every document. The CSP is not among them — it needs a nonce. */
export const SECURITY_HEADERS: readonly SecurityHeader[] = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'clipboard-read=(self)' },
  { key: 'Cache-Control', value: 'no-store' },
];

/**
 * Which paths `next.config.ts` stamps `SECURITY_HEADERS` onto.
 *
 * Not `/:path*`. Nothing under `_next` is a document and neither is anything under `api/`:
 * `/api/core/*` is answered by core, which sets its own `no-store` and `nosniff`, and `/api/stream`
 * sets its own — including the `no-transform` this rule would replace.
 *
 * A Next path pattern whose body is a plain regular expression, so a test can ask it what it
 * matches rather than compare it as a string.
 */
export const DOCUMENT_ROUTES = '/((?!_next|api/).*)';

/**
 * Which paths `proxy.ts` runs on.
 *
 * Everything under `_next` is excluded, not just static and image: `_next/hmr` is a WebSocket
 * upgrade, and returning a normal HTTP response to a handshake makes the browser report
 * ERR_INVALID_HTTP_RESPONSE and dev reloads never arrive (RESEARCH.md G.3). None of the excluded
 * routes carries an inline script, so none of them needs a nonce.
 */
export const PROXIED_ROUTES = '/((?!_next/|favicon.ico).*)';

/** Everything under here is forwarded to core by the rewrite, with a bearer attached on the way. */
export const CORE_PREFIX = '/api/core/';

/** Everything under here is answered by a route handler in the deck — today, `/api/stream`. */
export const API_PREFIX = '/api/';

/**
 * The only route from the browser to core.
 *
 * Server-to-server, so no CORS is involved and the token never reaches the page (SEC-HTTP-5). It
 * is not a convenience: a page on :4949 cannot fetch :4950 directly at all, because a port is part
 * of an origin — JSON triggers a preflight core never answers, and a simple request arrives as
 * `Sec-Fetch-Site: same-site` and is refused (RESEARCH.md F.4.2).
 */
export const CORE_REWRITE = {
  source: `${CORE_PREFIX}:path*`,
  destination: `${CORE_ORIGIN}/:path*`,
} as const;

/**
 * The deck's one core route today: `GET` for the whole picture, `POST` to start a session.
 *
 * Spelled relative to `CORE_PREFIX` so it cannot drift out from under the rewrite. The stream is
 * deliberately not here — it is `DECK_STREAM_PATH` in stream-event.ts, because it is answered by
 * a route handler in the deck rather than forwarded to core (D27).
 */
export const CORE_SESSIONS_PATH = `${CORE_PREFIX}sessions`;

/**
 * One session's detail, for an expanded row — P2-T4.
 *
 * A second core route, and the first one the deck calls with parameters. They ride the query string
 * rather than the path because `RequestRouter` matches literally and deliberately has no path
 * parameters; `contracts/session-ref.ts` owns the spelling of the three, so neither end can drift.
 *
 * It is a REQUEST and not a frame, unlike everything else the deck learns. The rows are the picture
 * of the machine and belong on the stream; a detail is one session, asked for by a person who just
 * clicked, and pushing every expansion's worth of model text to every open deck would be sending
 * SEC-UI-2 material nobody is looking at.
 */
export const CORE_SESSION_PATH = `${CORE_PREFIX}session`;

/**
 * The project registry — `GET` to list it, `POST` to import a folder (P3-T1, DECISIONS.md D26).
 *
 * A request rather than a stream frame, like the session detail and for a related reason: the
 * registry changes only when a person imports something, and that is the same person looking at
 * the answer. Nothing else on the machine can move it, so there is nothing to push.
 */
export const CORE_PROJECTS_PATH = `${CORE_PREFIX}projects`;

/**
 * Withdrawing one — `POST`, at its own literal path.
 *
 * Spelled here rather than composed from `CORE_PROJECTS_PATH` at the call site so that the deck and
 * `ForgetProjectRoute` cannot drift apart, which is this file's whole job. It is a verb in a URL
 * because `RequestRouter` matches paths literally and has no `DELETE` handling to reach for — see
 * that route's header for why that trade is the right way round.
 */
export const CORE_PROJECT_FORGET_PATH = `${CORE_PROJECTS_PATH}/forget`;
