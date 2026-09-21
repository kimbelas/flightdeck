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
/** Waking a stopped background session — P4-T2a. Its own path, matching core's route table. */
export const CORE_RESUME_PATH = `${CORE_PREFIX}sessions/resume`;
/** Stopping one without deleting it — P4-T2b. It keeps the session; `CORE_REMOVE_PATH` does not. */
export const CORE_STOP_PATH = `${CORE_PREFIX}sessions/stop`;

/**
 * DELETING one, conversation and all — P4-T2.
 *
 * Its own literal path rather than a field on the stop body, and that is a control rather than
 * tidiness: the two verbs are one character apart in English and permanent versus undoable in
 * effect, so they are two rows in the table that says what is reachable. The confirm step lives in
 * the deck (`SessionRowCard`); what this spelling buys is that nothing reaches the destructive
 * route by a body field somebody got wrong.
 */
export const CORE_REMOVE_PATH = `${CORE_PREFIX}sessions/rm`;

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
 * What one session looks like when it cannot be given a terminal — P5a-T4.
 *
 * Its own path rather than a field on `CORE_SESSION_PATH`, and the reason is cost rather than
 * tidiness. A detail is two small file reads; a preview spawns `claude logs`, which takes 2.7 s
 * warm and answers with 330 KB (RESEARCH.md F.2.5, G.34). Folding it into the detail would make
 * every expanded row pay that, which is what F.2.5's "never poll it" forbids — so it is asked for
 * by its own click.
 */
export const CORE_PREVIEW_PATH = `${CORE_PREFIX}preview`;

/**
 * Ask — one headless question, accepted here and answered on the stream (P4-T4, D48).
 *
 * The one POST in this file whose reply is not the outcome. It answers 202 and a run id in
 * milliseconds; the records arrive as `ask` frames beside `snapshot` and `quota`, because the deck
 * has had exactly one live feed since P1-T9 and a panel is not a reason for a second. A run
 * therefore survives the tab being reloaded, which a response body could not.
 */
export const CORE_RUN_PATH = `${CORE_PREFIX}run`;

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

/**
 * What each imported folder looks like right now — `GET`, P3-T2.
 *
 * Its own path rather than a field on `CORE_PROJECTS_PATH`'s answer, because the two have
 * different costs and different lifetimes. Listing the registry opens nothing and is read from
 * memory; this one stats a git directory and may spawn `git`, and a panel that paid for that every
 * time it redrew the list of folders would be the wrong trade for a list that changes when a
 * person types in a box.
 *
 * All of them in one request rather than one request per project: the deck draws every row at
 * once, core caches each project's reading separately anyway, and N round trips through the
 * rewrite for a list of four would be three more than are needed.
 */
export const CORE_PROJECT_STATUS_PATH = `${CORE_PROJECTS_PATH}/status`;

/**
 * What Claude is configured to do in each imported folder — `GET`, P3-T3.
 *
 * A third project route for the reason there is a second: the three cost different things.
 * Listing the registry opens nothing, a status may spawn `git`, and a map is a directory listing
 * per asset kind plus a head read per asset. Core holds a map for five minutes because almost
 * nothing moves one, so the deck may ask whenever it draws the panel.
 */
export const CORE_PROJECT_MAP_PATH = `${CORE_PROJECTS_PATH}/map`;

/**
 * The named ways to start a session in each imported folder — `GET` to read, `POST` to save one.
 *
 * A fourth project route, and the cheapest of the four: it opens nothing and spawns nothing. The
 * list is the registry's four built-ins per folder merged with whatever the owner saved
 * (`PresetBook`), so it moves only when somebody imports, forgets or saves — which is why it is a
 * request and not a stream frame, exactly as the registry itself is.
 */
export const CORE_PRESETS_PATH = `${CORE_PROJECTS_PATH}/presets`;

/**
 * Removing one saved preset — `POST`, at its own literal path.
 *
 * Spelled here rather than composed at the call site, for `CORE_PROJECT_FORGET_PATH`'s reason: the
 * deck and `ForgetPresetRoute` must not be able to drift apart. A BUILT-IN preset has no row and
 * cannot be forgotten; forgetting a saved one brings the built-in it shadowed back.
 */
export const CORE_PRESET_FORGET_PATH = `${CORE_PRESETS_PATH}/forget`;

/**
 * The version chip's three verbs — P4-T5.
 *
 * `GET /doctor` reads the installation's health, narrowed so the binary's path — which carries the
 * Windows account name — never reaches the DOM (SEC-DATA-2, RESEARCH.md F.10.1). The other two are
 * POSTs because neither is safe: `claude update` has **no check-only form**, so pressing it can
 * replace the binary (F.10.2), and `respawn` restarts background sessions.
 */
export const CORE_DOCTOR_PATH = `${CORE_PREFIX}doctor`;
export const CORE_UPDATE_PATH = `${CORE_PREFIX}update`;
/** One session by SHORT id, or `{subscription, all: true}` — and `--all` skips what has finished. */
export const CORE_RESPAWN_PATH = `${CORE_PREFIX}sessions/respawn`;

/**
 * Connect and Disconnect — `GET` for the plan, `POST` to write it (P4-T6, D13, SEC-FS-3).
 *
 * One path and two methods, exactly as `/keybindings` is, because the promise is the same one: the
 * diff is shown by something that cannot write, and the thing that writes re-plans from disk. The
 * browser sends a `direction` and nothing else — no path, no content, no subscription.
 *
 * Core answers it, so a core that is down cannot be disconnected from here. That is not a gap this
 * panel can close: `npm run disconnect` is the repair tool for that case and always was
 * (SECURITY.md §5.3 — a repair tool that needs the broken thing to work is not a repair tool).
 */
export const CORE_CONNECT_PATH = `${CORE_PREFIX}connect`;
