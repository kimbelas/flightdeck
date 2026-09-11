// Drives the real deck in a real Chromium against a real core — the check that nothing else does.
//
// Not part of `npm test`: it needs core running, a live background session, and the Next dev
// server. Run it by hand while building, and let P2-T7 replace it with a Playwright smoke against
// a fixture stream that CI can run.
//
//   node tests/e2e/deck-pane.spec.mjs
import { chromium } from 'playwright';
import { readCoreToken } from '../../contracts/core-token.ts';

const DECK = 'http://127.0.0.1:4949/deck';
const SHOT = process.env.FD_SHOT ?? 'deck.png';

// P5a-T2b's real assertion, and the only one that can be made from outside: read core's token the
// way a server-side caller does, then prove it appears in nothing the browser was handed. A unit
// test can prove the socket refuses the token; only this can prove the page never sees it.
const CORE_TOKEN = readCoreToken();

const problems = [];
function check(name, passed, detail = '') {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : ` — ${detail}`}`);
  if (!passed) problems.push(name);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });

// Everything the page was served, so the token can be searched for in all of it.
const served = [];
const ticketMints = [];
const cspViolations = [];
page.on('console', (message) => {
  const text = message.text();
  if (/Content Security Policy|Refused to/i.test(text)) cspViolations.push(text);
});
page.on('pageerror', (error) => cspViolations.push(`pageerror: ${error.message}`));

page.on('response', async (response) => {
  const url = response.url();
  if (!url.startsWith('http://127.0.0.1:4949')) return;
  if (url.endsWith('/api/core/pty-ticket')) ticketMints.push(response.status());
  try {
    served.push({ url, body: await response.text() });
  } catch {
    // A redirect or an aborted request has no body to read. Nothing to search, nothing to say.
  }
});

await page.goto(DECK, { waitUntil: 'networkidle' });

// The page hydrated at all — P0-T6 measured that a CSP without a nonce leaves a page that renders
// and never hydrates, whose only symptom is a minified React #412.
await page.waitForSelector('.deck-head', { timeout: 15000 });
check('deck renders', true);

// The first sweep runs two `claude agents --json` calls, ~763 ms each (RESEARCH.md B.2), and it
// starts after hydration — so networkidle is not enough to wait on. Wait for the deck to have
// actually answered, either way.
await page
  .waitForSelector('.deck-head .chip-live, .banner-bad', { timeout: 30000 })
  .catch(() => undefined);
check('core reported up', (await page.locator('.deck-head .chip-live').count()) > 0);

const rows = await page.locator('article.row').count();
check('session rows rendered', rows > 0, `${rows} rows`);

const blocked = await page.locator('.row-blocked').count();
check('interactive rows explain why they cannot attach', blocked > 0, `${blocked} rows`);

const openable = page.locator('article.row button', { hasText: 'open pane' });
const openableCount = await openable.count();
check('at least one attachable session', openableCount > 0, `${openableCount} attachable`);

if (openableCount > 0) {
  await openable.first().click();
  await page.waitForSelector('.pane-card', { timeout: 15000 });

  // The pane says 'live' only after core answered `ready`, which it only does after the ticket in
  // the first frame was minted for this target and redeemed (SEC-WS-1, D32).
  await page.waitForSelector('.pane-card .chip-live', { timeout: 20000 });
  check('pane reached live', true);

  // xterm actually painted, rather than mounting an empty host.
  // `.xterm-rows`, not `.pane-host`: the host's textContent includes the <style> block xterm
  // injects, which is 267 characters of CSS that looks exactly like a passing assertion.
  await page.waitForFunction(
    () => (document.querySelector('.xterm-rows')?.textContent ?? '').trim().length > 40,
    undefined,
    { timeout: 25000 },
  );
  const painted = await page.locator('.xterm-rows').first().textContent();
  check(
    'terminal painted the session',
    (painted ?? '').length > 40,
    `${(painted ?? '').length} chars`,
  );
  check(
    'the attached session is Claude, not an error',
    /Claude Code|ctx |auto mode|flightdeck/i.test(painted ?? ''),
    (painted ?? '').replace(/\s+/g, ' ').slice(0, 90),
  );

  // Type into the pane and confirm the keystroke reached the PTY and came back.
  await page.locator('.xterm-helper-textarea').first().focus();
  await page.waitForTimeout(400);
  await page.keyboard.type('hello from the browser');
  await page.waitForTimeout(2500);
  const after = (await page.locator('.xterm-rows').first().textContent()) ?? '';
  // The tail, not the whole string: a freshly focused pane can swallow the first keystroke
  // (RESEARCH.md G.5), and that is a real defect rather than something to assert away entirely.
  check('typed text reached the PTY and echoed back', after.includes('ello from the browser'));
  check('no keystroke was dropped', after.includes('hello from the browser'), 'known issue G.5');
}

// ---- SEC-WS-1 / D32: the token is not in the browser ------------------------------------------
check(
  'core token was readable server-side, so this file can search for it',
  CORE_TOKEN !== undefined,
);

if (CORE_TOKEN !== undefined) {
  const leaked = served.filter((response) => response.body.includes(CORE_TOKEN));
  check(
    'the per-boot token appears in NOTHING the page was served',
    leaked.length === 0,
    leaked.map((response) => response.url).join(' | '),
  );

  const inPage = await page.evaluate(
    (token) => document.documentElement.outerHTML.includes(token),
    CORE_TOKEN,
  );
  check('the per-boot token is not in the rendered DOM', inPage === false);
}

const tokenRoute = await page.evaluate(async () => {
  const response = await fetch('/api/pty-token');
  return response.status;
});
check('the old /api/pty-token route is gone', tokenRoute === 404, `status ${tokenRoute}`);

check(
  'the pane minted a ticket instead',
  ticketMints.length > 0 && ticketMints.every((status) => status === 201),
  ticketMints.join(', '),
);

check('no CSP violations or page errors', cspViolations.length === 0, cspViolations.join(' | '));

await page.screenshot({ path: SHOT, fullPage: false });
console.log(`\nscreenshot: ${SHOT}`);
await browser.close();

if (problems.length > 0) {
  console.log(`\n${String(problems.length)} FAILED: ${problems.join(', ')}`);
  process.exitCode = 1;
}
