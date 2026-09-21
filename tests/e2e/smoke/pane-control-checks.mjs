// The pane head's controls — P5a-T6, SPEC §5.3.
//
// Three claims, and only the third is about the browser. `stop` and `respawn` are core verbs about
// the SESSION, so what these check is that the right verb reaches core with the right id — read off
// what the fixture RECEIVED, never off what the page drew. `rename` is the deck's own, so what it
// checks is that the label changes, that the pane keeps its position, and that it is still there
// after a reload.
//
// **A shell pane gets neither verb, and that is a check rather than an omission.** A shell has no
// session behind it, so a `stop` button there would be one that could only 400.
import { waitFor } from './report.mjs';

const ALPHA_ROW = '365:a1b2c3d4-0000-4000-8000-000000000001';
const ALPHA_SHORT = 'a1b2c3d4';
const RENAMED = 'alpha-watch';

export async function paneControlChecks(page, report, core) {
  report.group('Per-pane controls — stop, respawn, rename (P5a-T6)');

  await openAlphaPane(page, report);
  const pane = page.locator('.pane-card').first();

  report.check(
    'a pane on a live background session offers stop and respawn',
    (await pane.locator('[data-pane-stop]').count()) === 1 &&
      (await pane.locator('[data-pane-respawn]').count()) === 1,
  );

  await stopChecks(page, report, core, pane);
  await respawnChecks(page, report, core, pane);
  await renameChecks(page, report, pane);
  await shellChecks(page, report);
  await survivesReload(page, report);

  await closeEveryPane(page);
}

/** `stop` keeps the conversation, so it is one click — the armed second button is `rm`'s (P4-T2). */
async function stopChecks(page, report, core, pane) {
  const before = core.stops.length;
  await pane.locator('[data-pane-stop]').click();
  const reached = await waitFor(() => core.stops.length > before);
  const sent = core.stops.at(-1) ?? {};
  report.check('pressing stop reaches core', reached);
  report.check(
    'with the SHORT id core’s verb actually takes, and the subscription beside it (F.2.8b)',
    sent.shortId === ALPHA_SHORT && sent.subscription === '365',
    JSON.stringify(sent),
  );
  // Closing a pane detaches and never stops a session; this is the other half of that sentence —
  // stopping a session does not close the pane. The row is what says the session is gone.
  report.check('and the pane stays open rather than closing itself', (await pane.count()) === 1);

  // **The sentence is the check.** A stopped session's attach exits 0 with nobody having closed
  // the pane, which is byte for byte the EVICTION signal (F.2.6) — so the first build of this
  // button shipped a pane that said "Another terminal attached to this session" about a session
  // the person had just stopped from that pane. Found by running it, not by a test.
  const said = await waitFor(async () =>
    ((await pane.locator('.pane-detail').allTextContents())[0] ?? '').includes('You stopped'),
  );
  const detail = (await pane.locator('.pane-detail').allTextContents())[0] ?? '(none)';
  report.check(
    'and the pane says the person stopped it, never that somebody else took it',
    said && !detail.includes('Another terminal'),
    detail,
  );
  report.check(
    'with a status of its own rather than the eviction chip',
    (await pane.locator('.pane-head .chip-stopped').count()) === 1,
    (await pane.locator('.pane-head .chip').allTextContents())[0] ?? '(none)',
  );
}

async function respawnChecks(page, report, core, pane) {
  const before = core.respawns.length;
  await pane.locator('[data-pane-respawn]').click();
  const reached = await waitFor(() => core.respawns.length > before);
  const sent = core.respawns.at(-1) ?? {};
  report.check('pressing respawn reaches core', reached);
  report.check(
    'naming ONE session rather than sending --all from a pane',
    sent.shortId === ALPHA_SHORT && sent.all === undefined,
    JSON.stringify(sent),
  );
}

/**
 * Renaming, and the sentence that keeps it honest.
 *
 * The title is what `aria-label` and the smoke both name a pane by, and `data-deck-pane` carries
 * the position — so a rename must move the label and leave the digit alone.
 */
async function renameChecks(page, report, pane) {
  await pane.locator('[data-pane-rename]').click();
  const box = pane.locator('[data-pane-rename-input]');
  const opened = await waitFor(async () => (await box.count()) === 1);
  report.check('rename opens an editor in the head', opened);

  const note = (await pane.locator('.pane-rename-note').allTextContents()).join(' ');
  report.check(
    'which says plainly that it names the PANE — Claude Code has no rename verb',
    note.includes('Names this pane only') && note.includes('no rename'),
    note,
  );

  await box.fill(RENAMED);
  await pane.locator('[data-pane-rename-save]').click();
  const renamed = await waitFor(
    async () => ((await pane.locator('.pane-title').allTextContents())[0] ?? '') === RENAMED,
  );
  report.check(
    'naming it changes the pane’s title',
    renamed,
    (await pane.locator('.pane-title').allTextContents())[0] ?? '(none)',
  );
  report.check(
    'and the pane keeps the position `1`-`9` resolves against',
    (await pane.getAttribute('data-deck-pane')) === '0',
  );
}

/** A shell has no session, so it has no session verbs — and it can still be named. */
async function shellChecks(page, report) {
  await page.locator('.deck-head button', { hasText: '+ shell' }).click();
  const opened = await waitFor(async () => (await page.locator('.pane-card').count()) === 2);
  report.check('a shell pane opens beside it', opened);

  const shell = page.locator('.pane-card').nth(1);
  report.check(
    'and offers neither stop nor respawn — there is no session to name',
    (await shell.locator('[data-pane-stop]').count()) === 0 &&
      (await shell.locator('[data-pane-respawn]').count()) === 0,
  );
  report.check(
    'but can still be renamed',
    (await shell.locator('[data-pane-rename]').count()) === 1,
  );
}

/** The name rides the entry the open panes already survive a reload in (P5a-T5b). */
async function survivesReload(page, report) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  const back = await waitFor(async () => (await page.locator('.pane-card').count()) === 2, {
    timeout: 20_000,
  });
  report.check('both panes come back after a reload', back);

  const titles = await page.locator('.pane-title').allTextContents();
  report.check(
    'and the renamed one kept its name',
    titles.includes(RENAMED),
    JSON.stringify(titles),
  );
}

async function openAlphaPane(page, report) {
  await page.locator(`[data-deck-row="${ALPHA_ROW}"]`).click();
  const row = page.locator(`article.row:has([data-deck-row="${ALPHA_ROW}"])`);
  await row.locator('button', { hasText: 'open pane' }).first().click();
  const opened = await waitFor(async () => (await page.locator('.pane-card').count()) === 1, {
    timeout: 20_000,
  });
  report.check('a pane opens on a live background session', opened);
  // Collapse the row again, so the list below is the same shape the next group expects.
  await page.locator(`[data-deck-row="${ALPHA_ROW}"]`).click();
}

async function closeEveryPane(page) {
  for (let guard = 0; guard < 12; guard += 1) {
    const button = page.locator('.pane-card .pane-head button', { hasText: 'close' }).first();
    if ((await button.count()) === 0) return;
    await button.click();
  }
}
