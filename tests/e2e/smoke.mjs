// The deck's gate — a Playwright smoke against a fixture stream, which CI can run (P2-T7).
//
//   npm run smoke          # needs `npm run build` first; CI does both
//
// **This is the only automated check that the deck WORKS.** `app/**` is not in `coverage.include`
// and should not be: the store, the view models and the keymap are all tested without a DOM, which
// is what makes them testable at all. What no unit test in this repo can observe is the thing
// RESEARCH.md §G is a list of — six real bugs that shipped past a green suite, every one found by
// running the thing. A page that renders and never hydrates passes 1290 tests.
//
// **What it starts, and why that is the task.** `flightdeck.cmd` starts a real core, a real Claude
// session and an Edge window; none of that exists on a runner. So: the real PRODUCTION build,
// served by real `next start`, with a fixture core on the far side of the wire (DECISIONS.md D35).
// Every layer that has ever broken here — the proxy's nonce, the rewrite's bearer, the stream
// route's `no-transform` — is the real one. `--dev` swaps `next start` for `next dev` and is
// P2-T6b's guard; see that flag's own comment below.
//
// **Nothing under `~/.claude*` or `%LOCALAPPDATA%\flightdeck` is touched.** The token file goes to
// a fresh temp directory and both processes are pointed at it with `FD_TOKEN_FILE`, so a smoke run
// cannot disturb a live core's token — which is the mistake G.12 already paid for once.
import { mkdtemp, rm, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { FixtureCore } from './fixture-core.mjs';
import { Report, waitFor } from './smoke/report.mjs';
import { askChecks, deckChecks, installChecks } from './smoke/deck-checks.mjs';
import { connectChecks } from './smoke/connect-checks.mjs';
import { devChecks } from './smoke/dev-checks.mjs';
import { keyboardChecks, keyboardHelperChecks } from './smoke/keyboard-checks.mjs';
import { paneChecks } from './smoke/pane-checks.mjs';
import { paneControlChecks } from './smoke/pane-control-checks.mjs';
import { projectChecks } from './smoke/project-checks.mjs';
import { projectViewChecks } from './smoke/project-view-checks.mjs';
import { observedChecks } from './smoke/observed-checks.mjs';
import { configChangeChecks } from './smoke/config-change-checks.mjs';
import { securityChecks } from './smoke/security-checks.mjs';
import { LOOPBACK_ADDRESS, UI_PORT } from '../../contracts/origins.ts';

const DECK = `http://${LOOPBACK_ADDRESS}:${String(UI_PORT)}/deck`;
const NEXT_BIN = fileURLToPath(new URL('../../node_modules/next/dist/bin/next', import.meta.url));
const BUILD_ID = new URL('../../.next/BUILD_ID', import.meta.url);

/**
 * `--dev` runs the same deck against `next dev` instead of the production build — P2-T6b.
 *
 * It exists because G.3 cost this project a fortnight of "editing the deck means rebuilding", and
 * the symptom was silent: the page rendered, never hydrated, and no assertion anywhere would have
 * noticed. The dev server hydrates again; this is what keeps that true.
 *
 * The security group does NOT run in this mode, and that is the point rather than a gap: the dev
 * policy deliberately carries `'unsafe-eval'` and the HMR origin, so asserting the production
 * policy against it would fail correctly. `devChecks` asserts the dev-specific half instead —
 * including that this run really was the dev server, so a green `--dev` run cannot be a production
 * run in disguise.
 */
const DEV = process.argv.includes('--dev');
const SHOT = process.env.FD_SHOT ?? (DEV ? 'smoke-dev.png' : 'smoke.png');

const report = new Report();
const workspace = await mkdtemp(join(tmpdir(), 'flightdeck-smoke-'));
const core = new FixtureCore(join(workspace, 'token'));
let deck;
let browser;

try {
  console.log(DEV ? 'mode: next dev (P2-T6b)' : 'mode: production build');
  if (!DEV) await requireBuild();
  await core.start();
  deck = await startDeck(core.tokenFile);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const seen = watch(page);

  await page.goto(DECK, { waitUntil: 'domcontentloaded' });
  await deckChecks(page, report, core);
  await askChecks(page, report, core);
  await installChecks(page, report, core);
  await connectChecks(page, report, core);
  await projectChecks(page, report, core);
  await keyboardChecks(page, report);
  await keyboardHelperChecks(page, report, core);
  await paneChecks(page, report, core, { dev: DEV });
  // After paneChecks, which ends with every pane closed: this group opens its own two and reloads
  // the page, and a reload in the middle of the key checks would throw their focus away.
  await paneControlChecks(page, report, core);
  // Last, and it imports its own folder: `projectChecks` ends by forgetting the one it imported,
  // so an empty registry is the state this group starts from rather than one it has to undo.
  await projectViewChecks(page, report, core);
  // After it, and on the folder it left imported: this group's first check is that NOTHING
  // has been read yet, which only means anything once a project row has been on screen.
  await observedChecks(page, report, core);
  // Last of the project groups: it EDITS the fixture's config mid-run, and every group before
  // it would then be asserting against a `.claude` that is not the one they were written for.
  await configChangeChecks(page, report, core);
  if (DEV) devChecks(report, seen);
  else await securityChecks(page, report, core, seen);
  await page.screenshot({ path: SHOT });
  console.log(`\nscreenshot: ${SHOT}`);
} finally {
  await browser?.close();
  deck?.kill();
  await core.stop();
  await rm(workspace, { recursive: true, force: true });
}

process.exitCode = report.summary();

/**
 * Everything the browser was given, so the security checks can search all of it.
 *
 * An event stream's body is deliberately not read: `response.text()` on `text/event-stream` does
 * not resolve until the stream ends, and this one is open for the length of the run. Its HEADERS
 * are what that check needs anyway — `no-transform` is the value F.6.3 was about.
 */
function watch(page) {
  const seen = { served: [], problems: [], sockets: [] };
  page.on('console', (message) => {
    const text = message.text();
    if (/Content Security Policy|Refused to/iu.test(text)) seen.problems.push(text);
  });
  page.on('pageerror', (error) => seen.problems.push(`pageerror: ${error.message}`));
  page.on('websocket', (socket) => {
    // The URL as well as the frames: G.3's whole remaining symptom was an upgrade that never
    // became a socket, and `--dev` asserts the HMR one opened at all (dev-checks.mjs).
    seen.sockets.push(socket.url());
    socket.on('framesent', (frame) => seen.served.push(wireFrame(socket, frame)));
    socket.on('framereceived', (frame) => seen.served.push(wireFrame(socket, frame)));
  });
  page.on('response', (response) => {
    const record = {
      url: response.url(),
      status: response.status(),
      headers: response.headers(),
      body: '',
    };
    seen.served.push(record);
    if ((record.headers['content-type'] ?? '').includes('event-stream')) return;
    // Detached: a body that cannot be read (a redirect, an aborted request) leaves the record with
    // an empty body rather than taking the run down.
    void response
      .text()
      .then((text) => (record.body = text))
      .catch(() => undefined);
  });
  return seen;
}

/** A PTY frame, shaped like a response so one search covers both. The ticket rides these. */
function wireFrame(socket, frame) {
  return { url: socket.url(), status: 0, headers: {}, body: String(frame.payload ?? '') };
}

async function requireBuild() {
  try {
    await access(BUILD_ID);
  } catch {
    throw new Error('no production build — run `npm run build` first, or pass --dev (P2-T6b)');
  }
}

/**
 * The real deck — from the production build, or from `next dev` under `--dev`.
 *
 * `next` is invoked through its own bin with the current `node` rather than through a package
 * script, so the child is a process this file can kill on Windows as well as on the runner —
 * an `npm start` in between leaves the server orphaned holding port 4949.
 *
 * `NODE_ENV` is set rather than left to `next`, because it is what `proxy.ts` reads to decide
 * whether the policy may carry `'unsafe-eval'` and the HMR origin. Getting it wrong in either
 * direction is silent, which is the entire history of this file's subject.
 */
async function startDeck(tokenFile) {
  const command = DEV ? 'dev' : 'start';
  const args = [NEXT_BIN, command, '-H', LOOPBACK_ADDRESS, '-p', String(UI_PORT)];
  const child = spawn(process.execPath, args, {
    env: {
      ...process.env,
      NODE_ENV: DEV ? 'development' : 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      FD_TOKEN_FILE: tokenFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = [];
  child.stdout.on('data', (chunk) => log.push(String(chunk)));
  child.stderr.on('data', (chunk) => log.push(String(chunk)));

  const up = await waitFor(
    () =>
      fetch(DECK)
        .then((reply) => reply.ok)
        .catch(() => false),
    { timeout: DEV ? 180_000 : 60_000, every: 250 },
  );
  if (!up) {
    child.kill();
    throw new Error(`the deck never answered on ${DECK}\n${log.join('')}`);
  }
  return child;
}
