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
// session and an Edge window; none of that exists on a runner. `next dev` renders and never
// hydrates (G.3), so the dev server is not an option either. So: the real PRODUCTION build, served
// by real `next start`, with a fixture core on the far side of the wire (DECISIONS.md D35). Every
// layer that has ever broken here — the proxy's nonce, the rewrite's bearer, the stream route's
// `no-transform` — is the real one.
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
import { deckChecks } from './smoke/deck-checks.mjs';
import { keyboardChecks } from './smoke/keyboard-checks.mjs';
import { paneChecks } from './smoke/pane-checks.mjs';
import { securityChecks } from './smoke/security-checks.mjs';
import { LOOPBACK_ADDRESS, UI_PORT } from '../../contracts/origins.ts';

const DECK = `http://${LOOPBACK_ADDRESS}:${String(UI_PORT)}/deck`;
const NEXT_BIN = fileURLToPath(new URL('../../node_modules/next/dist/bin/next', import.meta.url));
const BUILD_ID = new URL('../../.next/BUILD_ID', import.meta.url);
const SHOT = process.env.FD_SHOT ?? 'smoke.png';

const report = new Report();
const workspace = await mkdtemp(join(tmpdir(), 'flightdeck-smoke-'));
const core = new FixtureCore(join(workspace, 'token'));
let deck;
let browser;

try {
  await requireBuild();
  await core.start();
  deck = await startDeck(core.tokenFile);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const seen = watch(page);

  await page.goto(DECK, { waitUntil: 'domcontentloaded' });
  await deckChecks(page, report, core);
  await keyboardChecks(page, report);
  await paneChecks(page, report, core);
  await securityChecks(page, report, core, seen);
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
  const seen = { served: [], problems: [] };
  page.on('console', (message) => {
    const text = message.text();
    if (/Content Security Policy|Refused to/iu.test(text)) seen.problems.push(text);
  });
  page.on('pageerror', (error) => seen.problems.push(`pageerror: ${error.message}`));
  page.on('websocket', (socket) => {
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
    throw new Error(
      'no production build — run `npm run build` first (`next dev` never hydrates, G.3)',
    );
  }
}

/**
 * The real deck, from the real build.
 *
 * `next` is invoked through its own bin with the current `node` rather than through a package
 * script, so the child is a process this file can kill on Windows as well as on the runner —
 * an `npm start` in between leaves the server orphaned holding port 4949.
 */
async function startDeck(tokenFile) {
  const args = [NEXT_BIN, 'start', '-H', LOOPBACK_ADDRESS, '-p', String(UI_PORT)];
  const child = spawn(process.execPath, args, {
    env: {
      ...process.env,
      NODE_ENV: 'production',
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
    { timeout: 60_000, every: 250 },
  );
  if (!up) {
    child.kill();
    throw new Error(`the deck never answered on ${DECK}\n${log.join('')}`);
  }
  return child;
}
