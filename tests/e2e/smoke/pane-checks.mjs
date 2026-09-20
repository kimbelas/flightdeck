// A pane, end to end — the ticket, the socket, xterm, and the one key the deck takes back.
//
// **The PTY is an echo, and everything in front of it is real.** `requestPaneTicket` mints through
// the rewrite, `PaneSocket` sends the ticket as the first frame and waits for `ready`, xterm paints
// what comes back, and the fixture core burns the ticket and refuses a mismatched target exactly as
// core does (SEC-WS-1, D32). What a real ConPTY would add here is `claude attach`, which is the one
// thing a CI runner cannot have — so this proves the protocol and the plumbing, and the `run` skill
// still proves the session.
//
// **The keys are the point of this file, not the terminal.** D34 claims `Ctrl+K` from a pane and
// leaves `Esc` alone, and those two sentences are only true if `keyContextFor` returns `terminal`
// for xterm's hidden textarea. Test them anywhere but in a live pane and they test nothing:
// xterm's input IS a `TEXTAREA`, so a `keyContextFor` that checked `text` before `terminal` would
// pass every unit test, un-bind `Ctrl+K` exactly where it is needed, and swallow `Esc` in vim.
import { focused, press } from './keyboard-checks.mjs';
import { waitFor } from './report.mjs';

/** Every single-character deck binding, typed at a shell. None of them may reach the deck. */
const AT_THE_SHELL = 'jjkk//??';

export async function paneChecks(page, report, core, { dev = false } = {}) {
  report.group('A pane, and the keys that must and must not escape it');

  const before = core.minted.length;
  await openShellPane(page, report, core);
  const minted = core.minted.length - before;
  // One in production. Under `next dev` React StrictMode mounts the effect twice — mount, clean up,
  // mount — so the first ticket is minted and never spent, and `PaneSocket.close` marks the pane
  // abandoned so the socket it was for is never opened. That is the designed behaviour rather than
  // a leak (a ticket is single-use and expires in seconds), but it IS two mints, and a check that
  // said "exactly one" in both modes would be asserting that StrictMode does not do what it is for.
  report.check(
    dev
      ? 'the pane minted a ticket per StrictMode mount, and spent one'
      : 'the pane minted exactly one ticket for a shell',
    minted === (dev ? 2 : 1) && core.minted.at(-1)?.kind === 'shell',
    `${String(minted)} mint(s), last ${JSON.stringify(core.minted.at(-1) ?? {})}`,
  );

  await page.keyboard.type(AT_THE_SHELL);
  const arrived = await waitFor(async () => (await painted(page)).includes(AT_THE_SHELL));
  report.check(
    `every deck binding typed at a shell arrives intact (${AT_THE_SHELL})`,
    arrived,
    (await painted(page)).replaceAll(/\s+/gu, ' ').slice(-60),
  );
  report.check('and none of them reached the deck', (await page.locator('.sheet').count()) === 0);

  await escapeChecks(page, report);
  await claimedKeyChecks(page, report);
  await digitChecks(page, report);
  await layoutChecks(page, report);

  await closeEveryPane(page);
  const closed = await waitFor(async () => (await page.locator('.pane-card').count()) === 0);
  report.check('closing the pane removes it', closed);
}

async function closeEveryPane(page) {
  for (let guard = 0; guard < 12; guard += 1) {
    const button = page.locator('.pane-card .pane-head button', { hasText: 'close' }).first();
    if ((await button.count()) === 0) return;
    await button.click();
  }
}

/**
 * The layouts, asserted as GEOMETRY rather than as class names - P5a-T5.
 *
 * A check that read `.panes-2` off the container would pass with the stylesheet deleted, which is
 * exactly the failure G.29 spent a task on. So every assertion here measures where the cards
 * actually are: two panes side by side share a `y` and differ in `x`, the same two stacked share an
 * `x`, and focus mode makes one card far taller than the rest. The CSS is under test, not the JSX.
 */
async function layoutChecks(page, report) {
  await openSecondPane(page, report);

  await chooseLayout(page, '2');
  const twoUp = await cardBoxes(page);
  report.check(
    '2-up puts the panes side by side',
    twoUp.length === 2 && sameRow(twoUp[0], twoUp[1]) && twoUp[0].x < twoUp[1].x,
    JSON.stringify(twoUp),
  );

  await chooseLayout(page, '1');
  const oneUp = await cardBoxes(page);
  report.check(
    '1-up stacks them in one column',
    oneUp.length === 2 && !sameRow(oneUp[0], oneUp[1]) && Math.abs(oneUp[0].x - oneUp[1].x) < 2,
    JSON.stringify(oneUp),
  );

  // The pane the keyboard is pointing at is the one focus mode enlarges, so say which first.
  await page.locator('.xterm-helper-textarea').first().focus();
  await chooseLayout(page, 'focus');
  const focus = await cardBoxes(page);
  report.check(
    'focus mode makes the focused pane large and the rest thumbnails',
    focus.length === 2 && focus[0].height > focus[1].height * 1.5,
    JSON.stringify(focus),
  );

  await movementChecks(page, report);
  await persistenceChecks(page, report);
}

/** A second pane, so a layout has something to arrange. */
async function openSecondPane(page, report) {
  const openable = page.locator('.row button', { hasText: 'open pane' }).first();
  if ((await openable.count()) > 0) await openable.click();
  const two = await waitFor(async () => (await page.locator('.pane-card').count()) >= 2, {
    timeout: 20_000,
  });
  report.check(
    'a second pane opens alongside the first',
    two,
    `${String(await page.locator('.pane-card').count())} card(s)`,
  );
  await waitFor(async () => (await page.locator('.pane-card .chip-live').count()) >= 2, {
    timeout: 20_000,
  });
}

async function chooseLayout(page, option) {
  await page.locator(`[data-pane-layout-option="${option}"]`).click();
  await page.waitForFunction(
    (want) => document.querySelector('.panes')?.dataset['paneLayout'] === want,
    option,
  );
  await settle(page);
}

/** `[` and `]` reorder, and the pane that moves must keep its terminal rather than respawn. */
async function movementChecks(page, report) {
  await chooseLayout(page, '2');
  const before = await paneTitles(page);
  const mountsBefore = await paneMounts(page);

  await page.locator('.xterm-helper-textarea').first().focus();
  await page.locator('h1').click();
  await press(page, ']');
  const moved = await waitFor(
    async () => JSON.stringify(await paneTitles(page)) !== JSON.stringify(before),
  );
  report.check(
    '] moves the focused pane one place right',
    moved,
    `${JSON.stringify(before)} -> ${JSON.stringify(await paneTitles(page))}`,
  );

  // The important half. Reordering is a React key move, not a remount: a remount would dispose the
  // terminal and close the socket, which for an attached session means killing a live PTY because
  // somebody pressed an arrow. `data-pane-attempt` only changes when a lifecycle re-ran.
  report.check(
    'and neither pane was remounted, so no PTY was killed',
    JSON.stringify([...(await paneMounts(page))].toSorted()) ===
      JSON.stringify([...mountsBefore].toSorted()),
    `${JSON.stringify(mountsBefore)} -> ${JSON.stringify(await paneMounts(page))}`,
  );
  report.check(
    'and both panes are still live after the move',
    (await page.locator('.pane-card .chip-live').count()) === 2,
    `${String(await page.locator('.pane-card .chip-live').count())} live`,
  );

  await press(page, '[');
  const back = await waitFor(
    async () => JSON.stringify(await paneTitles(page)) === JSON.stringify(before),
  );
  report.check('[ moves it back', back, JSON.stringify(await paneTitles(page)));

  await press(page, '[');
  await settle(page);
  report.check(
    'and [ at the left-hand end does nothing rather than wrapping',
    JSON.stringify(await paneTitles(page)) === JSON.stringify(before),
    JSON.stringify(await paneTitles(page)),
  );
}

/** The chosen layout outlives a reload - the one piece of deck state that does. */
async function persistenceChecks(page, report) {
  await chooseLayout(page, '6');
  await page.reload({ waitUntil: 'networkidle' });
  const restored = await waitFor(
    async () => (await page.locator('.panes').getAttribute('data-pane-layout')) === '6',
  );
  report.check(
    'the chosen layout survives a reload',
    restored,
    String(await page.locator('.panes').getAttribute('data-pane-layout')),
  );
  report.check(
    'and the chooser says so on the way back in',
    (await page.locator('[data-pane-layout-option="6"]').getAttribute('aria-pressed')) === 'true',
  );
  // Put it back, so the reload this leaves behind is not a layout the next group has to expect.
  await chooseLayout(page, '2');
}

function cardBoxes(page) {
  return page.locator('.pane-card').evaluateAll((cards) =>
    cards.map((card) => {
      const box = card.getBoundingClientRect();
      return { x: Math.round(box.x), y: Math.round(box.y), height: Math.round(box.height) };
    }),
  );
}

function paneTitles(page) {
  return page.locator('.pane-card .pane-title').allTextContents();
}

/**
 * Each card's `data-pane-mount` - a counter kept OUTSIDE React, so it survives nothing.
 *
 * The obvious detector, `data-pane-attempt`, is component state and a remount resets it to 0, so
 * the first version of this check compared ["0","0"] with ["0","0"] and passed against a build
 * that rebuilt both terminals on every move. A page-wide counter is the only one that cannot be
 * reset by the event it is watching for.
 */
function paneMounts(page) {
  return page
    .locator('.pane-card')
    .evaluateAll((cards) => cards.map((card) => card.dataset['paneMount'] ?? '?'));
}

/** One animation frame, so the grid has been laid out before anything measures it. */
function settle(page) {
  return page.evaluate(
    () =>
      new Promise((done) => {
        requestAnimationFrame(() => {
          done(undefined);
        });
      }),
  );
}

function sameRow(a, b) {
  return Math.abs(a.y - b.y) < 2;
}

/** Typed into the pane before it is live, which is the only place G.5's dropped keystroke shows. */
const DURING_THE_HANDSHAKE = 'first';

/**
 * How long the fixture holds the mint open while this check types into the pane.
 *
 * Long enough that Playwright's focus-and-type finishes inside the window with room to spare, and
 * short enough to be invisible in the run. Without it the window is sub-millisecond and the check
 * below passes with the buffer ripped out — verified, which is the only reason this knob exists.
 */
const MINT_DELAY_MS = 1000;

async function openShellPane(page, report, core) {
  core.mintDelayMs = MINT_DELAY_MS;
  await page.locator('h1').click();
  await press(page, 'Control+k');
  await page.locator('.palette-input').fill('shell');
  await press(page, 'Enter');

  const opened = await waitFor(async () => (await page.locator('.pane-card').count()) > 0);
  report.check('the palette opens a real pane', opened);

  // **Typed now, deliberately, and not after `live`.** The pane mints a ticket and then completes a
  // handshake, and `focus()` lands in the middle of both — so the keystrokes a person gets in
  // during that window are the ones `PaneSocket` used to drop on the floor (RESEARCH.md G.5). A
  // check that waited for `live` first could never have seen it, which is how it shipped. xterm's
  // textarea exists as soon as the card does, because `mountPane` opens the terminal synchronously.
  await page.locator('.xterm-helper-textarea').first().focus();
  await page.keyboard.type(DURING_THE_HANDSHAKE);
  report.check(
    'the pane was still minting while that was typed, so this is the real race',
    (await page.locator('.pane-card .chip-connecting').count()) > 0,
  );
  core.mintDelayMs = 0;

  const live = await waitFor(
    async () => (await page.locator('.pane-card .chip-live').count()) > 0,
    {
      timeout: 20_000,
    },
  );
  report.check('the pane reached live, so the ticket was minted and redeemed', live);

  // `.xterm-rows`, not `.pane-host`: the host's textContent includes the 267 characters of CSS
  // xterm injects as a <style> block, which looks exactly like a passing assertion.
  const drawn = await waitFor(async () => (await painted(page)).includes('fixture shell'));
  report.check('xterm painted what the socket sent', drawn, (await painted(page)).slice(0, 48));

  const held = await waitFor(async () => (await painted(page)).includes(DURING_THE_HANDSHAKE));
  report.check(
    `every keystroke typed during the handshake arrives, none dropped (${DURING_THE_HANDSHAKE})`,
    held,
    (await painted(page)).replaceAll(/\s+/gu, ' ').slice(-60),
  );

  await stylesheetChecks(page, report);
}

/**
 * That xterm's own stylesheet reached the page — P5a-T6a, and the reason this check exists at all.
 *
 * Without `@xterm/xterm/css/xterm.css` the pane still renders and every other check here still
 * passes, so nothing in 120 smoke checks noticed that it was missing for the whole of P5a. What
 * gives it away is the element xterm fills with 32 `>` glyphs to measure a cell: the stylesheet
 * parks it off-screen and hides it, and without one it paints a line of them above the session.
 */
async function stylesheetChecks(page, report) {
  const measure = await page.evaluate(() => {
    const element = document.querySelector('.pane-card .xterm-char-measure-element');
    if (element === null) return null;
    const style = getComputedStyle(element);
    return { visibility: style.visibility, position: style.position, left: style.left };
  });
  report.check(
    "xterm's stylesheet is on the page, so the cell-measure element is hidden",
    measure !== null && measure.visibility === 'hidden' && measure.position === 'absolute',
    JSON.stringify(measure),
  );

  // `innerText`, not `textContent`, and the whole card rather than `.xterm-rows`: this is the one
  // assertion that asks what a person SEES. The measure element is a sibling of the rows, so a
  // check scoped to `.xterm-rows` cannot see it — measured, and it passed with the stylesheet
  // removed. `innerText` skips what is hidden, which is exactly the property under test.
  const seen = await page.evaluate(
    () => document.querySelector('.pane-card .pane-host')?.innerText ?? '',
  );
  // Asserted as "the session is the first thing in the pane" rather than as "no run of `>`": the
  // measure element's glyph is whatever xterm picked to size a cell, and it is not stable. The same
  // missing stylesheet paints `>>>>…` against a real ConPTY here and `$$$$…` against the fixture —
  // which is the line RESEARCH.md G.5 reported and mistook for an unparsed escape sequence.
  report.check(
    'and nothing paints above the session',
    seen.trimStart().startsWith('fixture shell'),
    JSON.stringify(seen.slice(0, 40)),
  );
}

/** D34's first rule: `Esc` belongs to vim and to Claude Code's own TUI, and is never taken. */
async function escapeChecks(page, report) {
  await press(page, 'Escape');
  const after = await focused(page);
  report.check(
    'Esc in a pane opens nothing',
    (await page.locator('.sheet, .palette').count()) === 0,
  );
  report.check(
    'Esc in a pane does not blur it either',
    after.cls.includes('xterm-helper-textarea'),
    after.cls,
  );
}

/** D34's second rule: `Ctrl+K` is the one key claimed from a pane, so a pane is always leavable. */
async function claimedKeyChecks(page, report) {
  await press(page, 'Control+k');
  const open = await waitFor(async () => (await page.locator('.palette').count()) > 0);
  report.check('Ctrl+K reaches the deck from inside a live pane', open);
  await press(page, 'Escape');
  const closed = await waitFor(async () => (await page.locator('.palette').count()) === 0);
  report.check('and Esc closes the palette it opened', closed);
}

/** `1`–`9` count panes from the left, and put the caret back in one from anywhere on the deck. */
async function digitChecks(page, report) {
  await page.locator('h1').click();
  await press(page, '1');
  const back = await focused(page);
  report.check(
    '1 puts focus back in the first pane',
    back.cls.includes('xterm-helper-textarea'),
    back.cls,
  );

  await page.locator('h1').click();
  await press(page, '4');
  report.check(
    'a digit past the open panes does nothing rather than guessing',
    !(await focused(page)).cls.includes('xterm-helper-textarea'),
  );
}

function painted(page) {
  return page
    .locator('.xterm-rows')
    .first()
    .textContent()
    .then((text) => text ?? '')
    .catch(() => '');
}
