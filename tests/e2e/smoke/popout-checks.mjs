// Pop out to Windows Terminal, detaching first — P6-T2, SPEC §5.7(4).
//
// **No terminal is opened here and none could be.** A CI runner has no Windows Terminal, and the
// half that decides which binary runs and with what environment is settled in
// `windows-terminal-commands.test.ts` — including the two things it must NEVER do. What lives on
// this side of the wire is what the deck SENDS and what it does with the answer, and that is what
// this group checks.
//
// **The pane going away is the check, not a side effect.** Core releases the hold and the socket
// reports the attach ending; the deck does not close its own card. A deck that did would pass a
// check that counted cards and would be guessing at the outcome of a write — the mistake
// `forgetProject` names one layer over.
import { waitFor } from './report.mjs';

const clean = (text) => (text ?? '(none)').replaceAll(/\s+/gu, ' ').trim();

export async function popoutChecks(page, report, core) {
  report.group('Pop out to Windows Terminal (P6-T2)');

  const title = await openSessionPane(page, report);
  if (title === undefined) return;
  await popoutChecksFor(page, report, core, title);
}

/**
 * A pane on a live background session, which is the only kind that can be popped out FROM.
 *
 * `fixture-alpha` is the fixture's attachable row, and `paneChecks` uses the same one.
 */
async function openSessionPane(page, report) {
  await closeEveryPane(page);
  await page.locator('[data-project-all]').click();
  const open = page.locator('.row button', { hasText: 'open pane' }).first();
  if ((await open.count()) === 0) {
    report.check(
      'a live background session is on the list to pop out',
      false,
      'no open-pane button',
    );
    return undefined;
  }
  await open.click();
  const mounted = await waitFor(async () => (await page.locator('.pane-card').count()) === 1, {
    timeout: 20_000,
  });
  const title = clean((await page.locator('.pane-title').allTextContents())[0]);
  report.check('a pane is open on a live background session', mounted, title);
  return mounted ? title : undefined;
}

/** The button, what it sends, and the card that goes away because CORE let go. */
async function popoutChecksFor(page, report, core, title) {
  const button = page.locator('[data-pane-popout]');
  const offered = await waitFor(async () => (await button.count()) === 1);
  report.check('the pane offers a pop-out', offered);
  report.check(
    'and says what it does, because one word cannot',
    clean(await button.first().getAttribute('title')).includes('Detach'),
    clean(await button.first().getAttribute('title')),
  );

  const before = core.popouts.length;
  await button.first().click();
  const asked = await waitFor(() => core.popouts.length === before + 1);
  const sent = core.popouts.at(-1) ?? {};
  report.check('pressing it asks core to pop the session out', asked, JSON.stringify(sent));

  report.check(
    'it sends BOTH ids, because core screens the short one for the command line',
    typeof sent.sessionId === 'string' && sent.shortId === sent.sessionId.slice(0, 8),
    `${String(sent.sessionId)} / ${String(sent.shortId)}`,
  );
  report.check(
    'and the title and the FOLDER, which core has no way to look up',
    sent.title === title && String(sent.cwd).includes('\\'),
    `${String(sent.title)} in ${String(sent.cwd)}`,
  );
  report.check(
    'the folder is the whole path, not the last segment a row shows',
    String(sent.cwd).split('\\').length > 2,
    String(sent.cwd),
  );

  // Core released the hold; the socket reported the attach ending; the card went. The deck never
  // removed it, which is why this is a check about the WIRE rather than about the button.
  const gone = await waitFor(async () => (await page.locator('.pane-card').count()) === 0);
  report.check('the pane detaches, because core let go of the session', gone);
}

async function closeEveryPane(page) {
  for (let guard = 0; guard < 12; guard += 1) {
    const button = page.locator('.pane-card .pane-head button', { hasText: 'close' }).first();
    if ((await button.count()) === 0) return;
    await button.click();
  }
}
