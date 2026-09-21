// Handing a session to another worktree — P6-T6, SPEC §6(8).
//
// **No session is forked here and none could be.** A real handoff spawns
// `claude --bg --resume <uuid> --fork-session -n <name>` in the target tree, which a CI runner has
// no Claude Code to do; what decides the argv and what comes back is settled in
// `session-handoff.test.ts`, and which trees are offered is settled in `handoff-view-model.test.ts`
// without a DOM.
//
// What lives on this side of the wire is the half neither of those can see:
//
//  * that the targets on screen came from the worktrees of the project THIS session is in, and
//    that the tree it is already in is not among them — the failure this control must not have,
//    because core would accept that folder (`resolveDirectory` screens for "may core write here",
//    not for "is this a different tree") and the result is two sessions over one checkout;
//  * that the row does NOT draw the fork from the reply. A real core answers 201 and the new row
//    arrives on the next sweep, so this pushes the snapshot itself and watches the list before and
//    after — a deck that drew it from the 201 would show the row too early and would pass any
//    check that only counted rows at the end;
//  * that a refusal lands on the row that pressed and on no other, with the form still up.
//
// It runs after `projectViewChecks`, which imports ledger and leaves it imported: four of the
// fixture's sessions are in that folder, and its map carries three worktrees (P3-T4).
import { waitFor } from './report.mjs';
import { forkIdFor } from '../fixture-core.mjs';
import { LEDGER } from './project-view-checks.mjs';

const clean = (text) => (text ?? '(none)').replaceAll(/\s+/gu, ' ').trim();

/** Both in ledger, which is imported. `fixture-charlie` is in atlas, which is not. */
const IN_PROJECT = 'fixture-alpha';
const SECOND = 'fixture-bravo';
const OUTSIDE = 'fixture-charlie';

export async function handoffChecks(page, report, core) {
  report.group('Session handoff into a worktree (P6-T6)');

  await page.locator('[data-project-all]').click();
  await collapseEveryRow(page);

  if (!(await outsideAProjectChecks(page, report))) return;
  if (!(await offerChecks(page, report, core))) return;
  await pressChecks(page, report, core);
  await refusalChecks(page, report, core);
  await collapseEveryRow(page);
}

/**
 * The ordinary answer, and the one that has to be its own sentence.
 *
 * Most sessions on this machine are in folders nobody has imported (`ProjectScope`), so this is
 * what an expanded row usually says. Telling somebody to make a worktree here would be the wrong
 * instruction entirely — the fix is an import.
 */
async function outsideAProjectChecks(page, report) {
  const row = await expand(page, OUTSIDE);
  if (row === undefined) {
    report.check(`the fixture has a session called ${OUTSIDE}`, false);
    return false;
  }
  const said = clean(await row.locator('.row-handoff-none').textContent());
  report.check(
    'a session in no imported project gets the reason instead of the control',
    (await row.locator('[data-row-handoff]').count()) === 0 &&
      said.includes('not in an imported project'),
    said,
  );
  await collapseEveryRow(page);
  return true;
}

/** What the control offers: the project's worktrees, minus the one the session is standing in. */
async function offerChecks(page, report, core) {
  const row = await expand(page, IN_PROJECT);
  if (row === undefined) {
    report.check(`the fixture has a session called ${IN_PROJECT}`, false);
    return false;
  }
  const button = row.locator('[data-row-handoff]');
  const offered = await waitFor(async () => (await button.count()) === 1);
  report.check('a session in an imported project is offered a handoff', offered);
  if (!offered) return false;

  await button.click();
  const opened = await waitFor(async () => (await row.locator('form.row-handoff').count()) === 1);
  report.check('pressing it asks the two questions a fork needs', opened);
  if (!opened) return false;

  await targetChecks(report, core, row);
  await nameChecks(report, row);
  return true;
}

/**
 * The list of trees, against the map core actually sent for that project.
 *
 * Derived rather than written down: `worktreesOf` goes through the same builder `GET /projects/map`
 * answers with, so this asserts against what the deck was told rather than against a number that
 * would have to be corrected twice when the fixture grows a fourth tree.
 */
async function targetChecks(report, core, row) {
  const options = row.locator('[data-row-handoff-target] option');
  const values = await options.evaluateAll((nodes) => nodes.map((node) => node.value));
  const trees = core.worktreesOf(LEDGER);
  report.check(
    'the targets are the worktrees of the project this session is in',
    values.length === trees.length - 1 && trees.length > 1,
    `${String(values.length)} offered of ${String(trees.length)} trees`,
  );
  // The check this control exists for. Core would accept the folder the session is already in —
  // and the result is a fork competing with the original over one checkout (P6-T5's warning).
  report.check(
    'the tree the session is already in is NOT among them',
    !values.includes(LEDGER),
    `${LEDGER} not in ${values.join(', ')}`,
  );
  const labels = await options.evaluateAll((nodes) => nodes.map((node) => node.textContent));
  report.check(
    'and each one is named, so the choice is between trees rather than between paths',
    labels.every((label) => clean(label) !== '' && !clean(label).includes('\\')),
    labels.map((label) => clean(label)).join(' / '),
  );
}

/**
 * The prefilled name.
 *
 * `-n` will happily give two live sessions the same name (RESEARCH.md G.54), and the deck would
 * then draw two identical rows. Pressing straight through must not be able to produce that.
 */
async function nameChecks(report, row) {
  const value = await row.locator('[data-row-handoff-name]').inputValue();
  report.check(
    'the name is prefilled, so a press cannot make a nameless session',
    value !== '',
    value,
  );
  report.check(
    'and it is not the original’s name, which would draw two identical rows',
    value !== IN_PROJECT && value.startsWith(IN_PROJECT),
    value,
  );
}

/** The press: what core was sent, and what the deck does with a 201. */
async function pressChecks(page, report, core) {
  const row = openRow(page, IN_PROJECT);
  const target = await row.locator('[data-row-handoff-target]').inputValue();
  const name = await row.locator('[data-row-handoff-name]').inputValue();
  const rowsBefore = await page.locator('article.row').count();

  await row.locator('[data-row-handoff-go]').click();
  const sent = await waitFor(() => core.handoffs.length === 1);
  report.check('pressing it asks core to fork the session', sent);
  if (!sent) return;

  const asked = core.handoffs[0] ?? {};
  report.check(
    'it sends the folder that was chosen and the name that was typed',
    asked.cwd === target && asked.name === name,
    `${String(asked.cwd)} as ${String(asked.name)}`,
  );
  report.check(
    'and BOTH ids — a uuid alone is not unique across the two config directories',
    /^[0-9a-f]{8}-/u.test(asked.sessionId ?? '') && /^[0-9a-f]{8}$/u.test(asked.shortId ?? ''),
    `${String(asked.sessionId)} / ${String(asked.shortId)}`,
  );
  report.check(
    'the form closes, because core made the fork',
    await waitFor(async () => (await row.locator('form.row-handoff').count()) === 0),
  );
  await arrivalChecks(page, report, core, rowsBefore, asked);
}

/**
 * The half that is really worth a browser: the fork is not drawn from the reply.
 *
 * Core answered 201 with an id. A deck that believed it would have a row on screen now, seconds
 * before core has said the session exists — and that row would be untouchable, because nothing in
 * the store keys a pane, a preview or a stop to it. It arrives on the stream like every other row.
 */
async function arrivalChecks(page, report, core, rowsBefore, asked) {
  const still = await page.locator('article.row').count();
  report.check(
    'the fork is NOT drawn from the 201 — it arrives on the stream like every other row',
    still === rowsBefore,
    `${String(still)} rows, was ${String(rowsBefore)}`,
  );

  const original = core.fixture.snapshot.rows.find((row) => row.name === IN_PROJECT);
  // The id core ANSWERED with, not one made up here: a made-up id would let a deck that drew the
  // row from the 201 pass the check above, because the row would be on screen either way.
  const fork = { ...original, sessionId: forkIdFor(1), shortId: 'f0000000', name: asked.name };
  core.publish('snapshot', {
    ...core.fixture.snapshot,
    rows: [...core.fixture.snapshot.rows, fork],
  });
  const arrived = await waitFor(
    async () => (await page.locator('article.row').count()) === rowsBefore + 1,
  );
  report.check('and it appears when core says it exists', arrived);
  report.check(
    'under the name the fork was given, beside the session it came from',
    (await page.locator('.row-title', { hasText: asked.name }).count()) === 1,
    String(asked.name),
  );

  // Back to the machine every group after this one is written against.
  core.publish('snapshot', core.fixture.snapshot);
  await waitFor(async () => (await page.locator('article.row').count()) === rowsBefore);
}

/**
 * A refused press.
 *
 * Armed on the double rather than provoked, because the control only ever offers trees core knows
 * about — so this path is not reachable by pressing it, and it is the one that matters when the
 * disk has moved under a reading. The form stays up with the two answers still in it: those are
 * what somebody would correct.
 */
async function refusalChecks(page, report, core) {
  const row = openRow(page, IN_PROJECT);
  await row.locator('[data-row-handoff]').click();
  if (!(await waitFor(async () => (await row.locator('form.row-handoff').count()) === 1))) {
    report.check('the control can be opened again after a fork', false);
    return;
  }
  core.refuseHandoff = 'bad_cwd';
  const name = await row.locator('[data-row-handoff-name]').inputValue();

  await row.locator('[data-row-handoff-go]').click();
  const said = row.locator('[data-row-handoff-bad]');
  const shown = await waitFor(async () => (await said.count()) === 1);
  report.check('a refusal says what happened, in words rather than a code', shown);
  if (!shown) return;

  report.check(
    'and says what to do about it rather than naming core’s code',
    clean(await said.textContent())
      .toLowerCase()
      .includes('refresh'),
    clean(await said.textContent()),
  );
  report.check(
    'the form stays up, with the answers that were typed still in it',
    (await row.locator('form.row-handoff').count()) === 1 &&
      (await row.locator('[data-row-handoff-name]').inputValue()) === name,
  );
  await onlyThatRowChecks(page, report);
}

/**
 * The reason the refusal carries a row key at all.
 *
 * Several rows can be expanded at once (P2-T4). A second session in the same project, with its own
 * form open, must show no sentence: the refusal is about the press, and a code with no row on it
 * would say "that folder is gone" under a session nobody pressed.
 */
async function onlyThatRowChecks(page, report) {
  const second = await expand(page, SECOND);
  if (second === undefined) {
    report.check(`the fixture has a second session called ${SECOND}`, false);
    return;
  }
  await second.locator('[data-row-handoff]').click();
  const opened = await waitFor(
    async () => (await second.locator('form.row-handoff').count()) === 1,
  );
  report.check('a second row in the same project opens its own form', opened);
  report.check(
    'and the refusal stays on the row that pressed — it is not a page-wide banner',
    (await second.locator('[data-row-handoff-bad]').count()) === 0 &&
      (await page.locator('[data-row-handoff-bad]').count()) === 1,
    `${String(await page.locator('[data-row-handoff-bad]').count())} on the page`,
  );
}

/** The already-expanded row with this title. */
function openRow(page, title) {
  return page
    .locator('article.row')
    .filter({ has: page.locator('.row-toggle', { hasText: title }) })
    .first();
}

/** Expands the row with this title and returns it, or `undefined` when there is none. */
async function expand(page, title) {
  const row = openRow(page, title);
  const toggle = row.locator('.row-toggle');
  if ((await toggle.count()) === 0) return undefined;
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await waitFor(async () => (await toggle.getAttribute('aria-expanded')) === 'true');
  return row;
}

async function collapseEveryRow(page) {
  for (let guard = 0; guard < 12; guard += 1) {
    const open = page.locator('article.row.row-open .row-toggle').first();
    if ((await open.count()) === 0) return;
    await open.click();
  }
}
