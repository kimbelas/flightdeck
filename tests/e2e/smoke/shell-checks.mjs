// Plain PowerShell panes — P6-T1, SPEC §5.7(3).
//
// It runs after the project groups because it needs an imported folder: a shell opens in the
// CURRENT project, which is the join P3-T6 made possible and the whole of "or the goal fails at
// the first `git status`".
//
// **What is asserted here is the target, not the terminal.** Which binary runs and which directory
// it starts in are decided in `WindowsPtyCommands`, on Windows, against a real registry — and the
// fixture core owns no PTY (D35). So this checks the half that lives on this side of the wire: the
// deck names WHICH shell and WHICH folder, the ticket it mints carries both, and two shells can be
// open at once, which before this task was impossible.
import { waitFor } from './report.mjs';

const titles = (page) => page.locator('.pane-card .pane-title').allTextContents();
const lastMint = (core) => core.minted.at(-1) ?? {};

export async function shellChecks(page, report, core) {
  report.group('Plain PowerShell panes (P6-T1)');

  await closeEveryPane(page);
  await page.locator('[data-project-all]').click();
  await waitFor(async () => (await page.locator('.pane-card').count()) === 0);

  await homeChecks(page, report, core);
  await projectChecks(page, report, core);
  await reuseChecks(page, report);
}

/** Two shells at home — the second is the thing that could not happen before this task. */
async function homeChecks(page, report, core) {
  await openShell(page);
  const first = await waitFor(async () => (await page.locator('.pane-card').count()) === 1);
  report.check('pressing + shell opens one', first, JSON.stringify(await titles(page)));
  report.check(
    'named for the shell it is and the folder it is in',
    (await titles(page))[0] === 'shell-1 · home',
    JSON.stringify(await titles(page)),
  );
  report.check(
    'and the ticket it minted names that shell, with no project on it',
    lastMint(core).kind === 'shell' &&
      lastMint(core).id === 'shell-1' &&
      lastMint(core).project === undefined,
    JSON.stringify(lastMint(core)),
  );

  // The footer said "the session keeps running" on every pane, which for a shell is false:
  // `PaneRegistry` kills the process. SPEC §5.7(3) has `npm run dev` living in one of these.
  const foot = ((await page.locator('.pane-foot').allTextContents())[0] ?? '(none)').trim();
  report.check(
    'and the card says what closing it ACTUALLY does — a shell is ended, not detached',
    foot.includes('ends the shell') && !foot.includes('keeps running'),
    foot,
  );

  await openShell(page);
  const second = await waitFor(async () => (await page.locator('.pane-card').count()) === 2);
  report.check(
    'a SECOND shell opens beside the first, which before P6-T1 replaced it',
    second && (await titles(page)).join(', ') === 'shell-1 · home, shell-2 · home',
    JSON.stringify(await titles(page)),
  );
  report.check(
    'and it minted a ticket of its own, for a different shell',
    lastMint(core).id === 'shell-2',
    JSON.stringify(lastMint(core)),
  );
}

/** A shell in the current project — SPEC's `git`, `npm`, `pnpm`. */
async function projectChecks(page, report, core) {
  await page.locator('[data-project-focus]').first().click();
  await waitFor(
    async () => (await page.locator('[data-project-focus][aria-pressed="true"]').count()) === 1,
  );

  await openShell(page);
  const opened = await waitFor(async () => (await page.locator('.pane-card').count()) === 3);
  const named = (await titles(page)).at(-1) ?? '(none)';
  report.check('a shell opened while a project is current says so on the card', opened, named);
  report.check(
    'by the folder’s NAME, not the lowercased key core matches it by',
    named === 'shell-3 · ledger',
    named,
  );
  report.check(
    'and the ticket carries the project KEY, which core looks up rather than uses',
    lastMint(core).project === String.raw`c:\users\owner\documents\ledger`,
    JSON.stringify(lastMint(core)),
  );

  await page.locator('[data-project-all]').click();
}

/** Closing one frees its id. A number that only grows starts looking like a leak. */
async function reuseChecks(page, report) {
  await page
    .locator('.pane-card', { hasText: 'shell-1' })
    .locator('button', { hasText: 'close' })
    .click();
  await waitFor(async () => (await page.locator('.pane-card').count()) === 2);

  await openShell(page);
  const back = await waitFor(async () => (await page.locator('.pane-card').count()) === 3);
  report.check(
    'closing a shell frees its id for the next one',
    back && (await titles(page)).includes('shell-1 · home'),
    JSON.stringify(await titles(page)),
  );

  await closeEveryPane(page);
}

function openShell(page) {
  return page.locator('.deck-head button', { hasText: 'shell' }).first().click();
}

async function closeEveryPane(page) {
  for (let guard = 0; guard < 12; guard += 1) {
    const button = page.locator('.pane-card .pane-head button', { hasText: 'close' }).first();
    if ((await button.count()) === 0) return;
    await button.click();
  }
}
