// P2-T5's keyboard, driven through a real browser — the half its unit tests deliberately cannot see.
//
// `contracts/keymap.ts` is tested against plain objects and proves which key is live in which
// context. What it cannot prove is that the context is ever computed correctly from a real focused
// element, and that is where the whole task's risk sits: the listener CAPTURES on `window`, so the
// deck now sees every keystroke on the page before the control being typed into does. One wrong
// branch in `keyContextFor` and the launch prompt silently loses every `j`, `k`, `/` and `?`
// somebody types into it, with no error anywhere. Hence the two checks below that look like
// nothing — a box that ends up holding exactly the characters that were typed into it.
import { settle, waitFor } from './report.mjs';

const ALPHA = '365:a1b2c3d4-0000-4000-8000-000000000001';
/** The string P2-T5 was written to survive: every deck binding, inside one prompt. */
const HOSTILE = 'jk/?19 kill the deck';

export async function keyboardChecks(page, report) {
  report.group('The keyboard, with focus where the user left it');
  await rowFocusChecks(page, report);
  await textFieldChecks(page, report);
  await sheetChecks(page, report);
  await paletteChecks(page, report);
}

/** `j`/`k` move real DOM focus onto the row's own button — D34, and why `Enter` is unbound. */
async function rowFocusChecks(page, report) {
  await page.locator('h1').click();
  await press(page, 'j');
  const first = await focused(page);
  report.check('j focuses the first session row', first.row === ALPHA, first.row || first.tag);

  await press(page, 'j');
  const second = await focused(page);
  report.check(
    'j again moves to the next row',
    second.row !== '' && second.row !== ALPHA,
    second.row,
  );

  await press(page, 'k');
  report.check('k moves back', (await focused(page)).row === ALPHA);

  await press(page, 'ArrowDown');
  report.check('the arrows are bound alongside the letters', (await focused(page)).row !== ALPHA);
  await press(page, 'ArrowUp');

  // Enter is deliberately NOT bound on the deck: the row's title IS a button, so the browser's own
  // Enter activates it. Binding it would mean preventDefault-ing it, which breaks every other
  // control the moment one holds focus.
  await press(page, 'Enter');
  const expanded = await waitFor(async () => (await page.locator('.detail').count()) > 0);
  report.check('Enter expands the focused row through the button, not through a binding', expanded);
  await press(page, 'Enter');
  const collapsed = await waitFor(async () => (await page.locator('.detail').count()) === 0);
  report.check('Enter again collapses it', collapsed);
  report.check('focus survives the round trip', (await focused(page)).row === ALPHA);
}

/** The keys that are dead in a text field — the ones a capturing listener could have eaten. */
async function textFieldChecks(page, report) {
  await press(page, '/');
  const search = await focused(page);
  report.check('/ puts the caret in the filter box', search.id === 'deck-search', search.id);

  await page.keyboard.type(HOSTILE);
  const held = await page.locator('#deck-search').inputValue();
  report.check('the filter box receives every character typed into it', held === HOSTILE, held);

  await press(page, 'Escape');
  report.check(
    'Esc hands the keyboard back from a text field',
    (await focused(page)).id !== 'deck-search',
  );
  await page.locator('#deck-search').fill('');

  await page.locator('#launch-prompt').click();
  await page.keyboard.type(HOSTILE);
  const prompt = await page.locator('#launch-prompt').inputValue();
  report.check(
    'the launch prompt keeps a prompt made entirely of deck bindings',
    prompt === HOSTILE,
    prompt,
  );
  report.check(
    'and no digit in it opened a pane',
    (await page.locator('.pane-card').count()) === 0,
  );
  await page.locator('#launch-prompt').fill('');
  await press(page, 'Escape');
}

/** `?` — and that the sheet says out loud what the deck cannot have (RESEARCH.md E.2). */
async function sheetChecks(page, report) {
  await page.locator('h1').click();
  await press(page, '?');
  const open = await waitFor(async () => (await page.locator('.sheet').count()) > 0);
  report.check('? opens the shortcut sheet', open);

  const sheet =
    (await page
      .locator('.sheet')
      .innerText()
      .catch(() => '')) ?? '';
  report.check('the sheet lists Ctrl+W as browser-owned', sheet.includes('Ctrl+W'));
  report.check(
    'and explains Keyboard Lock rather than pretending it could remap it',
    sheet.includes('Keyboard Lock'),
  );
  report.check('it names the one key taken from a pane', sheet.includes('Ctrl+K'));

  await press(page, 'Escape');
  const closed = await waitFor(async () => (await page.locator('.sheet').count()) === 0);
  report.check('Esc closes the sheet', closed);
}

/** Ctrl+K, and the reason the palette is its own `KeyContext`: j and k must TYPE there. */
async function paletteChecks(page, report) {
  await press(page, 'Control+k');
  const open = await waitFor(async () => (await page.locator('.palette').count()) > 0);
  report.check('Ctrl+K opens the command palette', open);
  report.check(
    'the palette autofocuses, because it exists for one keystroke-to-command',
    (await focused(page)).cls.includes('palette-input'),
  );

  await page.keyboard.type('jk');
  const typed = await page.locator('.palette-input').inputValue();
  report.check(
    'j and k type in the palette rather than moving the session list',
    typed === 'jk',
    typed,
  );

  await page.locator('.palette-input').fill('');
  await press(page, 'ArrowDown');
  const second = await page.locator('.palette-item-on .palette-label').textContent();
  report.check('the arrows move the palette selection', second !== null, String(second));

  await page.locator('.palette-input').fill('shell');
  const matched = await waitFor(async () =>
    (
      (await page
        .locator('.palette-list')
        .innerText()
        .catch(() => '')) ?? ''
    ).includes('Open a shell pane'),
  );
  report.check('the palette filters to commands that exist', matched);

  await press(page, 'Escape');
  const closed = await waitFor(async () => (await page.locator('.palette').count()) === 0);
  report.check('Esc closes the palette', closed);
}

async function press(page, key) {
  await page.keyboard.press(key);
  await settle(page);
}

function focused(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    return {
      tag: element?.tagName ?? '',
      id: element?.id ?? '',
      cls: typeof element?.className === 'string' ? element.className : '',
      row: element?.getAttribute?.('data-deck-row') ?? '',
    };
  });
}

export { focused, press };
