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

export async function paneChecks(page, report, core) {
  report.group('A pane, and the keys that must and must not escape it');

  const minted = core.minted.length;
  await openShellPane(page, report);
  report.check(
    'the pane minted exactly one ticket for a shell',
    core.minted.length === minted + 1 && core.minted.at(-1)?.kind === 'shell',
    JSON.stringify(core.minted.at(-1) ?? {}),
  );

  const input = page.locator('.xterm-helper-textarea').first();
  await input.focus();
  // A primer, deliberately: a freshly focused pane can swallow the first keystroke (RESEARCH.md
  // G.5). That is a real defect and it is not this check's — the payload below is typed into a
  // pane that has already round-tripped one keystroke, so a dropped character here is a new bug.
  await page.keyboard.press('Enter');
  const primed = await waitFor(async () => (await painted(page)).includes('$'));
  report.check('the pane round-trips a keystroke through the socket', primed);

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

  await page.locator('.pane-head button', { hasText: 'close' }).click();
  const closed = await waitFor(async () => (await page.locator('.pane-card').count()) === 0);
  report.check('closing the pane removes it', closed);
}

async function openShellPane(page, report) {
  await page.locator('h1').click();
  await press(page, 'Control+k');
  await page.locator('.palette-input').fill('shell');
  await press(page, 'Enter');

  const opened = await waitFor(async () => (await page.locator('.pane-card').count()) > 0);
  report.check('the palette opens a real pane', opened);

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
