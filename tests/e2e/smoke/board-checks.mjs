// The State board — P10-T1, mockup 06: five state columns, the panes docked under them.
//
// Measured, like the layout checks, because every claim the board makes is geometry: that the
// columns sit side by side, that a card is in the column its state names, that the dock is a strip
// at the bottom rather than half the screen. And the one claim that is not geometry is the one the
// whole design rests on — that switching Board and Panes never remounts a pane, because a remount
// closes its socket (`pane-grid.tsx`). `data-pane-mount` is what says it did not happen.
import { settle, waitFor } from './report.mjs';
import {
  cardBoxes,
  closeEveryPane,
  fitChecks,
  openShells,
  overlaps,
  paneMounts,
} from './layout-grid-checks.mjs';

const COLUMNS = ['needs-you', 'working', 'shells', 'idle', 'ended'];
const LABELS = ['Needs you', 'Working', 'Shells', 'Idle', 'Ended'];
const DOCK_HEIGHT = 280;
const CAP = 5;
const SPEND_PATH = '/analytics/spend';

/** Switches the deck's view by its own switch, and waits for the body to say so. */
export async function chooseView(page, view) {
  await page.locator(`[data-deck-view-option="${view}"]`).click();
  await page.waitForFunction(
    (want) => document.querySelector('.deck-body')?.classList.contains(`view-${want}`) === true,
    view,
  );
  await settle(page);
}

/**
 * The deck opens on the board — the view the owner chose (D63) — and then hands every later group
 * the Panes view, which is the deck they were all written against.
 */
export async function boardOpeningChecks(page, report, core) {
  report.group('The State board is what the deck opens on (P10-T1)');
  const opened = await waitFor(async () => (await page.locator('.board-col').count()) === 5);
  report.check('five state columns on first load', opened);
  report.check(
    'the switch says Board, and Table is there but not built',
    (await page.locator('[data-deck-view-option="board"]').getAttribute('aria-pressed')) ===
      'true' && (await page.locator('[data-deck-view-option="table"]').isDisabled()),
  );
  const reads = core.requests.filter((request) => request.path === SPEND_PATH).length;
  report.check(
    'the week figure has not read the spend summary on its own',
    reads === 0 && (await page.locator('[data-week-spend]').innerText()) === 'this week',
    `${String(reads)} reads`,
  );
  await chooseView(page, 'panes');
  report.check(
    'the Panes view is the deck as it was: the list and the chooser',
    (await page.locator('.board').count()) === 0 &&
      (await page.locator('section.rows').count()) === 1 &&
      (await page.locator('[data-pane-layout-option]').count()) === 6,
  );
}

export async function boardChecks(page, report, core) {
  report.group('The State board — columns, cards, the dock (P10-T1)');
  await closeEveryPane(page);
  await chooseView(page, 'board');

  await columnChecks(page, report);
  await placementChecks(page, report);
  await moreChecks(page, report, core);
  await dockChecks(page, report, core);
  await dragChecks(page, report);
  await keyChecks(page, report);
  await railChecks(page, report);
  await spendChecks(page, report, core);
  await widthChecks(page, report);

  await closeEveryPane(page);
  // Every later group is written against the Panes view.
  await chooseView(page, 'panes');
}

async function columnChecks(page, report) {
  const ids = await page
    .locator('.board-col')
    .evaluateAll((cols) => cols.map((col) => col.dataset['boardColumn']));
  report.check(
    'the columns are the mockup’s five, in its order',
    same(ids, COLUMNS),
    JSON.stringify(ids),
  );
  const heads = await page.locator('.board-col-head').allInnerTexts();
  report.check(
    'each column is headed by its name',
    heads.every((head, index) => head.startsWith(LABELS[index])),
    JSON.stringify(heads),
  );

  const boxes = await boxesOf(page, '.board-col');
  const tops = new Set(boxes.map((box) => box.y));
  const widths = boxes.map((box) => box.width);
  report.check(
    'side by side, one row, left to right',
    tops.size === 1 && boxes.every((box, i) => i === 0 || box.x > boxes[i - 1].x),
    JSON.stringify(boxes),
  );
  report.check(
    'every column the same width, and none drawn over another',
    Math.max(...widths) - Math.min(...widths) <= 2 && !overlaps(boxes),
    JSON.stringify(widths),
  );

  const counts = await page.locator('.board-col').evaluateAll((cols) =>
    cols.map((col) => ({
      said: Number(col.querySelector('[data-board-count]')?.textContent),
      drawn: col.querySelectorAll('article.row').length,
      more: col.querySelector('[data-board-more]') !== null,
    })),
  );
  report.check(
    'each count is the cards in the column, when nothing is held back',
    counts.every((count) => count.more || count.said === count.drawn),
    JSON.stringify(counts),
  );
}

/** The fixture's rows, by the tone `SessionRowViewModel` gives them. */
const EXPECTED = {
  'fixture-alpha': 'needs-you',
  'fixture-bravo': 'working',
  'fixture-charlie': 'working',
  'fixture-delta': 'working',
  'fixture-golf': 'working',
  'fixture-echo': 'idle',
  'fixture-foxtrot': 'ended',
};

async function placementChecks(page, report) {
  const placed = await page
    .locator('.board-col article.row')
    .evaluateAll((cards) =>
      Object.fromEntries(
        cards.map((card) => [
          card.querySelector('.row-title')?.textContent ?? '',
          card.closest('.board-col')?.dataset['boardColumn'],
        ]),
      ),
    );
  const wrong = Object.entries(EXPECTED).filter(([name, column]) => placed[name] !== column);
  report.check(
    'every fixture session is in the column its state names',
    wrong.length === 0,
    JSON.stringify(wrong.length === 0 ? placed : wrong),
  );
  report.check(
    'a session that ended while blocked is in Ended, not Needs you (G.24)',
    placed['fixture-foxtrot'] === 'ended',
  );
  const muted = await page
    .locator('.board-col.is-muted')
    .evaluateAll((cols) => cols.map((col) => col.dataset['boardColumn']));
  report.check(
    'Idle and Ended are the quiet ones',
    same(muted, ['idle', 'ended']),
    JSON.stringify(muted),
  );

  const delta = card(page, 'fixture-delta');
  report.check(
    'an interactive card has no pane button, and says why (SPEC §5.2)',
    (await delta.locator('button', { hasText: 'open pane' }).count()) === 0 &&
      (await delta.locator('.row-blocked').count()) === 1 &&
      (await delta.getAttribute('draggable')) === 'false',
  );
  const bravo = card(page, 'fixture-bravo');
  report.check(
    'a live background card offers the pane, and can be dragged',
    (await bravo.locator('button', { hasText: 'open pane' }).count()) === 1 &&
      (await bravo.getAttribute('draggable')) === 'true',
  );
  report.check(
    'an ended background card offers resume',
    (await card(page, 'fixture-foxtrot').locator('button', { hasText: 'resume' }).count()) === 1,
  );
}

/** Seven more idle sessions: the column draws five and says how many it is holding back. */
async function moreChecks(page, report, core) {
  const extra = Array.from({ length: CAP + 2 }, (_unused, index) => ({
    ...core.fixture.snapshot.rows.find((row) => row.name === 'fixture-echo'),
    sessionId: `0000000${String(index)}-0000-4000-8000-00000000board`,
    shortId: `0000000${String(index)}`,
    name: `board-idle-${String(index)}`,
  }));
  core.publish('snapshot', {
    ...core.fixture.snapshot,
    rows: [...core.fixture.snapshot.rows, ...extra],
  });
  const idle = page.locator('[data-board-column="idle"]');
  const capped = await waitFor(async () => (await idle.locator('[data-board-more]').count()) === 1);
  report.check(
    `a long quiet column draws ${String(CAP)} and ends in "Show N more"`,
    capped &&
      (await idle.locator('article.row').count()) === CAP &&
      (await idle.locator('[data-board-more]').innerText()) ===
        `Show ${String(extra.length + 1 - CAP)} more`,
    await idle
      .locator('[data-board-more]')
      .innerText()
      .catch(() => '(none)'),
  );
  report.check(
    'and its count is all of them',
    (await idle.locator('[data-board-count]').innerText()) === String(extra.length + 1),
  );
  await idle.locator('[data-board-more]').click();
  const all = await waitFor(
    async () => (await idle.locator('article.row').count()) === extra.length + 1,
  );
  report.check(
    'pressing it draws the rest',
    all && (await idle.locator('[data-board-more]').count()) === 0,
  );
  core.publish('snapshot', core.fixture.snapshot);
  await waitFor(async () => (await idle.locator('article.row').count()) === 1);
}

async function dockChecks(page, report, core) {
  report.check(
    'the dock says nothing is open, and where a card can go',
    (await page.locator('[data-dock-count]').innerText()) === 'none open' &&
      (await page.locator('.dock-bar').innerText()).includes('Drag a card here to attach'),
  );
  await openShells(page, report, 2);
  const dock = await boxOf(page, '.pane-area.is-dock');
  const board = await boxOf(page, '.board');
  const height = page.viewportSize()?.height ?? 0;
  report.check(
    `the dock is a ${String(DOCK_HEIGHT)}px strip at the bottom, under the board`,
    Math.abs(dock.height - DOCK_HEIGHT) <= 2 &&
      Math.abs(dock.bottom - height) <= 2 &&
      dock.y >= board.bottom - 1,
    JSON.stringify({ dock, board, height }),
  );
  const cards = await cardBoxes(page);
  report.check(
    'docked panes sit side by side in one row, inside the dock',
    new Set(cards.map((each) => each.y)).size === 1 &&
      !overlaps(cards) &&
      cards.every((each) => each.bottom <= dock.bottom + 1),
    JSON.stringify(cards),
  );
  report.check(
    'the dock counts them',
    (await page.locator('[data-dock-count]').innerText()) === '2 open',
  );
  const shells = page.locator('[data-board-column="shells"] [data-board-shell]');
  report.check(
    'each open shell is a card in Shells, saying which pane it is in',
    (await shells.count()) === 2 &&
      (await shells.first().locator('[data-row-in-pane]').innerText()) === 'in pane 1',
    JSON.stringify(await shells.allInnerTexts()),
  );
  await fitChecks(page, report, core, 'docked');

  const before = await paneMounts(page);
  for (const view of ['panes', 'board', 'panes', 'board', 'panes', 'board'])
    await chooseView(page, view);
  const after = await paneMounts(page);
  report.check(
    'Board ⇄ Panes three times remounted no pane, so no PTY was killed',
    same(before, after),
    `${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
  );
  report.check(
    'and both are still live',
    (await page.locator('.pane-card .chip-live').count()) === 2,
  );
  await chooseView(page, 'panes');
  await fitChecks(page, report, core, 'undocked');
  await chooseView(page, 'board');
  await fitChecks(page, report, core, 'docked again');
}

/** A background card dropped on the dock opens its pane — the card's own `open pane`. */
async function dragChecks(page, report) {
  const bravo = card(page, 'fixture-bravo');
  await bravo.dragTo(page.locator('.pane-area.is-dock'));
  const opened = await waitFor(async () => (await page.locator('.pane-card').count()) === 3);
  report.check(
    'dragging a background card onto the dock opens its pane',
    opened && (await page.locator('.pane-title').allInnerTexts()).includes('fixture-bravo'),
    JSON.stringify(await page.locator('.pane-title').allInnerTexts()),
  );
  report.check(
    'and its card says which pane it is in',
    await waitFor(
      async () =>
        (await bravo
          .locator('[data-row-in-pane]')
          .innerText()
          .catch(() => '')) === 'in pane 3',
    ),
  );
  await card(page, 'fixture-delta').dragTo(page.locator('.pane-area.is-dock'));
  await settle(page);
  report.check(
    'an interactive card dropped there opens nothing',
    (await page.locator('.pane-card').count()) === 3,
  );
  await page.locator('.pane-card').nth(2).locator('[data-pane-close]').click();
  await waitFor(async () => (await page.locator('.pane-card').count()) === 2);
}

/** The keys the deck had before the board, on the board. */
async function keyChecks(page, report) {
  await page.locator('h1').click();
  await page.keyboard.press('1');
  const focused = await waitFor(() =>
    page.evaluate(() => document.activeElement?.closest('[data-deck-pane="0"]') !== null),
  );
  report.check('1 puts the caret in the first docked pane', focused);
  await page.locator('h1').click();

  await page.keyboard.press('Control+k');
  const palette = await waitFor(async () => (await page.locator('.palette').count()) === 1);
  report.check('Ctrl+K opens the palette on the board', palette);
  await page.locator('.palette-input').fill('View: Panes');
  await waitFor(
    async () =>
      (await page
        .locator('.palette-item-on .palette-label')
        .innerText()
        .catch(() => '')) === 'View: Panes',
  );
  const entries = await page.locator('.palette [role="option"]').allInnerTexts();
  await page.keyboard.press('Enter');
  const switched = await waitFor(
    async () => (await page.locator('.deck-body.view-panes').count()) === 1,
  );
  report.check(
    'its "View: Panes" entry switches the view',
    switched,
    JSON.stringify(entries.slice(0, 3)),
  );
  await chooseView(page, 'board');

  await page.locator('h1').click();
  await page.keyboard.press('?');
  const sheet = await waitFor(async () => (await page.locator('.sheet').count()) === 1);
  await page.keyboard.press('Escape');
  const shut = await waitFor(async () => (await page.locator('.sheet').count()) === 0);
  report.check('? opens the shortcut sheet on the board, and Esc closes it', sheet && shut);

  await page.locator('h1').click();
  await page.keyboard.press('j');
  const row = await waitFor(() =>
    page.evaluate(() => document.activeElement?.closest('.board-col') !== null),
  );
  report.check('j walks the cards in the columns', row);
}

/** Folding the rail widens the board; New session unfolds it and puts the caret in the prompt. */
async function railChecks(page, report) {
  const wide = (await boxesOf(page, '.board-col'))[0].width;
  await page.locator('[data-rail-toggle]').click();
  await settle(page);
  const folded = (await boxesOf(page, '.board-col'))[0].width;
  report.check(
    'folding the rail hides its panels and gives the board the room',
    (await page.locator('.rail-panels').isHidden()) && folded > wide,
    `${String(wide)}px -> ${String(folded)}px`,
  );
  await page.locator('[data-new-session]').click();
  const caret = await waitFor(() =>
    page.evaluate(() => document.activeElement?.id === 'launch-prompt'),
  );
  report.check(
    'New session unfolds the rail and puts the caret in the one launch form',
    caret && (await page.locator('.rail-panels').isVisible()),
  );
  await page.locator('h1').click();
}

async function spendChecks(page, report, core) {
  const reads = () => core.requests.filter((request) => request.path === SPEND_PATH).length;
  const before = reads();
  await page.locator('[data-week-spend]').click();
  const read = await waitFor(() => reads() === before + 1);
  const label = await page.locator('[data-week-spend]').innerText();
  report.check(
    'the week figure reads the summary when pressed, and says what this week cost',
    read && /^\$\d+\.\d{2} this week$/u.test(label),
    label,
  );
}

async function widthChecks(page, report) {
  report.check(
    'no sideways page scroll at full width',
    !(await scrollsSideways(page)),
    await widest(page),
  );
  const wide = page.viewportSize();
  await page.setViewportSize({ width: 800, height: 900 });
  await settle(page);
  report.check(
    'nor in a narrow window, where the columns stack',
    !(await scrollsSideways(page)),
    await widest(page),
  );
  if (wide !== null) await page.setViewportSize(wide);
  await settle(page);
}

function scrollsSideways(page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}

/** What sticks out past the window, for the detail of a failed width check. */
function widest(page) {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const out = [...document.querySelectorAll('body *')]
      .filter((node) => node.getBoundingClientRect().right > limit + 1)
      .slice(0, 4)
      .map(
        (node) =>
          `${node.tagName.toLowerCase()}.${String(node.className)} ${String(Math.round(node.getBoundingClientRect().right))}`,
      );
    return `${String(document.documentElement.scrollWidth)} > ${String(limit)} ${JSON.stringify(out)}`;
  });
}

function card(page, name) {
  return page.locator('.board-col article.row', {
    has: page.locator('.row-title', { hasText: name }),
  });
}

function boxOf(page, selector) {
  return boxesOf(page, selector).then((boxes) => boxes[0]);
}

function boxesOf(page, selector) {
  return page.locator(selector).evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
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

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
