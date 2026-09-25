// Moving a live interactive session into Flightdeck — P6-T8, D63.
//
// **Nothing is ended here and nothing could be.** Which process a real core ends, that it is
// `claude.exe`, and that every refusal comes before the kill is `session-takeover.test.ts`; the
// kill-then-adopt sequence itself was measured on a throwaway session (RESEARCH.md G.60). What is
// checked here is the half no unit test can see through a browser:
//
//  * that a BUSY live terminal shows the button held, with what it is waiting for — the fixture's
//    `fixture-delta` is busy, which is the state most rows will be in when somebody looks;
//  * that an idle one ARMS rather than sends: the first press puts the sentence on screen and
//    sends nothing, because the window it closes is somebody's;
//  * that the confirmed press sends the ref and NO pid and NO folder — core reads both;
//  * that a refusal says the terminal was left alone, which is the question after one.
import { waitFor } from './report.mjs';

const clean = (text) => (text ?? '(none)').replaceAll(/\s+/gu, ' ').trim();

const TERMINAL = 'fixture-delta';

export async function takeoverChecks(page, report, core) {
  report.group('Moving a live terminal session here (P6-T8)');

  await page.locator('[data-project-all]').click();
  const terminal = core.fixture.snapshot.rows.find((row) => row.name === TERMINAL);
  if (terminal === undefined) {
    report.check(`the fixture has a live interactive session called ${TERMINAL}`, false);
    return;
  }

  if (await busyChecks(page, report)) {
    core.publish('snapshot', withStatus(core, 'idle'));
    if (await armChecks(page, report, core)) {
      await confirmChecks(page, report, core, terminal);
      await refusalChecks(page, report, core);
    }
  }

  core.publish('snapshot', core.fixture.snapshot);
  await waitFor(
    async () => await rowFor(page, TERMINAL).locator('[data-row-takeover]').isDisabled(),
  );
}

/** The fixture's own state: live, interactive, and mid-turn. */
async function busyChecks(page, report) {
  const button = rowFor(page, TERMINAL).locator('[data-row-takeover]');
  const there = await waitFor(async () => (await button.count()) === 1);
  report.check('a live interactive session offers to be moved here', there);
  if (!there) return false;
  report.check('but holds the button while it is working', await button.isDisabled());
  report.check(
    'and its title says what it is waiting for',
    clean(await button.getAttribute('title')).includes('once this turn finishes'),
    clean(await button.getAttribute('title')),
  );
  return true;
}

/** The first press arms; it does not send. */
async function armChecks(page, report, core) {
  const button = rowFor(page, TERMINAL).locator('[data-row-takeover]');
  const ready = await waitFor(async () => !(await button.isDisabled()));
  report.check('an idle one can be pressed', ready);
  if (!ready) return false;

  await button.click();
  const warning = rowFor(page, TERMINAL).locator('.row-takeover-warning');
  const armed = await waitFor(async () => (await warning.count()) === 1);
  report.check('the first press shows what it will close, instead of closing it', armed);
  report.check('and sends nothing yet', core.takeovers.length === 0);
  if (!armed) return false;
  report.check(
    'the sentence names the rename, which the label cannot',
    clean(await warning.textContent()).includes('renamed d4e5f6a7'),
    clean(await warning.textContent()),
  );

  await rowFor(page, TERMINAL).locator('.row-takeover button', { hasText: 'cancel' }).click();
  report.check(
    'cancel disarms it without sending',
    (await warning.count()) === 0 && core.takeovers.length === 0,
  );
  return true;
}

/** The second press, and what it sent. */
async function confirmChecks(page, report, core, terminal) {
  await rowFor(page, TERMINAL).locator('[data-row-takeover]').click();
  await rowFor(page, TERMINAL).locator('[data-row-takeover-confirm]').click();

  const sent = await waitFor(() => core.takeovers.length === 1);
  report.check('the confirming press asks core to take the session over', sent);
  if (!sent) return;
  const asked = core.takeovers[0] ?? {};
  report.check(
    'it sends the ref of that session',
    asked.sessionId === terminal.sessionId && asked.subscription === terminal.subscription,
    `${String(asked.sessionId)} on ${String(asked.subscription)}`,
  );
  // The check this group is for: a browser that could name a pid could end any process.
  report.check(
    'and NO pid and NO folder — core reads both off the listing at the press',
    asked.pid === undefined && asked.cwd === undefined,
    JSON.stringify(asked),
  );
}

async function refusalChecks(page, report, core) {
  core.refuseTakeover = 'busy';
  await rowFor(page, TERMINAL).locator('[data-row-takeover]').click();
  await rowFor(page, TERMINAL).locator('[data-row-takeover-confirm]').click();

  const banner = page.locator('.banner-bad');
  const said = await waitFor(async () => (await banner.count()) > 0);
  report.check('a refused take-over is said on the page', said);
  if (!said) return;
  report.check(
    'and says the terminal was left alone',
    clean(await banner.first().textContent()).includes('left alone'),
    clean(await banner.first().textContent()),
  );
}

function withStatus(core, status) {
  return {
    ...core.fixture.snapshot,
    rows: core.fixture.snapshot.rows.map((row) =>
      row.name === TERMINAL ? { ...row, status } : row,
    ),
  };
}

function rowFor(page, title) {
  return page
    .locator('article.row')
    .filter({ has: page.locator('.row-toggle', { hasText: title }) })
    .first();
}
