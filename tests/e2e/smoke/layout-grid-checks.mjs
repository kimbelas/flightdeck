// Every layout with the grid FULL — nine panes through 1, 2, 4, 6, 9 and focus mode.
//
// `pane-checks.mjs` proves the layouts with two panes, and two panes hid every bug in this file:
// with nine open, `grid-auto-rows: 1fr` divided the screen by all nine rows, so 1-up drew 87px
// cards around 240px terminals and they painted over each other; the host's padding put every
// terminal's last row under its card; and focus mode's thumbnails were a footer with an 8px
// terminal in it. None of that is visible to a check that reads a class name, so like the layout
// checks this measures geometry — the painted screen against the card around it, and the rows the
// PTY was told against the rows xterm drew.
import { settle, waitFor } from './report.mjs';

const FULL = 9;
/** What one screen of each grid holds — `GRID_SHAPES` in `contracts/pane-layout.ts`. */
const SHAPES = { 1: [1, 1], 2: [2, 1], 4: [2, 2], 6: [3, 2], 9: [3, 3] };

export async function layoutGridChecks(page, report, core) {
  report.group('Every layout with nine panes open, and the buttons on them');

  await closeEveryPane(page);
  await openShells(page, report, FULL);
  const mounts = await paneMounts(page);

  for (const layout of ['1', '2', '4', '6', '9']) await gridChecks(page, report, core, layout);
  await scrollChecks(page, report);
  await focusChecks(page, report, core);

  report.check(
    'no layout switch remounted a pane, so no PTY was killed by a click',
    (await paneMounts(page)).every((mount) => mounts.includes(mount)),
    `${JSON.stringify(mounts)} -> ${JSON.stringify(await paneMounts(page))}`,
  );

  await fewerChecks(page, report);
  await narrowChecks(page, report);
  await capChecks(page, report);

  await closeEveryPane(page);
  await chooseLayout(page, '2');
}

/** One grid: its shape, that its cards do not overlap, and that every terminal fits its card. */
async function gridChecks(page, report, core, layout) {
  await chooseLayout(page, layout);
  const [columns, rows] = SHAPES[layout];

  report.check(
    `${layout}-up: the chooser marks ${layout} and nothing else`,
    JSON.stringify(await pressedOptions(page)) === JSON.stringify([layout]),
    JSON.stringify(await pressedOptions(page)),
  );

  const cards = await cardBoxes(page);
  const lefts = new Set(cards.map((card) => card.x));
  report.check(
    `${layout}-up: ${String(columns)} column(s)`,
    lefts.size === columns,
    JSON.stringify([...lefts]),
  );

  // A layout is a promise about ONE screen: exactly columns × rows cards are in view, and they
  // share its height rather than every open pane squeezing into it.
  const view = await gridViewport(page);
  const inView = cards.filter((card) => card.y >= view.top - 1 && card.bottom <= view.bottom + 1);
  report.check(
    `${layout}-up: one screen holds ${String(columns * rows)} pane(s), the rest scroll`,
    inView.length === columns * rows,
    `${String(inView.length)} in view of ${String(cards.length)}; view ${JSON.stringify(view)}`,
  );
  const share = (view.bottom - view.top) / rows;
  report.check(
    `${layout}-up: the screen's height is split ${String(rows)} way(s), one per row`,
    cards.every((card) => Math.abs(card.height - share) < 24),
    `row ${String(Math.round(share))}px, cards ${JSON.stringify(cards.map((card) => card.height))}`,
  );

  report.check(
    `${layout}-up: no card is drawn over another`,
    !overlaps(cards),
    JSON.stringify(cards),
  );
  await fitChecks(page, report, core, `${layout}-up`);
}

/**
 * Every terminal inside its card on both axes, at least a few rows tall, and the PTY told so.
 *
 * The last clause is the one the page cannot show: xterm refitting without a `resize` frame leaves
 * Claude drawing for the old width, which LOOKS fine until the TUI redraws.
 */
async function fitChecks(page, report, core, label) {
  const fits = await waitFor(async () => (await terminalFits(page)).every((fit) => fit.ok));
  report.check(
    `${label}: every terminal fits inside its card, right edge and bottom`,
    fits,
    JSON.stringify((await terminalFits(page)).filter((fit) => !fit.ok)),
  );

  const told = await waitFor(async () => {
    const drawn = await drawnRows(page);
    return drawn.every(({ id, rows }) => core.sizes.get(id)?.rows === rows);
  });
  report.check(
    `${label}: and every PTY was sent the size its terminal drew`,
    told,
    JSON.stringify((await drawnRows(page)).map(({ id, rows }) => [id, rows, core.sizes.get(id)])),
  );
}

/** 1-up with nine open: the grid scrolls to the ninth pane rather than hiding it. */
async function scrollChecks(page, report) {
  await chooseLayout(page, '1');
  const last = page.locator('.pane-card').last();
  await last.scrollIntoViewIfNeeded();
  await settle(page);
  const view = await gridViewport(page);
  const box = await last.boundingBox();
  report.check(
    '1-up: scrolling the grid brings the ninth pane fully into view',
    box !== null && box.y >= view.top - 1 && box.y + box.height <= view.bottom + 1,
    JSON.stringify({ box, view }),
  );
  report.check('and it is still live down there', (await last.locator('.chip-live').count()) === 1);
}

/** Focus mode: a stage, a strip of thumbnails, and a click that swaps them. */
async function focusChecks(page, report, core) {
  await page.locator('.pane-card .xterm-helper-textarea').first().focus();
  await chooseLayout(page, 'focus');

  const stage = await stageIndex(page);
  report.check('focus: the focused pane is on the stage', stage === 0, String(stage));
  report.check(
    'focus: the other eight are a strip of thumbnails',
    (await page.locator('.pane-card.is-thumb').count()) === FULL - 1,
    `${String(await page.locator('.pane-card.is-thumb').count())} thumbnail(s)`,
  );

  // What a thumbnail shows: its title, its status and a way to close it. The footer used to wrap
  // to four lines at this width and leave the terminal 8px tall.
  const thumb = page.locator('.pane-card.is-thumb').first();
  const visibleButtons = await thumb.locator('.pane-head button:visible').allInnerTexts();
  report.check(
    'focus: a thumbnail offers close and nothing else',
    JSON.stringify(visibleButtons) === JSON.stringify(['close']),
    JSON.stringify(visibleButtons),
  );
  report.check(
    'focus: and has no footer in the way of its terminal',
    (await thumb.locator('.pane-foot:visible').count()) === 0,
  );
  await fitChecks(page, report, core, 'focus');

  // Clicking into a thumbnail is how you pick what to watch. It must MOVE the pane to the stage
  // by class, not by re-parenting it, or the terminal is disposed on the way (pane-grid.tsx).
  const picked = page.locator('.pane-card').nth(4);
  const pickedMount = await picked.getAttribute('data-pane-mount');
  await picked.locator('.pane-host').click();
  const swapped = await waitFor(async () => (await stageIndex(page)) === 4);
  report.check(
    'focus: clicking into a thumbnail puts that pane on the stage',
    swapped,
    String(await stageIndex(page)),
  );
  report.check(
    'focus: and the pane that left the stage became a thumbnail',
    (await page.locator('.pane-card').first().getAttribute('class'))?.includes('is-thumb') === true,
  );
  report.check(
    'focus: and the promoted pane kept its terminal',
    (await picked.getAttribute('data-pane-mount')) === pickedMount &&
      (await picked.locator('.chip-live').count()) === 1,
  );
  const stageOptions = await picked.locator('.pane-head button:visible').allInnerTexts();
  report.check(
    'focus: the stage offers the whole head again',
    stageOptions.includes('rename') && stageOptions.includes('close'),
    JSON.stringify(stageOptions),
  );
  await fitChecks(page, report, core, 'focus after the swap');

  await page.locator('.pane-card.is-thumb').first().locator('[data-pane-close]').click();
  const closed = await waitFor(async () => (await page.locator('.pane-card').count()) === FULL - 1);
  report.check(
    "focus: a thumbnail's close closes that pane and leaves the stage alone",
    closed && (await page.locator('.pane-card.is-focused').count()) === 1,
    `${String(await page.locator('.pane-card').count())} card(s)`,
  );
  report.check(
    'focus: and the count beside the chooser follows',
    (await page.locator('.pane-bar-count').innerText()) === `${String(FULL - 1)} open`,
    await page.locator('.pane-bar-count').innerText(),
  );
}

/** A 9-up holding four fills the screen with two rows rather than leaving a third of it empty. */
async function fewerChecks(page, report) {
  await chooseLayout(page, '9');
  while ((await page.locator('.pane-card').count()) > 4) {
    await page.locator('.pane-card [data-pane-close]').last().click();
  }
  await waitFor(async () => (await page.locator('.pane-card').count()) === 4);
  await settle(page);
  const view = await gridViewport(page);
  const cards = await cardBoxes(page);
  const bottom = Math.max(...cards.map((card) => card.bottom));
  report.check(
    '9-up with four panes: two rows that fill the screen',
    new Set(cards.map((card) => card.y)).size === 2 && view.bottom - bottom < 24,
    JSON.stringify({ view, cards }),
  );
}

/** Under 900px the 2- and 4-up grids go to one column; the terminals must refit to that too. */
async function narrowChecks(page, report) {
  const wide = page.viewportSize();
  await chooseLayout(page, '4');
  await page.setViewportSize({ width: 800, height: 900 });
  await settle(page);
  const cards = await cardBoxes(page);
  report.check(
    'a narrow window puts 4-up in one column',
    new Set(cards.map((card) => card.x)).size === 1 && !overlaps(cards),
    JSON.stringify(cards),
  );
  const fits = await waitFor(async () => (await terminalFits(page)).every((fit) => fit.ok));
  report.check(
    'and every terminal refits to the narrower card',
    fits,
    JSON.stringify(await terminalFits(page)),
  );
  if (wide !== null) await page.setViewportSize(wide);
  await settle(page);
}

/** Nine is the cap: a tenth pane pushes the oldest out rather than growing a tenth cell. */
async function capChecks(page, report) {
  await openShells(page, report, FULL);
  const before = await paneTitles(page);
  await shellButton(page).click();
  const pushed = await waitFor(
    async () => JSON.stringify(await paneTitles(page)) !== JSON.stringify(before),
  );
  const after = await paneTitles(page);
  report.check(
    'a tenth pane pushes the oldest out, and the grid stays at nine',
    pushed && after.length === FULL && !after.includes(before[0]),
    `${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
  );
}

async function openShells(page, report, want) {
  while ((await page.locator('.pane-card').count()) < want) {
    const count = await page.locator('.pane-card').count();
    await shellButton(page).click();
    await waitFor(async () => (await page.locator('.pane-card').count()) === count + 1);
  }
  const live = await waitFor(
    async () => (await page.locator('.pane-card .chip-live').count()) === want,
    { timeout: 20_000 },
  );
  report.check(
    `${String(want)} panes open and every one reaches live`,
    live,
    `${String(await page.locator('.pane-card .chip-live').count())} live`,
  );
}

function shellButton(page) {
  return page.locator('.deck-head button', { hasText: 'shell' }).first();
}

async function closeEveryPane(page) {
  for (let guard = 0; guard < 20; guard += 1) {
    const button = page.locator('.pane-card [data-pane-close]').first();
    if ((await button.count()) === 0) return;
    await button.click();
  }
}

async function chooseLayout(page, option) {
  await page.locator(`[data-pane-layout-option="${option}"]`).click();
  await page.waitForFunction(
    (want) => document.querySelector('.panes')?.dataset['paneLayout'] === want,
    option,
  );
  await settle(page);
}

function pressedOptions(page) {
  return page
    .locator('[data-pane-layout-option][aria-pressed="true"]')
    .evaluateAll((buttons) => buttons.map((button) => button.dataset['paneLayoutOption']));
}

/** Where the grid's scrolling box shows cards, in page coordinates, inside its padding. */
function gridViewport(page) {
  return page.locator('.panes').evaluate((panes) => {
    const box = panes.getBoundingClientRect();
    const style = getComputedStyle(panes);
    return {
      top: Math.round(box.top + parseFloat(style.paddingTop)),
      bottom: Math.round(box.top + panes.clientHeight - parseFloat(style.paddingBottom)),
    };
  });
}

function cardBoxes(page) {
  return page.locator('.pane-card').evaluateAll((cards) =>
    cards.map((card) => {
      const box = card.getBoundingClientRect();
      return {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
        bottom: Math.round(box.bottom),
      };
    }),
  );
}

/** Two cards in one column whose boxes intersect — the 87px-card-around-a-240px-terminal bug. */
function overlaps(cards) {
  return cards.some((a, i) =>
    cards.some(
      (b, j) =>
        i < j &&
        a.x < b.x + b.width - 1 &&
        b.x < a.x + a.width - 1 &&
        a.y < b.bottom - 1 &&
        b.y < a.bottom - 1,
    ),
  );
}

/** The painted screen against its card, and at least three rows of it. */
function terminalFits(page) {
  return page.locator('.pane-card').evaluateAll((cards) =>
    cards.map((card, index) => {
      const outer = card.getBoundingClientRect();
      const host = card.querySelector('.pane-host')?.getBoundingClientRect();
      const screen = card.querySelector('.xterm-screen')?.getBoundingClientRect();
      const rows = card.querySelectorAll('.xterm-rows > div').length;
      const ok =
        host !== undefined &&
        screen !== undefined &&
        screen.right <= host.right + 1 &&
        screen.bottom <= host.bottom + 1 &&
        host.bottom <= outer.bottom + 1 &&
        rows >= 3;
      return { index, ok, rows, screenBottom: screen?.bottom, hostBottom: host?.bottom };
    }),
  );
}

/** The rows each terminal drew, by the shell id its title names (`shell-3 · home`). */
function drawnRows(page) {
  return page.locator('.pane-card').evaluateAll((cards) =>
    cards.map((card) => ({
      id: (card.querySelector('.pane-title')?.textContent ?? '').split(' ')[0],
      rows: card.querySelectorAll('.xterm-rows > div').length,
    })),
  );
}

/** Which card focus mode put on the stage — the one whose box spans the grid's width. */
function stageIndex(page) {
  return page.locator('.pane-card').evaluateAll((cards) => {
    const widths = cards.map((card) => card.getBoundingClientRect().width);
    const widest = Math.max(...widths);
    return widths.findIndex(
      (width) => width === widest && width > widths.find((w) => w < widest) * 2,
    );
  });
}

function paneMounts(page) {
  return page
    .locator('.pane-card')
    .evaluateAll((cards) => cards.map((card) => card.dataset['paneMount']));
}

function paneTitles(page) {
  return page.locator('.pane-card .pane-title').allInnerTexts();
}
