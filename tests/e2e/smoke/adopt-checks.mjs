// Adopting a session started outside Flightdeck — P6-T7, SPEC §4.3.
//
// **No session is adopted here and none could be.** A real adoption spawns
// `claude --bg --resume <uuid>` in the folder core remembers; the argv, the folder and every
// refusal are settled in `session-adopter.test.ts`, and the asymmetry underneath it — an
// interactive session that vanishes has ENDED, a background one was DELETED — in
// `reconciler-adoption.test.ts`.
//
// **The fixture deliberately does not contain an ended interactive session**, so the snapshot is
// pushed rather than read: the fixture is a healthy machine on purpose (`duplicate-cwd-checks`'s
// rule), and every other group would then be asserting against a list with an extra row shape on
// it. What is checked here is the half neither unit test can see:
//
//  * that a LIVE interactive row offers nothing — SPEC §5.2's permanent constraint, which is the
//    state this feature is the exception to rather than a replacement for;
//  * that the button appears when the terminal closes, and carries the one thing its label cannot
//    say: the session is renamed, because `-n` would keep the name and `-n` starts a copy (G.55);
//  * that the request carries NO folder. A browser naming the directory a process starts in is
//    what SEC-FS-1 exists to prevent, and this is the only place a path could be smuggled in;
//  * that the row does not change itself. The adopted session comes back on the next sweep, and a
//    deck that redrew the row on a 200 would be guessing at the outcome of a write.
import { waitFor } from './report.mjs';

const clean = (text) => (text ?? '(none)').replaceAll(/\s+/gu, ' ').trim();

/** A live interactive session in the fixture — the shape this feature is the exception to. */
const TERMINAL = 'fixture-delta';

export async function adoptChecks(page, report, core) {
  report.group('Adopting a session from a terminal (P6-T7)');

  await page.locator('[data-project-all]').click();
  const rows = core.fixture.snapshot.rows;
  const terminal = rows.find((row) => row.name === TERMINAL);
  if (terminal === undefined) {
    report.check(`the fixture has a live interactive session called ${TERMINAL}`, false);
    return;
  }

  if (!(await whileOpenChecks(page, report))) return;
  if (!(await offerChecks(page, report, core, terminal))) return;
  await pressChecks(page, report, core, terminal);
  await refusalChecks(page, report, core, terminal);

  core.publish('snapshot', core.fixture.snapshot);
  await waitFor(async () => (await page.locator('[data-row-adopt]').count()) === 0);
}

/** While the terminal is open there is nothing to offer, and the reason is the product (SPEC §5.2). */
async function whileOpenChecks(page, report) {
  const row = rowFor(page, TERMINAL);
  if ((await row.count()) === 0) {
    report.check(`${TERMINAL} is on the list`, false);
    return false;
  }
  report.check(
    'a live interactive session offers no adopt — its terminal has it',
    (await row.locator('[data-row-adopt]').count()) === 0,
  );
  report.check(
    'and says why, permanently, rather than showing a button that cannot work',
    clean(await row.locator('.row-blocked').textContent()).includes('already bound'),
    clean(await row.locator('.row-blocked').textContent()),
  );
  return true;
}

/** The terminal closes. This is the moment SPEC §4.3 says the deck makes the offer. */
async function offerChecks(page, report, core, terminal) {
  core.publish('snapshot', endedSnapshot(core, terminal));

  const button = rowFor(page, TERMINAL).locator('[data-row-adopt]');
  const offered = await waitFor(async () => (await button.count()) === 1);
  report.check('closing the terminal turns the row into an offer to adopt it', offered);
  if (!offered) return false;

  report.check(
    'the reason changes with it — "bound to its own terminal" stops being true',
    clean(await rowFor(page, TERMINAL).locator('.row-blocked').textContent()).includes(
      'terminal has closed',
    ),
    clean(await rowFor(page, TERMINAL).locator('.row-blocked').textContent()),
  );
  // `-n` would keep the name and `-n` starts a copy (G.55), so this is the one cost of pressing
  // and it cannot fit on a four-letter button. A row that quietly renamed itself is one somebody
  // spends a minute looking for.
  const hint = clean(await button.getAttribute('title'));
  report.check(
    'the button says the session will be renamed, and to what',
    hint.includes(terminal.shortId) && /renamed/iu.test(hint),
    hint,
  );
  report.check(
    'and which folder it comes back in, because that is the fact core looked up',
    hint.includes(terminal.cwd.split('\\').at(-1) ?? ''),
    hint,
  );
  // The two are complements across `kind` — between them every "not running" row has one button.
  report.check(
    'it is offered INSTEAD of resume, not beside it',
    (await rowFor(page, TERMINAL)
      .locator('.row-blocked-line button', { hasText: 'resume' })
      .count()) === 0,
  );
  return true;
}

/** The press: what core was sent, and — more to the point — what it was not. */
async function pressChecks(page, report, core, terminal) {
  const rowsBefore = await page.locator('article.row').count();
  await rowFor(page, TERMINAL).locator('[data-row-adopt]').click();

  const sent = await waitFor(() => core.adoptions.length === 1);
  report.check('pressing it asks core to adopt the session', sent);
  if (!sent) return;

  const asked = core.adoptions[0] ?? {};
  report.check(
    'it sends the ref of the session that ended',
    asked.sessionId === terminal.sessionId && asked.subscription === terminal.subscription,
    `${String(asked.sessionId)} on ${String(asked.subscription)}`,
  );
  // The check this group is really for. Core reads the folder off its own memory of the machine;
  // a deck that sent one would be choosing the directory a process starts in (SEC-FS-1).
  report.check(
    'and NO folder — core reads that off the machine, the browser does not name it',
    asked.cwd === undefined && asked.path === undefined,
    JSON.stringify(asked),
  );
  report.check(
    'the row does not redraw itself on a 200 — the sweep reports the adoption',
    (await rowFor(page, TERMINAL).locator('[data-row-adopt]').count()) === 1 &&
      (await page.locator('article.row').count()) === rowsBefore,
  );

  await arrivalChecks(page, report, core, terminal);
}

/** Core's next sweep carries it as a background job under the SAME id (G.55). */
async function arrivalChecks(page, report, core, terminal) {
  const adopted = {
    ...terminal,
    kind: 'background',
    name: terminal.shortId,
    live: true,
    runState: 'blocked',
    attachable: true,
    notAttachableBecause: undefined,
  };
  core.publish('snapshot', {
    ...core.fixture.snapshot,
    rows: core.fixture.snapshot.rows.map((row) => (row.name === TERMINAL ? adopted : row)),
  });

  const row = rowFor(page, terminal.shortId);
  const became = await waitFor(
    async () => (await row.locator('button', { hasText: 'open pane' }).count()) === 1,
  );
  report.check('when core says it is a background session, the row offers a pane', became);
  report.check(
    'and the offer to adopt is gone — it was an offer about a session that no longer exists',
    (await page.locator('[data-row-adopt]').count()) === 0,
  );
  report.check(
    'under the same id, because an adoption keeps the id',
    (await page.locator('.row-title', { hasText: terminal.shortId }).count()) === 1,
    terminal.shortId,
  );
}

/**
 * A refused press.
 *
 * `still_running` is the one worth seeing through a browser: it is not a failure at all — the
 * terminal is open — and the sentence has to say what to do rather than name core's code.
 */
async function refusalChecks(page, report, core, terminal) {
  core.publish('snapshot', endedSnapshot(core, terminal));
  const button = rowFor(page, TERMINAL).locator('[data-row-adopt]');
  if (!(await waitFor(async () => (await button.count()) === 1))) {
    report.check('the offer comes back when core says the session ended again', false);
    return;
  }
  core.refuseAdopt = 'still_running';

  await button.click();
  const banner = page.locator('.banner-bad');
  const said = await waitFor(async () => (await banner.count()) > 0);
  report.check('a refusal is said on the page rather than swallowed', said);
  if (!said) return;

  report.check(
    'and says what to do about it instead of naming core’s code',
    clean(await banner.first().textContent()).includes('Close it, then adopt it'),
    clean(await banner.first().textContent()),
  );
}

/** The fixture's snapshot with `fixture-delta`'s terminal closed. */
function endedSnapshot(core, terminal) {
  const ended = {
    ...terminal,
    live: false,
    runState: undefined,
    status: undefined,
    attachable: false,
    notAttachableBecause:
      'That terminal has closed. Adopt it to bring the conversation back as a background session.',
  };
  return {
    ...core.fixture.snapshot,
    rows: core.fixture.snapshot.rows.map((row) => (row.name === TERMINAL ? ended : row)),
  };
}

function rowFor(page, title) {
  return page
    .locator('article.row')
    .filter({ has: page.locator('.row-toggle', { hasText: title }) })
    .first();
}
