// Config-change detection — P3-T7, SPEC §5.1's first enhancement.
//
// It runs last of the project groups, over the folder the two before it left imported, and it is
// the only group here that changes something on the far side of the wire mid-run: `driftConfig()`
// edits the fixture's `.claude`, which is what a commit to a `settings.json` looks like from out
// here. Everything before that edit is the check that a FIRST sighting reports nothing.
//
// **The fixture core runs the real `ConfigHistorian` over a real `FakeStore`**, so what these
// checks exercise is the actual rule — compare with the two newest snapshots, write only when they
// differ — rather than a drift the double invented. A historian that wrote on every read would
// fail the last check here, and one that never wrote would fail the middle ones.
import { waitFor } from './report.mjs';

/**
 * A folder core has NEVER read — imported here so the first check is a real first sighting.
 *
 * The first draft asserted "no chip" over the folder the earlier groups had already had read a
 * dozen times, and the sabotage that makes a first sighting report everything as added PASSED it:
 * by then the snapshot existed and the drift was empty for the ordinary reason. A first-sighting
 * check has to be over a folder that is actually being seen for the first time (G.46's rule).
 */
const ATLAS = String.raw`C:\\Users\\owner\\Documents\\atlas`;

export async function configChangeChecks(page, report, core) {
  report.group('What changed in the config, and when (P3-T7)');

  await firstSightingChecks(page, report, core);
  await changeChecks(page, report, core);
  await persistenceChecks(page, report);
}

const chip = (page) => page.locator('[data-map-changed]');
const clean = (text) => (text ?? '(none)').replaceAll(/\s+/gu, ' ').trim();

/** The row of the project just imported, which is the one with no history behind it. */
const atlasRow = (page) => page.locator('.project').filter({ hasText: 'atlas' }).first();

/** A folder read for the first time says nothing at all — not "everything was added". */
async function firstSightingChecks(page, report, core) {
  const before = await chip(page).count();
  report.check(
    'nothing on the deck claims a config change before anything has changed',
    before === 0,
    `${String(before)} change chips`,
  );

  await page.fill('#project-path', ATLAS);
  await page.locator('.project-add button', { hasText: 'import' }).click();
  const imported = await waitFor(() => core.projects.size === 2);
  await waitFor(async () => (await atlasRow(page).locator('.project-map').count()) === 1);
  report.check('a folder core has never read is imported', imported);

  const drawn = await atlasRow(page).locator('[data-map-changed]').count();
  report.check(
    'and reading it for the first time reports nothing — a first sighting is not a change',
    drawn === 0,
    `${String(drawn)} change chips on a folder seen once`,
  );
}

/** The edit, the refresh, and every number it puts on the row. */
async function changeChecks(page, report, core) {
  core.driftConfig();
  await page.locator('button', { hasText: 'refresh' }).first().click();

  // Both imported folders share the fixture's `.claude`, so both move. That is a check of its
  // own: the history is kept per project, and a change is reported on every folder it happened
  // in rather than on whichever one core looked at first.
  const appeared = await waitFor(async () => (await chip(page).count()) === 2);
  const headline = clean((await chip(page).allTextContents())[0]);
  report.check('editing the config makes a change appear on the row', appeared, headline);
  report.check(
    'on BOTH folders whose config moved, because the history is kept per project',
    (await chip(page).count()) === 2,
    `${String(await chip(page).count())} of 2 rows`,
  );
  report.check(
    'and it is in the CLOSED summary, because a change behind a triangle is not news',
    (await page.locator('.project-map > summary [data-map-changed]').count()) === 2,
  );
  report.check(
    'it says how long ago, not on what date',
    /^changed \d+s ago$/u.test(headline),
    headline,
  );

  await page.locator('.project-map > summary').first().click();
  const section = page.locator('[data-map-changes]').first();
  const opened = await waitFor(async () => await section.isVisible());
  report.check('opening the map shows what changed', opened);

  const heading = clean((await section.locator('h4').allTextContents())[0]);
  report.check(
    'and how long the configuration it replaced had stood — the half that makes it a story',
    heading.includes('after 3d'),
    heading,
  );

  await facetChecks(page, report, section);
}

/** The two facets that moved, and the nine things that did not. */
async function facetChecks(page, report, section) {
  const facets = await section
    .locator('[data-map-change]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-map-change')));
  report.check(
    'only the facets that moved are listed — nine others did not and say nothing',
    facets.join(',') === 'hooks,permissions',
    facets.join(', ') || '(none)',
  );

  const hooks = clean((await section.locator('[data-map-change="hooks"]').allTextContents())[0]);
  report.check(
    'the hook that arrived is named, by what actually runs',
    hooks.includes('hooks +1') && hooks.includes('SessionStart') && hooks.includes('warm-cache'),
    hooks,
  );
  report.check(
    'and the three hooks that did not change are not in the list',
    !hooks.includes('fast-lint') && !hooks.includes('state-dump'),
    hooks,
  );

  const rules = clean(
    (await section.locator('[data-map-change="permissions"]').allTextContents())[0],
  );
  report.check(
    'the deny rule that arrived is named, and said to be a deny rule',
    rules.includes('permissions +1') && rules.includes('deny Read(secrets/**)'),
    rules,
  );

  const added = await section.locator('.map-change-added').count();
  const removed = await section.locator('.map-change-removed').count();
  report.check(
    'what arrived and what left are drawn apart, not as one list',
    added === 2 && removed === 0,
    `${String(added)} added, ${String(removed)} removed`,
  );
}

/**
 * The change survives a RELOAD, which is the whole reason two snapshots are stored.
 *
 * A reload rather than a refresh click, and the difference is not stylistic. The first draft
 * clicked refresh and then asserted — and a sabotage that made the historian report a drift only
 * on the read that SAW it passed, because the chip from the previous reply was still on screen
 * when the assertion ran. There is nothing in the DOM that distinguishes "the new reply rendered"
 * from "it has not arrived yet", so the wait could not be written. A reload has no stale state to
 * race: everything on the page after it came from a request made after it.
 *
 * It is also the stronger claim. "The config changed on Tuesday" has to be true on Wednesday, in a
 * browser that was closed in between, or the feature is a notification rather than a record.
 */
async function persistenceChecks(page, report) {
  const before = clean((await chip(page).allTextContents())[0]);

  await page.reload({ waitUntil: 'domcontentloaded' });
  const survived = await waitFor(async () => (await chip(page).count()) === 2, {
    timeout: 20_000,
  });
  const after = clean((await chip(page).allTextContents())[0]);

  report.check(
    'the change survives a reload — it is a record, not a notification',
    survived,
    `${before} then ${after}`,
  );

  await page.locator('.project-map > summary').first().click();
  const hooks = clean((await page.locator('[data-map-change="hooks"]').allTextContents())[0]);
  report.check(
    'and it is the SAME change, not a new one the reload invented',
    hooks.includes('hooks +1') && hooks.includes('warm-cache'),
    hooks,
  );
}
